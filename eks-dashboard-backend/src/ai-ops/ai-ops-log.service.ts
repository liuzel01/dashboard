import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import { LogSearchDto } from './dto/log-search.dto';

type ActorContext = {
  userId: number | null;
  username: string;
  permissions: string[];
  roles: string[];
};

type LogSourceConfig = {
  environmentId: string;
  enabled: boolean;
  projectId: string;
  sourceId: string;
  baseUrl: string;
  serviceAccount: string;
  token: string;
  datasourceUid: string;
  allowedNamespaces: string[];
  allowedServices: string[];
  maxRangeHours: number;
  maxLines: number;
  timeoutMs: number;
};

@Injectable()
export class AiOpsLogService {
  private readonly logger = new Logger(AiOpsLogService.name);

  constructor(
    private readonly siteConf: SiteConfService,
    private readonly platformDb: PlatformDatabaseService,
  ) {}

  async listSources(environmentId: string, actor: ActorContext) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const source = await this.getSource(environmentId);
    if (!source.enabled) return { environmentId, items: [] };
    this.ensureConfigured(source);
    return {
      environmentId,
      items: [
        {
          projectId: source.projectId,
          sourceId: source.sourceId,
          provider: 'loki',
          serviceAccount: source.serviceAccount,
          allowedNamespaces: source.allowedNamespaces,
          allowedServices: source.allowedServices,
          maxRangeHours: source.maxRangeHours,
          maxLines: source.maxLines,
        },
      ],
    };
  }

  async search(environmentId: string, actor: ActorContext, body: LogSearchDto) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const startedAt = Date.now();
    const source = await this.getSource(environmentId);
    this.ensureConfigured(source);
    if (!source.enabled)
      throw new ServiceUnavailableException(
        `环境 ${environmentId} 尚未启用日志调查`,
      );
    if (
      body.projectId !== source.projectId ||
      body.sourceId !== source.sourceId
    ) {
      throw new BadRequestException('projectId/sourceId 不属于当前环境');
    }
    if (!source.allowedNamespaces.includes(body.namespace)) {
      throw new BadRequestException(
        `namespace ${body.namespace} 不在当前环境允许范围内`,
      );
    }
    if (
      body.serviceName &&
      source.allowedServices.length > 0 &&
      !source.allowedServices.includes(body.serviceName)
    ) {
      throw new BadRequestException(
        `service ${body.serviceName} 不在当前项目允许范围内`,
      );
    }
    const queryText = String(body.queryText || body.entityValue || '').trim();
    if (!queryText && !body.serviceName) {
      throw new BadRequestException('请至少填写服务名称或调查线索');
    }

    const to = body.to ? new Date(body.to) : new Date();
    const maxRangeMs = source.maxRangeHours * 60 * 60 * 1000;
    const effectiveMaxRangeMs = body.serviceName
      ? maxRangeMs
      : Math.min(maxRangeMs, 15 * 60 * 1000);
    const from = body.from
      ? new Date(body.from)
      : new Date(to.getTime() - Math.min(60 * 60 * 1000, effectiveMaxRangeMs));
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to
    ) {
      throw new BadRequestException('日志查询时间范围无效');
    }
    if (to.getTime() - from.getTime() > effectiveMaxRangeMs) {
      throw new BadRequestException(
        body.serviceName
          ? `日志查询范围不能超过 ${source.maxRangeHours} 小时`
          : '未指定服务时日志查询范围不能超过 15 分钟；如需扩大范围，请先选择服务',
      );
    }
    const limit = Math.min(source.maxLines, body.limit || source.maxLines);
    const selectorParts = [`namespace=${JSON.stringify(body.namespace)}`];
    if (body.serviceName)
      selectorParts.push(`service_name=${JSON.stringify(body.serviceName)}`);
    const query = `{${selectorParts.join(',')}}${queryText ? ` |= ${JSON.stringify(queryText)}` : ''}`;
    const endpoint = `${source.baseUrl.replace(/\/+$/, '')}/api/datasources/proxy/uid/${encodeURIComponent(source.datasourceUid)}/loki/api/v1/query_range`;

    try {
      const response = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${source.token}` },
        params: {
          query,
          start: String(BigInt(from.getTime()) * 1_000_000n),
          end: String(BigInt(to.getTime()) * 1_000_000n),
          limit,
          direction: 'backward',
        },
        timeout: source.timeoutMs,
      });
      const streams = Array.isArray(response.data?.data?.result)
        ? response.data.data.result
        : [];
      const evidence = streams
        .flatMap((stream: any) =>
          (Array.isArray(stream?.values) ? stream.values : []).map(
            (value: any) => ({ labels: stream.stream || {}, value }),
          ),
        )
        .filter(
          (entry: any) => Array.isArray(entry.value) && entry.value.length >= 2,
        )
        .map((entry: any) => {
          const timestampNs = String(entry.value[0]);
          const line = this.redact(String(entry.value[1]));
          return {
            evidenceId: createHash('sha256')
              .update(
                `${environmentId}|${source.sourceId}|${timestampNs}|${line}`,
              )
              .digest('hex')
              .slice(0, 20),
            timestamp: new Date(
              Number(BigInt(timestampNs) / 1_000_000n),
            ).toISOString(),
            labels: this.safeLabels(entry.labels),
            line,
          };
        })
        .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, limit);

      await this.insertAudit({
        environmentId,
        actor,
        body,
        query,
        from,
        to,
        status: 'ok',
        hitCount: evidence.length,
        durationMs: Date.now() - startedAt,
      });
      return {
        environmentId,
        projectId: source.projectId,
        sourceId: source.sourceId,
        querySummary: {
          namespace: body.namespace,
          serviceName: body.serviceName || null,
          queryText: queryText || null,
          from: from.toISOString(),
          to: to.toISOString(),
          limit,
        },
        evidence,
        exploreUrl: this.buildExploreUrl(source, query, from, to),
      };
    } catch (error: any) {
      await this.insertAudit({
        environmentId,
        actor,
        body,
        query,
        from,
        to,
        status: 'error',
        hitCount: 0,
        durationMs: Date.now() - startedAt,
        errorMessage: this.errorMessage(error),
      });
      if (error instanceof BadRequestException) throw error;
      const status = Number(error?.response?.status || 0);
      if (status === 401 || status === 403) {
        throw new BadGatewayException(
          `环境 ${environmentId} 的 Grafana 专用凭据无权读取日志或已失效`,
        );
      }
      throw new BadGatewayException(
        `环境 ${environmentId} 日志查询失败：${this.errorMessage(error)}`,
      );
    }
  }

  private async getSource(environmentId: string): Promise<LogSourceConfig> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(environmentId))
      throw new BadRequestException('environmentId 无效');
    const prefix = `aiops.logs.environments.${environmentId}`;
    return {
      environmentId,
      enabled: await this.siteConf.getBoolean(`${prefix}.enabled`, false),
      projectId: await this.siteConf.getString(
        `${prefix}.project_id`,
        environmentId,
      ),
      sourceId: await this.siteConf.getString(
        `${prefix}.source_id`,
        `${environmentId}-loki-main`,
      ),
      baseUrl: await this.siteConf.getString(`${prefix}.grafana_base_url`, ''),
      serviceAccount: await this.siteConf.getString(
        `${prefix}.grafana_service_account`,
        '',
      ),
      token: await this.siteConf.getString(`${prefix}.grafana_token`, ''),
      datasourceUid: await this.siteConf.getString(
        `${prefix}.datasource_uid`,
        '',
      ),
      allowedNamespaces: this.csv(
        await this.siteConf.getString(`${prefix}.allowed_namespaces`, ''),
      ),
      allowedServices: this.csv(
        await this.siteConf.getString(`${prefix}.allowed_services`, ''),
      ),
      maxRangeHours: Math.max(
        1,
        await this.siteConf.getNumber(`${prefix}.max_range_hours`, 24),
      ),
      maxLines: Math.min(
        1000,
        Math.max(1, await this.siteConf.getNumber(`${prefix}.max_lines`, 200)),
      ),
      timeoutMs: Math.min(
        60000,
        Math.max(
          1000,
          await this.siteConf.getNumber(`${prefix}.timeout_ms`, 15000),
        ),
      ),
    };
  }

  private ensureConfigured(source: LogSourceConfig) {
    if (
      !source.baseUrl ||
      !source.token ||
      !source.datasourceUid ||
      !source.serviceAccount ||
      source.allowedNamespaces.length === 0
    ) {
      throw new ServiceUnavailableException(
        `环境 ${source.environmentId} 的 Grafana 日志源尚未完整配置`,
      );
    }
    let url: URL;
    try {
      url = new URL(source.baseUrl);
    } catch {
      throw new ServiceUnavailableException(
        `环境 ${source.environmentId} 的 Grafana URL 配置无效`,
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new ServiceUnavailableException(
        `环境 ${source.environmentId} 的 Grafana URL 配置不安全`,
      );
    }
  }

  private ensurePermissions(actor: ActorContext, required: string[]) {
    const missing = required.filter(
      (permission) => !actor.permissions.includes(permission),
    );
    if (missing.length > 0)
      throw new ForbiddenException(
        `Missing permissions: ${missing.join(', ')}`,
      );
  }

  private csv(value: string) {
    return [
      ...new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }

  private redact(line: string) {
    return line
      .replace(
        /(authorization|api[_-]?key|token|secret|password|passwd)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
        '$1=[REDACTED]',
      )
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
      .slice(0, 8000);
  }

  private safeLabels(labels: Record<string, unknown>) {
    const allowed = [
      'namespace',
      'service_name',
      'app',
      'pod',
      'container',
      'workload',
    ];
    return Object.fromEntries(
      allowed
        .filter((key) => labels[key] !== undefined)
        .map((key) => [key, String(labels[key]).slice(0, 255)]),
    );
  }

  private buildExploreUrl(
    source: LogSourceConfig,
    query: string,
    from: Date,
    to: Date,
  ) {
    const panes = {
      A: {
        datasource: source.datasourceUid,
        queries: [{ refId: 'A', expr: query, queryType: 'range' }],
        range: { from: from.toISOString(), to: to.toISOString() },
      },
    };
    return `${source.baseUrl.replace(/\/+$/, '')}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
  }

  private async insertAudit(input: {
    environmentId: string;
    actor: ActorContext;
    body: LogSearchDto;
    query: string;
    from: Date;
    to: Date;
    status: string;
    hitCount: number;
    durationMs: number;
    errorMessage?: string;
  }) {
    try {
      await this.platformDb.query(
        `INSERT INTO aiops_log_query_audit
          (environment_id, project_id, source_id, actor_user_id, actor_username, entity_field, entity_value_hash, namespace, service_name, query_hash, time_from, time_to, result_count, status, error_message, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [
          input.environmentId,
          input.body.projectId,
          input.body.sourceId,
          input.actor.userId,
          input.actor.username,
          input.body.entityField || 'queryText',
          createHash('sha256')
            .update(
              String(
                input.body.queryText ||
                  input.body.entityValue ||
                  input.body.serviceName ||
                  '',
              ),
            )
            .digest('hex'),
          input.body.namespace,
          input.body.serviceName || null,
          createHash('sha256').update(input.query).digest('hex'),
          input.from,
          input.to,
          input.hitCount,
          input.status,
          input.errorMessage?.slice(0, 1000) || null,
          input.durationMs,
        ],
      );
    } catch (error) {
      this.logger.warn(
        `Failed to write log query audit: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: any) {
    return String(
      error?.response?.data?.message ||
        error?.message ||
        error ||
        'unknown error',
    ).slice(0, 1000);
  }
}
