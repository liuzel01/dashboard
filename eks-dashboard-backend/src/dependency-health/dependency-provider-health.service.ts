/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

export type DependencyProviderProfile = {
  id: string;
  label: string;
  category: string;
  environmentId: string;
  suggestedUrl: string;
  configured: boolean;
  description: string;
};

type ProviderProfileDefinition = Omit<DependencyProviderProfile, 'configured' | 'suggestedUrl'> & {
  urlKey: string;
  requiredKeys: string[];
  create: (targetKeys: string[]) => ProviderDefinition;
};

type StoredProviderProfile = {
  id: string;
  providerType: string;
  name: string;
  environmentId: string;
  category: string;
  config: Record<string, string>;
  enabled: boolean;
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

  async targetKeys(): Promise<Set<string>> {
    try {
      const rows = await this.db.query<any[]>(`SELECT target_key FROM dependency_health_targets WHERE enabled=1 AND provider_profile IS NOT NULL AND provider_profile<>''`);
      return new Set(rows.map((row) => String(row.target_key)));
    } catch {
      return this.legacyTargetKeys();
    }
  }

  async profiles(): Promise<DependencyProviderProfile[]> {
    try {
      const profiles = await this.storedProfiles();
      return Promise.all(profiles.map(async (profile) => {
        const keys = Object.values(profile.config).filter(Boolean);
        const values = await Promise.all(keys.map((key) => this.siteConf.getString(key, '')));
        return { id: profile.id, label: profile.name, category: profile.category, environmentId: profile.environmentId, suggestedUrl: profile.config.baseUrlKey ? await this.siteConf.getString(profile.config.baseUrlKey, '') : '', configured: keys.length > 0 && values.every((value) => Boolean(String(value).trim())), description: `${profile.providerType} Provider 配置档案` };
      }));
    } catch {
      return Promise.all(this.profileDefinitions().map(async (profile) => {
        const [suggestedUrl, ...required] = await Promise.all([this.siteConf.getString(profile.urlKey, ''), ...profile.requiredKeys.map((key) => this.siteConf.getString(key, ''))]);
        return { id: profile.id, label: profile.label, category: profile.category, environmentId: profile.environmentId, suggestedUrl, configured: required.every((value) => Boolean(String(value).trim())), description: profile.description };
      }));
    }
  }

  providerTypes() {
    return ['jenkins', 'gitlab', 'grafana', 'cliproxy', 'spot-publish', 'bytebase'];
  }

  async profileRecords() {
    return this.storedProfiles();
  }

  async saveProfile(profileId: string | null, input: unknown) {
    const value = input as Record<string, unknown>;
    const id = String(profileId || value?.id || '').trim();
    const providerType = String(value?.providerType || '').trim();
    const name = String(value?.name || '').trim();
    const environmentId = String(value?.environmentId || 'global').trim();
    const category = String(value?.category || providerType).trim();
    const config = this.parseConfig(value?.config);
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new BadRequestException('Invalid provider profile id');
    if (!this.providerTypes().includes(providerType)) throw new BadRequestException('Unsupported provider type');
    if (!name || name.length > 100 || !category || category.length > 64) throw new BadRequestException('Invalid provider profile name or category');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(environmentId) && environmentId !== 'global') throw new BadRequestException('Invalid provider profile environment');
    for (const [field, key] of Object.entries(config)) {
      if (!/^[a-zA-Z][a-zA-Z0-9]*Key$/.test(field) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,191}$/.test(key)) throw new BadRequestException('Invalid SiteConf reference');
    }
    const enabled = value?.enabled !== false;
    const sortOrder = Math.max(0, Math.min(100000, Number(value?.sortOrder) || 0));
    if (profileId) {
      const result: any = await this.db.query(`UPDATE dependency_health_provider_profiles SET provider_type=?,name=?,environment_id=?,category=?,config_json=?,enabled=?,sort_order=? WHERE profile_id=?`, [providerType, name, environmentId, category, JSON.stringify(config), enabled ? 1 : 0, sortOrder, id]);
      if (!Number(result.affectedRows)) throw new BadRequestException('Provider profile not found');
    } else {
      await this.db.query(`INSERT INTO dependency_health_provider_profiles (profile_id,provider_type,name,environment_id,category,config_json,enabled,sort_order) VALUES (?,?,?,?,?,?,?,?)`, [id, providerType, name, environmentId, category, JSON.stringify(config), enabled ? 1 : 0, sortOrder]);
    }
    return { id, providerType, name, environmentId, category, config, enabled, sortOrder };
  }

  async deleteProfile(profileId: string) {
    const references = await this.db.query<any[]>(`SELECT target_key FROM dependency_health_targets WHERE provider_profile=? LIMIT 1`, [profileId]);
    if (references[0]) throw new BadRequestException('Provider profile is still used by a dependency target');
    const result: any = await this.db.query(`DELETE FROM dependency_health_provider_profiles WHERE profile_id=?`, [profileId]);
    if (!Number(result.affectedRows)) throw new BadRequestException('Provider profile not found');
    return { deleted: true };
  }

  async verifyTarget(targetKey: string): Promise<ProviderCheckResult[]> {
    const definition = (await this.definitions()).find((item) => item.targetKeys.includes(targetKey));
    if (!definition) return [];
    const results: ProviderCheckResult[] = [];
    const checkedAt = new Date().toISOString();
    const run = async (layer: ProviderLayer) => {
      const startedAt = Date.now();
      let outcome: Omit<ProviderCheckResult, 'targetKey' | 'layer' | 'checkedAt'>;
      try { outcome = await definition.check(layer); }
      catch (error) { outcome = this.failure(error, Date.now() - startedAt); }
      const result = { ...outcome, targetKey, layer, checkedAt };
      await this.save(result);
      results.push(result);
      return result;
    };
    const l2 = await run('L2');
    if (l2.status === 'PASS') await run('L3');
    else {
      const result: ProviderCheckResult = {
        targetKey, layer: 'L3', status: 'SKIPPED', reasonCode: 'L2_NOT_PASSED',
        summary: 'L2 尚未通过，已跳过 L3', durationMs: null, metadata: null, checkedAt,
      };
      await this.save(result);
      results.push(result);
    }
    return results;
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
    try {
      const rows = await this.db.query<any[]>(`SELECT t.target_key,p.profile_id,p.provider_type,p.config_json FROM dependency_health_targets t JOIN dependency_health_provider_profiles p ON p.profile_id=t.provider_profile AND p.enabled=1 WHERE t.enabled=1 AND t.provider_profile IS NOT NULL AND t.provider_profile<>''`);
      const byProfile = new Map<string, { providerType: string; config: Record<string, string>; targetKeys: string[] }>();
      rows.forEach((row) => {
        const id = String(row.profile_id);
        const current = byProfile.get(id) || { providerType: String(row.provider_type), config: this.parseConfig(row.config_json), targetKeys: [] };
        current.targetKeys.push(String(row.target_key));
        byProfile.set(id, current);
      });
      return [...byProfile.values()].map((profile) => this.definitionFor(profile.providerType, profile.targetKeys, profile.config));
    } catch {
      return this.legacyDefinitions();
    }
  }

  private definitionFor(providerType: string, targetKeys: string[], config: Record<string, string>): ProviderDefinition {
    switch (providerType) {
      case 'jenkins': return this.jenkins(targetKeys, config);
      case 'gitlab': return this.gitlab(targetKeys, config);
      case 'grafana': return this.grafana(targetKeys, config);
      case 'cliproxy': return this.cliproxy(targetKeys, config);
      case 'spot-publish': return this.spotPublish(targetKeys, config);
      case 'bytebase': return this.bytebase(targetKeys, config);
      default: throw new Error(`unsupported provider type: ${providerType}`);
    }
  }

  private async storedProfiles(): Promise<StoredProviderProfile[]> {
    const rows = await this.db.query<any[]>(`SELECT profile_id,provider_type,name,environment_id,category,config_json,enabled FROM dependency_health_provider_profiles ORDER BY sort_order,profile_id`);
    return rows.map((row) => ({ id: String(row.profile_id), providerType: String(row.provider_type), name: String(row.name), environmentId: String(row.environment_id), category: String(row.category), config: this.parseConfig(row.config_json), enabled: Boolean(row.enabled) }));
  }

  private parseConfig(value: unknown): Record<string, string> {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === 'string').map(([key, item]) => [key, String(item).trim()]));
    } catch { return {}; }
  }

  private legacyDefinitions(): ProviderDefinition[] {
    return [
      this.jenkins(['jenkins-hashex', 'jenkins-hashdev'], 'hash-jenkins'),
      this.jenkins(['jenkins-mgbx'], 'mgbx-jenkins'),
      this.jenkins(['jenkins-icoin'], 'icoin-jenkins'),
      this.jenkins(['jenkins-tb'], 'tb-jenkins'),
      this.gitlab(['gitlab-api']),
      this.grafana(['grafana-mgbx']),
      this.cliproxy(['cliproxy-api']),
      this.spotPublish(['icoin-spot-publish']),
      this.bytebase(['bytebase-hashex']),
    ];
  }

  private profileDefinitions(): ProviderProfileDefinition[] {
    return [
      { id: 'jenkins-hash', label: 'Jenkins / Hash', category: 'jenkins', environmentId: 'hashex', urlKey: 'cicd.executors.hash-jenkins.base_url', requiredKeys: ['cicd.executors.hash-jenkins.base_url', 'cicd.executors.hash-jenkins.username', 'cicd.executors.hash-jenkins.api_token'], description: '使用 Hash Jenkins 专用只读账号执行身份和 Job 目录检查', create: (keys) => this.jenkins(keys, 'hash-jenkins') },
      { id: 'jenkins-mgbx', label: 'Jenkins / MGBX', category: 'jenkins', environmentId: 'mgbx', urlKey: 'cicd.executors.mgbx-jenkins.base_url', requiredKeys: ['cicd.executors.mgbx-jenkins.base_url', 'cicd.executors.mgbx-jenkins.username', 'cicd.executors.mgbx-jenkins.api_token'], description: '使用 MGBX Jenkins 专用只读账号执行身份和 Job 目录检查', create: (keys) => this.jenkins(keys, 'mgbx-jenkins') },
      { id: 'jenkins-icoin', label: 'Jenkins / iCoin', category: 'jenkins', environmentId: 'icoin', urlKey: 'cicd.executors.icoin-jenkins.base_url', requiredKeys: ['cicd.executors.icoin-jenkins.base_url', 'cicd.executors.icoin-jenkins.username', 'cicd.executors.icoin-jenkins.api_token'], description: '使用 iCoin Jenkins 专用只读账号执行身份和 Job 目录检查', create: (keys) => this.jenkins(keys, 'icoin-jenkins') },
      { id: 'jenkins-tb', label: 'Jenkins / TB', category: 'jenkins', environmentId: 'tb', urlKey: 'cicd.executors.tb-jenkins.base_url', requiredKeys: ['cicd.executors.tb-jenkins.base_url', 'cicd.executors.tb-jenkins.username', 'cicd.executors.tb-jenkins.api_token'], description: '使用 TB Jenkins 专用只读账号执行身份和 Job 目录检查', create: (keys) => this.jenkins(keys, 'tb-jenkins') },
      { id: 'gitlab-monitoring', label: 'GitLab / 监控配置', category: 'gitlab', environmentId: 'hashex', urlKey: 'monitoring.requests.gitlab.base_url', requiredKeys: ['monitoring.requests.gitlab.base_url', 'monitoring.requests.gitlab.bot_token', 'monitoring.requests.gitlab.project_id', 'monitoring.requests.gitlab.target_branch'], description: '使用 GitLab Bot 验证身份并读取受控分支', create: (keys) => this.gitlab(keys) },
      { id: 'grafana-mgbx', label: 'Grafana / MGBX', category: 'observability', environmentId: 'mgbx', urlKey: 'aiops.logs.environments.mgbx.grafana_base_url', requiredKeys: ['aiops.logs.environments.mgbx.grafana_base_url', 'aiops.logs.environments.mgbx.grafana_token', 'aiops.logs.environments.mgbx.datasource_uid'], description: '使用 Grafana Service Account 读取身份和数据源元数据', create: (keys) => this.grafana(keys) },
      { id: 'cliproxy', label: 'CLIProxy / AI Ops', category: 'aiops', environmentId: 'global', urlKey: 'aiops.cliproxy.base_url', requiredKeys: ['aiops.cliproxy.base_url', 'aiops.cliproxy.api_key'], description: '使用 CLIProxy API Key 读取模型目录', create: (keys) => this.cliproxy(keys) },
      { id: 'icoin-spot-publish', label: 'iCoin / 现货推包', category: 'publish', environmentId: 'icoin', urlKey: 'cicd.providers.icoin-spot.signin_url', requiredKeys: ['cicd.providers.icoin-spot.signin_url', 'cicd.providers.icoin-spot.username', 'cicd.providers.icoin-spot.password'], description: '使用 iCoin 推包专用账号验证登录并读取服务目录', create: (keys) => this.spotPublish(keys) },
      { id: 'bytebase-hashex', label: 'Bytebase / Hashex', category: 'bytebase', environmentId: 'hashex', urlKey: 'bytebase.hashex.base_url', requiredKeys: ['bytebase.hashex.base_url', 'bytebase.hashex.catalog_email', 'bytebase.hashex.catalog_service_key'], description: '使用 Bytebase Catalog 专用账号验证并读取项目目录', create: (keys) => this.bytebase(keys) },
    ];
  }

  private bytebase(targetKeys: string[], config: Record<string, string> = {}): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const [baseUrl, email, serviceKey] = await Promise.all([
          this.siteConf.getString(this.ref(config, 'baseUrlKey', 'bytebase.hashex.base_url'), ''),
          this.siteConf.getString(this.ref(config, 'usernameKey', 'bytebase.hashex.catalog_email'), ''),
          this.siteConf.getString(this.ref(config, 'secretKey', 'bytebase.hashex.catalog_service_key'), ''),
        ]);
        if (!baseUrl || !email || !serviceKey)
          return this.notConfigured('Bytebase Catalog 专用凭据未配置');
        const startedAt = Date.now();
        const login = await this.request(`${baseUrl.replace(/\/+$/, '')}/v1/auth/login`, {
          method: 'POST', data: { email, password: serviceKey, web: false }, timeout: 15_000,
        });
        const token = String(login.data?.token || '');
        if (!token) throw new ProviderValidationError('INVALID_RESPONSE', 'Bytebase 登录响应缺少 Token');
        if (layer === 'L2')
          return this.pass('Bytebase Catalog 专用账号认证正常', Date.now() - startedAt, { identity: email });
        const projects = await this.request(`${baseUrl.replace(/\/+$/, '')}/v1/projects?pageSize=1`, {
          headers: { Authorization: `Bearer ${token}` }, timeout: 15_000,
        });
        if (!Array.isArray(projects.data?.projects))
          throw new ProviderValidationError('INVALID_RESPONSE', 'Bytebase 项目目录响应无效');
        return this.pass('Bytebase 项目目录最小只读检查正常', Date.now() - startedAt, {
          projectProbeCount: projects.data.projects.length,
        });
      },
    };
  }

  private jenkins(targetKeys: string[], executorKeyOrConfig: string | Record<string, string>): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const prefix = typeof executorKeyOrConfig === 'string' ? `cicd.executors.${executorKeyOrConfig}` : '';
        const config = typeof executorKeyOrConfig === 'string' ? {} : executorKeyOrConfig;
        const [baseUrl, username, token, timeoutMs] = await Promise.all([
          this.siteConf.getString(this.ref(config, 'baseUrlKey', `${prefix}.base_url`), ''),
          this.siteConf.getString(this.ref(config, 'usernameKey', `${prefix}.username`), ''),
          this.siteConf.getString(this.ref(config, 'secretKey', `${prefix}.api_token`), ''),
          this.siteConf.getNumber(this.ref(config, 'timeoutKey', `${prefix}.timeout_ms`), 15_000),
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

  private gitlab(targetKeys: string[], config: Record<string, string> = {}): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const [baseUrl, projectId, token, branch, timeoutMs] =
          await Promise.all([
            this.siteConf.getString(this.ref(config, 'baseUrlKey', 'monitoring.requests.gitlab.base_url'), ''),
            this.siteConf.getString(this.ref(config, 'projectIdKey',
              'monitoring.requests.gitlab.project_id'),
              '',
            ),
            this.siteConf.getString(this.ref(config, 'secretKey', 'monitoring.requests.gitlab.bot_token'), ''),
            this.siteConf.getString(this.ref(config, 'targetBranchKey',
              'monitoring.requests.gitlab.target_branch'),
              '',
            ),
            this.siteConf.getNumber(this.ref(config, 'timeoutKey',
              'monitoring.requests.gitlab.timeout_ms'),
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

  private grafana(targetKeys: string[], config: Record<string, string> = {}): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const [baseUrl, token, datasourceUid, timeoutMs] = await Promise.all([
          this.siteConf.getString(this.ref(config, 'baseUrlKey', 'aiops.logs.environments.mgbx.grafana_base_url'), ''),
          this.siteConf.getString(this.ref(config, 'secretKey', 'aiops.logs.environments.mgbx.grafana_token'), ''),
          this.siteConf.getString(this.ref(config, 'datasourceUidKey', 'aiops.logs.environments.mgbx.datasource_uid'), ''),
          this.siteConf.getNumber(this.ref(config, 'timeoutKey', 'aiops.logs.environments.mgbx.timeout_ms'), 15_000),
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

  private cliproxy(targetKeys: string[], config: Record<string, string> = {}): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const [baseUrl, apiKey, model, timeoutMs] = await Promise.all([
          this.siteConf.getString(this.ref(config, 'baseUrlKey', 'aiops.cliproxy.base_url'), ''),
          this.siteConf.getString(this.ref(config, 'secretKey', 'aiops.cliproxy.api_key'), ''),
          this.siteConf.getString(this.ref(config, 'modelKey', 'aiops.cliproxy.model'), 'gpt-5.6-terra'),
          this.siteConf.getNumber(this.ref(config, 'timeoutKey', 'aiops.cliproxy.timeout_ms'), 20_000),
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

  private spotPublish(targetKeys: string[], config: Record<string, string> = {}): ProviderDefinition {
    return {
      targetKeys,
      check: async (layer) => {
        const [signinUrl, username, password] = await Promise.all([
          this.siteConf.getString(this.ref(config, 'baseUrlKey', 'cicd.providers.icoin-spot.signin_url'), ''),
          this.siteConf.getString(this.ref(config, 'usernameKey', 'cicd.providers.icoin-spot.username'), ''),
          this.siteConf.getString(this.ref(config, 'secretKey', 'cicd.providers.icoin-spot.password'), ''),
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

  private legacyTargetKeys() {
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
      'bytebase-hashex',
    ]);
  }
  private ref(config: Record<string, string>, field: string, fallback: string) {
    return String(config[field] || fallback).trim();
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
