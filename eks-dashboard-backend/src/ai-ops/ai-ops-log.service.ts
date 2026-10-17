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
import { AiOpsGrafanaMcpService } from './ai-ops-grafana-mcp.service';

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

export type AlertLogSearchResult = {
  querySummary: Record<string, unknown>;
  evidence: Array<{
    evidenceId: string;
    timestamp: string;
    labels: Record<string, string>;
    line: string;
  }>;
  exploreUrl: string;
  execution: {
    requested: 'mcp' | 'direct';
    used: 'mcp' | 'direct';
    fallbackReason: string | null;
  };
  statistics?: {
    matchingLines: number | null;
    sampledLines: number;
    sampleLimit: number;
    truncated: boolean | null;
    samplingStrategy?: 'latest' | 'time-sliced';
    timeSlices?: number;
  };
};

export type LogCategoryStatistic = {
  key: string;
  label: string;
  matchingLines: number | null;
};

@Injectable()
export class AiOpsLogService {
  private readonly logger = new Logger(AiOpsLogService.name);

  constructor(
    private readonly siteConf: SiteConfService,
    private readonly platformDb: PlatformDatabaseService,
    private readonly mcp: AiOpsGrafanaMcpService,
  ) {}

  async listSources(environmentId: string, actor: ActorContext) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const source = await this.getSource(environmentId);
    if (!source.enabled) return { environmentId, items: [] };
    const mcpEnabled = await this.mcp.enabled(environmentId);
    this.ensureConfigured(source, !mcpEnabled);
    const discoveredNamespaces = mcpEnabled
      ? await this.discoverNamespaces(environmentId, source)
      : [];
    return {
      environmentId,
      items: [
        {
          projectId: source.projectId,
          sourceId: source.sourceId,
          provider: 'loki',
          serviceAccount: source.serviceAccount,
          allowedNamespaces:
            discoveredNamespaces.length > 0
              ? discoveredNamespaces
              : source.allowedNamespaces,
          allowedServices: source.allowedServices,
          maxRangeHours: source.maxRangeHours,
          maxLines: source.maxLines,
        },
      ],
    };
  }

  async discoverLabels(
    environmentId: string,
    actor: ActorContext,
    input: { from: string; to: string; namespace?: string },
  ) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    if (!(await this.mcp.enabled(environmentId))) return null;
    const source = await this.getSource(environmentId);
    this.ensureConfigured(source, false);
    const matcherParts = [`cluster=${JSON.stringify(environmentId)}`];
    if (input.namespace)
      matcherParts.push(`namespace=${JSON.stringify(input.namespace)}`);
    const matcher = `{${matcherParts.join(',')}}`;
    try {
      const namesResult = await this.mcp.callTool(
        environmentId,
        'list_loki_label_names',
        {
          datasourceUid: source.datasourceUid,
          matcher,
          startRfc3339: input.from,
          endRfc3339: input.to,
        },
      );
      const names = this.mcpStringArray(namesResult).slice(0, 100);
      const values: Record<string, string[]> = {};
      for (const labelName of [
        'namespace',
        'service_name',
        'app',
        'container',
      ]) {
        if (!names.includes(labelName)) continue;
        const valueResult = await this.mcp.callTool(
          environmentId,
          'list_loki_label_values',
          {
            datasourceUid: source.datasourceUid,
            labelName,
            matcher,
            startRfc3339: input.from,
            endRfc3339: input.to,
          },
        );
        values[labelName] = this.mcpStringArray(valueResult).slice(0, 100);
      }
      return { matcher, names, values };
    } catch (error) {
      this.logger.warn(
        `Grafana MCP label discovery failed for ${environmentId}: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  async search(environmentId: string, actor: ActorContext, body: LogSearchDto) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const startedAt = Date.now();
    const source = await this.getSource(environmentId);
    this.ensureConfigured(source, !(await this.mcp.enabled(environmentId)));
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
    if (
      body.serviceName &&
      source.allowedServices.length > 0 &&
      !source.allowedServices.includes(body.serviceName)
    ) {
      throw new BadRequestException(
        `service ${body.serviceName} 不在当前项目允许范围内`,
      );
    }
    const queryTexts = [
      ...(Array.isArray(body.queryTexts) ? body.queryTexts : []),
      body.queryText || body.entityValue || '',
    ]
      .map((value) => String(value).trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 4);
    if (queryTexts.length === 0 && !body.serviceName) {
      throw new BadRequestException('请至少填写服务名称或调查线索');
    }

    const to = body.to ? new Date(body.to) : new Date();
    const maxRangeMs = source.maxRangeHours * 60 * 60 * 1000;
    const effectiveMaxRangeMs = body.serviceName
      ? maxRangeMs
      : Math.min(maxRangeMs, 60 * 60 * 1000);
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
          : '未指定服务时日志查询范围不能超过 60 分钟；如需扩大范围，请先选择服务',
      );
    }
    const limit = Math.min(source.maxLines, body.limit || source.maxLines);
    const selectorParts: string[] = [];
    if (body.namespace)
      selectorParts.push(`namespace=${JSON.stringify(body.namespace)}`);
    if (body.serviceName)
      selectorParts.push(`service_name=${JSON.stringify(body.serviceName)}`);
    if (selectorParts.length === 0)
      selectorParts.push(`cluster=${JSON.stringify(environmentId)}`);
    const selector = selectorParts.join(',');
    const query = `{${selector}}${queryTexts.map((value) => ` |= ${JSON.stringify(value)}`).join('')}`;
    const endpoint = `${source.baseUrl.replace(/\/+$/, '')}/api/datasources/proxy/uid/${encodeURIComponent(source.datasourceUid)}/loki/api/v1/query_range`;

    try {
      let evidence: AlertLogSearchResult['evidence'];
      const mcpEnabled = await this.mcp.enabled(environmentId);
      let executorUsed: 'mcp' | 'direct' = mcpEnabled ? 'mcp' : 'direct';
      let fallbackReason: string | null = null;
      let matchingLines: number | null = null;
      let samplingStrategy: 'latest' | 'time-sliced' = 'latest';
      let timeSlices = 1;
      if (mcpEnabled) {
        try {
          evidence = await this.searchViaMcp(
            environmentId,
            source,
            query,
            from,
            to,
            limit,
          );
          matchingLines = await this.countViaMcp(
            environmentId,
            source,
            query,
            from,
            to,
          );
          if (
            matchingLines !== null &&
            matchingLines > evidence.length &&
            to.getTime() - from.getTime() >= 30 * 60 * 1000 &&
            limit >= 4
          ) {
            try {
              const sliced = await this.sampleViaMcpTimeSlices(
                environmentId,
                source,
                query,
                from,
                to,
                limit,
              );
              if (sliced.evidence.length > 0) {
                evidence = sliced.evidence;
                samplingStrategy = 'time-sliced';
                timeSlices = sliced.timeSlices;
              }
            } catch (error) {
              this.logger.warn(
                `Grafana MCP time-sliced sampling failed for ${environmentId}; keeping latest sample: ${this.errorMessage(error)}`,
              );
            }
          }
        } catch (error) {
          if (!(await this.mcp.fallbackEnabled(environmentId))) throw error;
          fallbackReason = this.errorMessage(error);
          executorUsed = 'direct';
          this.logger.warn(
            `Grafana MCP failed for ${environmentId}; falling back to direct executor: ${fallbackReason}`,
          );
          evidence = await this.searchDirect(
            environmentId,
            source,
            endpoint,
            query,
            from,
            to,
            limit,
          );
        }
      } else {
        evidence = await this.searchDirect(
          environmentId,
          source,
          endpoint,
          query,
          from,
          to,
          limit,
        );
      }

      const redactEnabled = await this.siteConf.getBoolean(
        `aiops.logs.environments.${environmentId}.redact_enabled`,
        false,
      );
      const restrictLabels = await this.siteConf.getBoolean(
        `aiops.logs.environments.${environmentId}.restrict_labels`,
        false,
      );

      evidence = evidence
        .map((entry) => {
          const rawLine = String(entry.line).slice(0, 8000);
          const line = redactEnabled ? this.redact(rawLine) : rawLine;
          return {
            evidenceId: createHash('sha256')
              .update(
                `${environmentId}|${source.sourceId}|${entry.timestamp}|${line}`,
              )
              .digest('hex')
              .slice(0, 20),
            timestamp: entry.timestamp,
            labels: this.safeLabels(entry.labels || {}, restrictLabels),
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
          queryTexts,
          from: from.toISOString(),
          to: to.toISOString(),
          limit,
        },
        evidence,
        exploreUrl: this.buildExploreUrl(source, query, from, to),
        execution: {
          requested: mcpEnabled ? 'mcp' : 'direct',
          used: executorUsed,
          fallbackReason,
        },
        statistics: {
          matchingLines,
          sampledLines: evidence.length,
          sampleLimit: limit,
          truncated:
            matchingLines === null ? null : matchingLines > evidence.length,
          samplingStrategy,
          timeSlices,
        },
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

  async classifyIngressActivity(
    environmentId: string,
    actor: ActorContext,
    input: {
      namespace: string;
      serviceName: string;
      fixedClue: string;
      from: Date;
      to: Date;
    },
  ): Promise<LogCategoryStatistic[]> {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    if (!(await this.mcp.enabled(environmentId))) return [];
    const source = await this.getSource(environmentId);
    this.ensureConfigured(source, false);
    const selector = `{namespace=${JSON.stringify(input.namespace)},service_name=${JSON.stringify(input.serviceName)}}`;
    const categories = [
      { key: 'auth', label: '登录与第三方登录', pattern: 'third/login|login' },
      { key: 'identity', label: '身份认证 / KYC', pattern: 'identity|kyc' },
      { key: 'withdraw', label: '提现', pattern: 'withdraw' },
      { key: 'otc', label: 'OTC', pattern: 'otc' },
      {
        key: 'security',
        label: '2FA 与安全设置',
        pattern: 'security|google|2fa|phone',
      },
      {
        key: 'writeoff',
        label: '账号注销',
        pattern: 'writeOff|writeoff|write-off',
      },
      {
        key: 'callback',
        label: '回调与通知探测',
        pattern: 'notify/deposit|callback',
      },
      {
        key: 'probe',
        label: '异常路径探测',
        pattern: 'actuator|\\.git|nacos|druid|Nmap|HNAP1|security\\.txt',
      },
    ];
    const results: LogCategoryStatistic[] = [];
    for (let index = 0; index < categories.length; index += 2) {
      const batch = categories.slice(index, index + 2);
      results.push(
        ...(await Promise.all(
          batch.map(async (category) => ({
            key: category.key,
            label: category.label,
            matchingLines: await this.countViaMcp(
              environmentId,
              source,
              `${selector} |= ${JSON.stringify(input.fixedClue)} |~ ${JSON.stringify(category.pattern)}`,
              input.from,
              input.to,
            ),
          })),
        )),
      );
    }
    return results;
  }

  async searchAlertWindow(
    environmentId: string,
    input: {
      namespace: string;
      serviceName: string;
      from: string;
      to: string;
      limit?: number;
    },
  ): Promise<AlertLogSearchResult> {
    const source = await this.getSource(environmentId);
    return (await this.search(
      environmentId,
      {
        userId: null,
        username: 'aiops-alert-investigator',
        permissions: ['menu:ai-ops'],
        roles: ['system'],
      },
      {
        projectId: source.projectId,
        sourceId: source.sourceId,
        namespace: input.namespace,
        serviceName: input.serviceName,
        from: input.from,
        to: input.to,
        limit: input.limit || Math.min(100, source.maxLines),
      },
    )) as AlertLogSearchResult;
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

  private ensureConfigured(source: LogSourceConfig, requireDirectToken = true) {
    if (
      !source.baseUrl ||
      (requireDirectToken && !source.token) ||
      !source.datasourceUid ||
      !source.serviceAccount
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

  private safeLabels(labels: Record<string, unknown>, restrict: boolean) {
    const allowed = [
      'namespace',
      'service_name',
      'app',
      'pod',
      'container',
      'workload',
    ];
    const keys = restrict ? allowed : Object.keys(labels).sort().slice(0, 50);
    return Object.fromEntries(
      keys
        .filter((key) => labels[key] !== undefined)
        .map((key) => [key, String(labels[key]).slice(0, 255)]),
    );
  }

  private mcpStringArray(result: unknown) {
    return this.mcp
      .textPayload(
        result as Parameters<AiOpsGrafanaMcpService['textPayload']>[0],
      )
      .flatMap((text) => {
        try {
          const parsed: unknown = JSON.parse(text);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      })
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private async discoverNamespaces(
    environmentId: string,
    source: LogSourceConfig,
  ) {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    try {
      const result = await this.mcp.callTool(
        environmentId,
        'list_loki_label_values',
        {
          datasourceUid: source.datasourceUid,
          labelName: 'namespace',
          matcher: `{cluster=${JSON.stringify(environmentId)}}`,
          startRfc3339: from.toISOString(),
          endRfc3339: to.toISOString(),
        },
      );
      return [...new Set(this.mcpStringArray(result))]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 200);
    } catch (error) {
      this.logger.warn(
        `Grafana MCP namespace discovery failed for ${environmentId}: ${this.errorMessage(error)}`,
      );
      return [];
    }
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

  private async searchViaMcp(
    environmentId: string,
    source: LogSourceConfig,
    query: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<AlertLogSearchResult['evidence']> {
    const result = await this.mcp.callTool(environmentId, 'query_loki_logs', {
      datasourceUid: source.datasourceUid,
      logql: query,
      startRfc3339: from.toISOString(),
      endRfc3339: to.toISOString(),
      direction: 'backward',
      format: 'full',
      limit,
    });
    const rows = this.mcp
      .textPayload(result)
      .flatMap((text) => {
        try {
          const parsed = JSON.parse(text);
          return Array.isArray(parsed?.data) ? parsed.data : [];
        } catch {
          return [];
        }
      })
      .slice(0, limit);
    return rows.map((row: any) => ({
      evidenceId: '',
      timestamp: this.normalizeLogTimestamp(row?.timestamp),
      labels: row?.labels || {},
      line: String(row?.line || ''),
    }));
  }

  private async sampleViaMcpTimeSlices(
    environmentId: string,
    source: LogSourceConfig,
    query: string,
    from: Date,
    to: Date,
    limit: number,
  ) {
    const rangeMs = to.getTime() - from.getTime();
    const timeSlices = Math.min(
      4,
      Math.max(2, Math.floor(rangeMs / (30 * 60 * 1000))),
    );
    const perSliceLimit = Math.max(1, Math.ceil(limit / timeSlices));
    const evidence = new Map<
      string,
      AlertLogSearchResult['evidence'][number]
    >();
    for (let index = 0; index < timeSlices; index += 1) {
      const sliceFrom = new Date(
        from.getTime() + Math.floor((rangeMs * index) / timeSlices),
      );
      const sliceTo = new Date(
        from.getTime() + Math.floor((rangeMs * (index + 1)) / timeSlices),
      );
      const rows = await this.searchViaMcp(
        environmentId,
        source,
        query,
        sliceFrom,
        sliceTo,
        perSliceLimit,
      );
      for (const row of rows) {
        const key = `${row.timestamp}\u0000${row.line}\u0000${JSON.stringify(row.labels)}`;
        if (!evidence.has(key)) evidence.set(key, row);
      }
    }
    return {
      evidence: [...evidence.values()]
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .slice(0, limit),
      timeSlices,
    };
  }

  private async countViaMcp(
    environmentId: string,
    source: LogSourceConfig,
    query: string,
    from: Date,
    to: Date,
  ) {
    try {
      const rangeSeconds = Math.max(
        1,
        Math.ceil((to.getTime() - from.getTime()) / 1000),
      );
      const result = await this.mcp.callTool(
        environmentId,
        'query_loki_logs',
        {
          datasourceUid: source.datasourceUid,
          logql: `sum(count_over_time((${query})[${rangeSeconds}s]))`,
          queryType: 'instant',
          endRfc3339: to.toISOString(),
        },
        60_000,
      );
      for (const text of this.mcp.textPayload(result)) {
        try {
          const parsed = JSON.parse(text);
          const value = Number(parsed?.data?.[0]?.value);
          if (Number.isFinite(value) && value >= 0) return value;
        } catch {
          // Ignore a malformed optional statistics response.
        }
      }
    } catch (error) {
      this.logger.warn(
        `Grafana MCP matching-line count failed for ${environmentId}: ${this.errorMessage(error)}`,
      );
    }
    return null;
  }

  private normalizeLogTimestamp(value: unknown) {
    const raw = String(value ?? '').trim();
    if (/^\d+$/.test(raw)) {
      const numeric = BigInt(raw);
      const milliseconds =
        raw.length > 13
          ? numeric / 1_000_000n
          : raw.length <= 10
            ? numeric * 1_000n
            : numeric;
      const date = new Date(Number(milliseconds));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    throw new Error(
      `Grafana MCP 返回了无效的日志时间戳：${raw.slice(0, 64) || '-'}`,
    );
  }

  private async searchDirect(
    environmentId: string,
    source: LogSourceConfig,
    endpoint: string,
    query: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<AlertLogSearchResult['evidence']> {
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
    return streams
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
        return {
          evidenceId: '',
          timestamp: new Date(
            Number(BigInt(timestampNs) / 1_000_000n),
          ).toISOString(),
          labels: entry.labels || {},
          line: String(entry.value[1]),
        };
      });
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
          input.body.namespace || '',
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
