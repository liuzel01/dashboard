/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import axios, { AxiosRequestConfig } from 'axios';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { parseSpotPublishCatalog } from '../cicd/cicd-spot-publish.service';
import { SiteConfService } from '../site-conf/site-conf.service';

export type ProviderLayer = 'L2' | 'L3';
export type ProviderCheckStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_CONFIGURED'
  | 'SKIPPED';
export type ProviderCheckResult = {
  targetKey: string;
  layer: ProviderLayer;
  status: ProviderCheckStatus;
  reasonCode: string;
  summary: string;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
  checkedAt: string;
};

type ProviderDefinition = {
  targetKeys: string[];
  check: (
    layer: ProviderLayer,
  ) => Promise<Omit<ProviderCheckResult, 'targetKey' | 'layer' | 'checkedAt'>>;
};

export const providerAlertTransition = (
  previousState: 'OK' | 'FIRING',
  previousFailures: number,
  resultStatus: 'PASS' | 'FAIL',
  threshold: number,
) => {
  if (resultStatus === 'PASS') return { state: 'OK' as const, failures: 0, eventType: previousState === 'FIRING' ? 'RECOVERED' as const : null };
  const failures = previousFailures + 1;
  const firing = previousState === 'FIRING' || failures >= threshold;
  return { state: firing ? 'FIRING' as const : 'OK' as const, failures, eventType: previousState !== 'FIRING' && firing ? 'FIRING' as const : null };
};

@Injectable()
export class DependencyProviderHealthService implements OnModuleInit {
  private readonly logger = new Logger(DependencyProviderHealthService.name);
  private running = false;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.runDueChecks(), 3_000);
  }

  @Interval(60_000)
  async scheduledRun() {
    await this.runDueChecks();
  }

  @Interval(21_600_000)
  async cleanupHistory() {
    const days = Math.max(1, Math.min(365, await this.siteConf.getNumber('dependency_health.history_retention_days', 30)));
    await this.db.query(`DELETE FROM dependency_health_history WHERE checked_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)`, [days]);
    await this.db.query(`DELETE FROM dependency_health_alert_events WHERE created_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)`, [days]);
  }

  async latest(): Promise<
    Map<string, Partial<Record<ProviderLayer, ProviderCheckResult>>>
  > {
    try {
      const rows = await this.db.query<any[]>(
        `SELECT target_key,layer,status,reason_code,summary,duration_ms,metadata_json,checked_at
         FROM dependency_health_provider_results`,
      );
      const result = new Map<
        string,
        Partial<Record<ProviderLayer, ProviderCheckResult>>
      >();
      for (const row of rows) {
        const current = result.get(row.target_key) || {};
        const layer = row.layer as ProviderLayer;
        current[layer] = {
          targetKey: row.target_key,
          layer,
          status: row.status,
          reasonCode: row.reason_code,
          summary: row.summary,
          durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
          metadata: this.parseMetadata(row.metadata_json),
          checkedAt: this.asIso(row.checked_at),
        };
        result.set(row.target_key, current);
      }
      return result;
    } catch (error) {
      this.logger.warn(
        `Unable to read provider check results: ${this.safeError(error)}`,
      );
      return new Map();
    }
  }

  verificationDepth(targetKey: string): ProviderLayer | 'L1' {
    return this.targetKeys().has(targetKey) ? 'L3' : 'L1';
  }

  private async runDueChecks() {
    if (
      this.running ||
      !(await this.siteConf.getBoolean(
        'dependency_health.provider_checks_enabled',
        true,
      ))
    )
      return;
    this.running = true;
    try {
      await this.db.withConnection(async (conn) => {
        const [lockRows] = await conn.query<any[]>(
          `SELECT GET_LOCK('dashboard:dependency-provider-health', 0) AS acquired`,
        );
        if (Number(lockRows[0]?.acquired) !== 1) return;
        try {
          const definitions = await this.definitions();
          const intervals = {
            L2: await this.siteConf.getNumber(
              'dependency_health.l2_interval_ms',
              300_000,
            ),
            L3: await this.siteConf.getNumber(
              'dependency_health.l3_interval_ms',
              900_000,
            ),
          };
          for (const definition of definitions) {
            for (const layer of ['L2', 'L3'] as ProviderLayer[]) {
              if (
                !(await this.isDue(
                  definition.targetKeys[0],
                  layer,
                  intervals[layer],
                ))
              )
                continue;
              const checkedAt = new Date().toISOString();
              if (
                layer === 'L3' &&
                !(await this.layerPassed(definition.targetKeys[0], 'L2'))
              ) {
                for (const targetKey of definition.targetKeys) {
                  await this.save({
                    targetKey,
                    layer,
                    status: 'SKIPPED',
                    reasonCode: 'L2_NOT_PASSED',
                    summary: 'L2 尚未通过，已跳过 L3',
                    durationMs: null,
                    metadata: null,
                    checkedAt,
                  });
                }
                continue;
              }
              const startedAt = Date.now();
              let outcome: Omit<
                ProviderCheckResult,
                'targetKey' | 'layer' | 'checkedAt'
              >;
              try {
                outcome = await definition.check(layer);
              } catch (error) {
                outcome = this.failure(error, Date.now() - startedAt);
              }
              for (const targetKey of definition.targetKeys) {
                await this.save({ ...outcome, targetKey, layer, checkedAt });
              }
            }
          }
        } finally {
          await conn.query(
            `SELECT RELEASE_LOCK('dashboard:dependency-provider-health')`,
          );
        }
      });
    } catch (error) {
      this.logger.warn(
        `Provider health check round failed: ${this.safeError(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async definitions(): Promise<ProviderDefinition[]> {
    return [
      this.jenkins(['jenkins-hashex', 'jenkins-hashdev'], 'hash-jenkins'),
      this.jenkins(['jenkins-mgbx'], 'mgbx-jenkins'),
      this.jenkins(['jenkins-icoin'], 'icoin-jenkins'),
      this.jenkins(['jenkins-tb'], 'tb-jenkins'),
      this.gitlab(),
      this.grafana(),
      this.cliproxy(),
      this.spotPublish(),
    ];
  }

  private jenkins(
    targetKeys: string[],
    executorKey: string,
  ): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const prefix = `cicd.executors.${executorKey}`;
        const [baseUrl, username, token, timeoutMs] = await Promise.all([
          this.siteConf.getString(`${prefix}.base_url`, ''),
          this.siteConf.getString(`${prefix}.username`, ''),
          this.siteConf.getString(`${prefix}.api_token`, ''),
          this.siteConf.getNumber(`${prefix}.timeout_ms`, 15_000),
        ]);
        if (!baseUrl || !username || !token)
          return this.notConfigured('Jenkins 专用凭据未配置');
        const path =
          layer === 'L2'
            ? '/whoAmI/api/json'
            : '/api/json?tree=nodeName,jobs[name,color,_class]';
        const startedAt = Date.now();
        const response = await this.request(
          new URL(path, this.baseUrl(baseUrl)).toString(),
          {
            auth: { username, password: token },
            timeout: timeoutMs,
          },
        );
        if (layer === 'L2') {
          if (!response.data?.authenticated)
            throw new ProviderValidationError(
              'AUTH_FAILED',
              'Jenkins 专用账号未通过认证',
            );
          return this.pass('Jenkins 专用账号认证正常', Date.now() - startedAt, {
            identity: String(response.data?.name || username),
          });
        }
        if (!Array.isArray(response.data?.jobs))
          throw new ProviderValidationError(
            'INVALID_RESPONSE',
            'Jenkins Job 目录响应无效',
          );
        return this.pass('Jenkins Job 目录读取正常', Date.now() - startedAt, {
          jobCount: response.data.jobs.length,
        });
      },
    };
  }

  private gitlab(): ProviderDefinition {
    return {
      targetKeys: ['gitlab-api'],
      check: async (layer) => {
        const [baseUrl, projectId, token, branch, timeoutMs] =
          await Promise.all([
            this.siteConf.getString('monitoring.requests.gitlab.base_url', ''),
            this.siteConf.getString(
              'monitoring.requests.gitlab.project_id',
              '',
            ),
            this.siteConf.getString('monitoring.requests.gitlab.bot_token', ''),
            this.siteConf.getString(
              'monitoring.requests.gitlab.target_branch',
              '',
            ),
            this.siteConf.getNumber(
              'monitoring.requests.gitlab.timeout_ms',
              15_000,
            ),
          ]);
        if (!baseUrl || !token || (layer === 'L3' && (!projectId || !branch)))
          return this.notConfigured('GitLab Bot 或目标项目配置不完整');
        const path =
          layer === 'L2'
            ? '/user'
            : `/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(branch)}`;
        const startedAt = Date.now();
        const response = await this.request(
          `${baseUrl.replace(/\/+$/, '')}${path}`,
          { headers: { 'PRIVATE-TOKEN': token }, timeout: timeoutMs },
        );
        return layer === 'L2'
          ? this.pass('GitLab Bot 认证正常', Date.now() - startedAt, {
              username: String(response.data?.username || ''),
            })
          : this.pass('GitLab 目标分支读取正常', Date.now() - startedAt, {
              branch: String(response.data?.name || branch),
            });
      },
    };
  }

  private grafana(): ProviderDefinition {
    return {
      targetKeys: ['grafana-mgbx'],
      check: async (layer) => {
        const prefix = 'aiops.logs.environments.mgbx';
        const [baseUrl, token, datasourceUid, timeoutMs] = await Promise.all([
          this.siteConf.getString(`${prefix}.grafana_base_url`, ''),
          this.siteConf.getString(`${prefix}.grafana_token`, ''),
          this.siteConf.getString(`${prefix}.datasource_uid`, ''),
          this.siteConf.getNumber(`${prefix}.timeout_ms`, 15_000),
        ]);
        if (!baseUrl || !token || (layer === 'L3' && !datasourceUid))
          return this.notConfigured(
            'Grafana Service Account 或数据源配置不完整',
          );
        const path =
          layer === 'L2'
            ? '/api/user'
            : `/api/datasources/uid/${encodeURIComponent(datasourceUid)}`;
        const startedAt = Date.now();
        const response = await this.request(
          `${baseUrl.replace(/\/+$/, '')}${path}`,
          { headers: { Authorization: `Bearer ${token}` }, timeout: timeoutMs },
        );
        return layer === 'L2'
          ? this.pass(
              'Grafana Service Account 认证正常',
              Date.now() - startedAt,
              {
                login: String(
                  response.data?.login || response.data?.name || '',
                ),
              },
            )
          : this.pass('Grafana 数据源元数据读取正常', Date.now() - startedAt, {
              datasourceUid: String(response.data?.uid || datasourceUid),
              type: String(response.data?.type || ''),
            });
      },
    };
  }

  private cliproxy(): ProviderDefinition {
    return {
      targetKeys: ['cliproxy-api'],
      check: async (layer) => {
        const [baseUrl, apiKey, model, timeoutMs] = await Promise.all([
          this.siteConf.getString('aiops.cliproxy.base_url', ''),
          this.siteConf.getString('aiops.cliproxy.api_key', ''),
          this.siteConf.getString('aiops.cliproxy.model', 'gpt-5.6-terra'),
          this.siteConf.getNumber('aiops.cliproxy.timeout_ms', 20_000),
        ]);
        if (!baseUrl || !apiKey)
          return this.notConfigured('CLIProxy API Key 未配置');
        const startedAt = Date.now();
        const response = await this.request(
          `${baseUrl.replace(/\/+$/, '')}/models`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: timeoutMs,
          },
        );
        const models = Array.isArray(response.data?.data)
          ? response.data.data
              .map((item: any) => String(item?.id || ''))
              .filter(Boolean)
          : [];
        if (!Array.isArray(response.data?.data))
          throw new ProviderValidationError(
            'INVALID_RESPONSE',
            'CLIProxy 模型目录响应无效',
          );
        if (layer === 'L3' && !models.includes(model))
          throw new ProviderValidationError(
            'BUSINESS_CHECK_FAILED',
            `受控模型 ${model} 不在可用目录中`,
          );
        return this.pass(
          layer === 'L2'
            ? 'CLIProxy API Key 认证正常'
            : 'CLIProxy 受控模型可用',
          Date.now() - startedAt,
          layer === 'L3' ? { model } : { modelCount: models.length },
        );
      },
    };
  }

  private spotPublish(): ProviderDefinition {
    return {
      targetKeys: ['icoin-spot-publish'],
      check: async (layer) => {
        const [signinUrl, username, password] = await Promise.all([
          this.siteConf.getString('cicd.providers.icoin-spot.signin_url', ''),
          this.siteConf.getString('cicd.providers.icoin-spot.username', ''),
          this.siteConf.getString('cicd.providers.icoin-spot.password', ''),
        ]);
        if (!signinUrl || !username || !password)
          return this.notConfigured('iCoin 推包系统专用凭据未配置');
        const startedAt = Date.now();
        const response = await this.request(signinUrl, {
          method: 'POST',
          data: new URLSearchParams({ username, password }).toString(),
          maxRedirects: 0,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          timeout: 30_000,
        });
        if (layer === 'L2')
          return this.pass(
            'iCoin 推包系统专用账号认证正常',
            Date.now() - startedAt,
            null,
          );
        const items = parseSpotPublishCatalog(String(response.data || ''));
        if (!items.length)
          throw new ProviderValidationError(
            'BUSINESS_CHECK_FAILED',
            'iCoin 推包服务目录为空或无法解析',
          );
        return this.pass('iCoin 推包服务目录读取正常', Date.now() - startedAt, {
          serviceCount: items.length,
        });
      },
    };
  }

  private async request(url: string, config: AxiosRequestConfig) {
    const response = await axios.request({
      ...config,
      url,
      validateStatus: () => true,
    });
    if (response.status === 401)
      throw new ProviderValidationError('AUTH_FAILED', '专用凭据认证失败');
    if (response.status === 403)
      throw new ProviderValidationError(
        'PERMISSION_DENIED',
        '专用身份权限不足',
      );
    if (response.status < 200 || response.status >= 300)
      throw new ProviderValidationError(
        'HTTP_ERROR',
        `Provider 返回 HTTP ${response.status}`,
      );
    return response;
  }

  private async isDue(
    targetKey: string,
    layer: ProviderLayer,
    intervalMs: number,
  ) {
    const rows = await this.db.query<any[]>(
      `SELECT checked_at FROM dependency_health_provider_results WHERE target_key=? AND layer=? LIMIT 1`,
      [targetKey, layer],
    );
    if (!rows[0]?.checked_at) return true;
    return (
      Date.now() - new Date(`${rows[0].checked_at}Z`).getTime() >=
      Math.max(60_000, intervalMs)
    );
  }

  private async layerPassed(targetKey: string, layer: ProviderLayer) {
    const rows = await this.db.query<any[]>(
      `SELECT status FROM dependency_health_provider_results WHERE target_key=? AND layer=? LIMIT 1`,
      [targetKey, layer],
    );
    return rows[0]?.status === 'PASS';
  }

  private async save(result: ProviderCheckResult) {
    await this.db.query(
      `INSERT INTO dependency_health_provider_results (target_key,layer,status,reason_code,summary,duration_ms,metadata_json,checked_at)
       VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),reason_code=VALUES(reason_code),summary=VALUES(summary),duration_ms=VALUES(duration_ms),metadata_json=VALUES(metadata_json),checked_at=VALUES(checked_at)`,
      [
        result.targetKey,
        result.layer,
        result.status,
        result.reasonCode,
        result.summary.slice(0, 500),
        result.durationMs,
        result.metadata ? JSON.stringify(result.metadata) : null,
        result.checkedAt.slice(0, 23).replace('T', ' '),
      ],
    );
    await this.db.query(
      `INSERT INTO dependency_health_history (target_key,layer,status,reason_code,duration_ms,checked_at) VALUES (?,?,?,?,?,?)`,
      [result.targetKey, result.layer, result.status, result.reasonCode, result.durationMs, result.checkedAt.slice(0, 23).replace('T', ' ')],
    );
    await this.updateAlertState(result);
  }

  private async updateAlertState(result: ProviderCheckResult) {
    if (!['PASS', 'FAIL'].includes(result.status)) return;
    const threshold = Math.max(1, await this.siteConf.getNumber('dependency_health.alert_failure_threshold', 3));
    await this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>(
        `SELECT state,consecutive_failures FROM dependency_health_alert_states WHERE target_key=? AND layer=? FOR UPDATE`,
        [result.targetKey, result.layer],
      );
      const previous = rows[0] || { state: 'OK', consecutive_failures: 0 };
      const transition = providerAlertTransition(previous.state, Number(previous.consecutive_failures || 0), result.status === 'PASS' ? 'PASS' : 'FAIL', threshold);
      if (result.status === 'PASS') {
        if (transition.eventType === 'RECOVERED') {
          await conn.execute(
            `INSERT INTO dependency_health_alert_events (target_key,layer,event_type,reason_code,summary,created_at) VALUES (?,?,'RECOVERED','OK',?,UTC_TIMESTAMP(3))`,
            [result.targetKey, result.layer, `${result.layer} 检查已恢复：${result.summary}`],
          );
        }
        await conn.execute(
          `INSERT INTO dependency_health_alert_states (target_key,layer,state,consecutive_failures,last_reason_code,last_changed_at) VALUES (?,?,'OK',0,'OK',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE last_changed_at=IF(state='FIRING',UTC_TIMESTAMP(3),last_changed_at),state='OK',consecutive_failures=0,last_reason_code='OK'`,
          [result.targetKey, result.layer],
        );
        return;
      }
      const failures = transition.failures;
      const shouldFire = transition.eventType === 'FIRING';
      if (shouldFire) {
        await conn.execute(
          `INSERT INTO dependency_health_alert_events (target_key,layer,event_type,reason_code,summary,created_at) VALUES (?,?,'FIRING',?,?,UTC_TIMESTAMP(3))`,
          [result.targetKey, result.layer, result.reasonCode, `${result.layer} 已连续失败 ${failures} 次：${result.summary}`],
        );
      }
      await conn.execute(
        `INSERT INTO dependency_health_alert_states (target_key,layer,state,consecutive_failures,last_reason_code,last_changed_at) VALUES (?,?,?,?,?,IF(?='FIRING',UTC_TIMESTAMP(3),NULL)) ON DUPLICATE KEY UPDATE last_changed_at=IF(VALUES(state)<>state,UTC_TIMESTAMP(3),last_changed_at),state=VALUES(state),consecutive_failures=VALUES(consecutive_failures),last_reason_code=VALUES(last_reason_code)`,
        [result.targetKey, result.layer, transition.state, failures, result.reasonCode, shouldFire ? 'FIRING' : 'OK'],
      );
    });
  }

  private targetKeys() {
    return new Set([
      'jenkins-hashex',
      'jenkins-hashdev',
      'jenkins-mgbx',
      'jenkins-icoin',
      'jenkins-tb',
      'gitlab-api',
      'grafana-mgbx',
      'cliproxy-api',
      'icoin-spot-publish',
    ]);
  }
  private pass(
    summary: string,
    durationMs: number,
    metadata: Record<string, unknown> | null,
  ) {
    return {
      status: 'PASS' as const,
      reasonCode: 'OK',
      summary,
      durationMs,
      metadata,
    };
  }
  private notConfigured(summary: string) {
    return {
      status: 'NOT_CONFIGURED' as const,
      reasonCode: 'NOT_CONFIGURED',
      summary,
      durationMs: null,
      metadata: null,
    };
  }
  private failure(error: unknown, durationMs: number) {
    const reasonCode =
      error instanceof ProviderValidationError
        ? error.reasonCode
        : axios.isAxiosError(error)
          ? 'NETWORK_ERROR'
          : 'CHECK_ERROR';
    const summary =
      error instanceof ProviderValidationError
        ? error.message
        : reasonCode === 'NETWORK_ERROR'
          ? 'Provider 网络请求失败或超时'
          : 'Provider 检查执行失败';
    return {
      status: 'FAIL' as const,
      reasonCode,
      summary,
      durationMs,
      metadata: null,
    };
  }
  private baseUrl(value: string) {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new ProviderValidationError(
        'INVALID_CONFIG',
        'Provider 地址配置无效',
      );
    return parsed.toString();
  }
  private parseMetadata(value: unknown) {
    if (!value) return null;
    if (typeof value === 'object') return value as Record<string, unknown>;
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }
  private asIso(value: unknown) {
    const text = String(value || '');
    return text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  }
  private safeError(error: unknown) {
    return error instanceof Error
      ? error.message.slice(0, 300)
      : 'unknown error';
  }
}

class ProviderValidationError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
  ) {
    super(message);
  }
}
