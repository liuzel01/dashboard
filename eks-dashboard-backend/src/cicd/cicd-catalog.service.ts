/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import {
  CicdActionType,
  buildParameterSchemaFromRemote,
  compareParameterSchema,
  compileJobDiscoveryPattern,
  JenkinsParameter,
  matchesJobActionFilter,
  parseParameterSchema,
  parseJobActionFilter,
  sensitiveJenkinsParameterNames,
} from './cicd-catalog.policy';
import { CicdSpotPublishService } from './cicd-spot-publish.service';

const MENU_PERMISSION = 'menu:cicd-runs';
const MANAGE_PERMISSION = 'cicd-config:manage';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

type Actor = { userId: number; permissions: string[] };
type ExecutorRow = {
  executor_key: string;
  provider_type: string;
  display_name: string;
  base_url_conf_key: string;
  username_conf_key: string;
  token_conf_key: string;
  timeout_conf_key: string;
  enabled: number;
  read_only: number;
};
type JenkinsConfig = ExecutorRow & {
  baseUrl: string;
  username: string;
  apiToken: string;
  timeoutMs: number;
};
type BindingRow = {
  environment_id: string;
  action_type: CicdActionType;
  provider_type: string;
  executor_key: string | null;
  job_name_pattern: string | null;
  job_action_filter_json: unknown;
  enabled: number;
};

@Injectable()
export class CicdCatalogService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
    private readonly spotPublish: CicdSpotPublishService,
  ) {}

  private async actor(authorization?: string, manage = false): Promise<Actor> {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer '))
      throw new UnauthorizedException('Missing token');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user =
      payload.source === 'keycloak' || typeof payload.sub !== 'number'
        ? await this.access.ensureUserByUsername(payload.username, {
            displayName: payload.displayName,
          })
        : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    const permissions = (me.permissions || []).map(String);
    const required = manage ? MANAGE_PERMISSION : MENU_PERMISSION;
    if (!permissions.includes(required))
      throw new ForbiddenException(`Missing permissions: ${required}`);
    return { userId: Number(me.id), permissions };
  }

  private async executor(executorKey: string) {
    const rows = await this.db.query<ExecutorRow[]>(
      `SELECT executor_key,provider_type,display_name,base_url_conf_key,username_conf_key,token_conf_key,timeout_conf_key,enabled,read_only
       FROM cicd_executors WHERE executor_key=? LIMIT 1`,
      [executorKey],
    );
    if (!rows[0]) throw new NotFoundException('CI/CD 执行器不存在');
    return rows[0];
  }

  private async jenkinsConfig(executorKey: string): Promise<JenkinsConfig> {
    const row = await this.executor(executorKey);
    if (row.provider_type !== 'JENKINS')
      throw new BadRequestException('当前执行器不是 Jenkins Provider');
    const [baseUrlRaw, username, apiToken, timeoutRaw] = await Promise.all([
      this.siteConf.getString(row.base_url_conf_key, ''),
      this.siteConf.getString(row.username_conf_key, ''),
      this.siteConf.getString(row.token_conf_key, ''),
      this.siteConf.getNumber(row.timeout_conf_key, 15_000),
    ]);
    const baseUrl = baseUrlRaw.trim().replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ServiceUnavailableException(
        `执行器 ${executorKey} 的 Jenkins URL 未配置或无效`,
      );
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      !username ||
      !apiToken
    ) {
      throw new ServiceUnavailableException(
        `执行器 ${executorKey} 的 Jenkins 凭据未完成配置`,
      );
    }
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(MIN_TIMEOUT_MS, Number(timeoutRaw) || 15_000),
    );
    return { ...row, baseUrl, username, apiToken, timeoutMs };
  }

  private async jenkinsGet<T>(config: JenkinsConfig, path: string) {
    try {
      return await axios.get<T>(`${config.baseUrl}${path}`, {
        auth: { username: config.username, password: config.apiToken },
        timeout: config.timeoutMs,
        maxRedirects: 0,
        headers: { Accept: 'application/json' },
        validateStatus: (status) => status >= 200 && status < 300,
      });
    } catch (error) {
      const err = error as AxiosError;
      const status = err.response?.status;
      if (status === 401)
        throw new UnauthorizedException(
          `执行器 ${config.executor_key} 的 Jenkins 凭据无效`,
        );
      if (status === 403)
        throw new ForbiddenException(
          `执行器 ${config.executor_key} 无权读取 Jenkins`,
        );
      if (status && status >= 300 && status < 400)
        throw new ServiceUnavailableException(
          `执行器 ${config.executor_key} 被重定向到登录流程`,
        );
      throw new ServiceUnavailableException(
        `执行器 ${config.executor_key} 连接失败：${String(err.message || 'unknown error').slice(0, 300)}`,
      );
    }
  }

  private jobPath(fullName: string) {
    const segments = String(fullName || '')
      .split('/')
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      segments.length === 0 ||
      segments.some((item) => item === '.' || item === '..')
    )
      throw new BadRequestException('Jenkins Job 路径无效');
    return segments.map((item) => `/job/${encodeURIComponent(item)}`).join('');
  }

  private parseRemoteParameters(properties: any[]): JenkinsParameter[] {
    return (properties || [])
      .flatMap((property) =>
        (property?.parameterDefinitions || []).map((parameter: any) => ({
          name: String(parameter?.name || ''),
          type: String(parameter?.type || parameter?._class || ''),
          default: parameter?.defaultParameterValue?.value ?? '',
          choices: Array.isArray(parameter?.choices)
            ? parameter.choices.map(String)
            : undefined,
        })),
      )
      .filter((item) => item.name);
  }

  private async binding(
    environmentId: string,
    actionType: CicdActionType,
  ): Promise<BindingRow & { executor_key: string }> {
    const rows = await this.db.query<BindingRow[]>(
      `SELECT environment_id,action_type,provider_type,executor_key,job_name_pattern,job_action_filter_json,enabled
       FROM cicd_environment_bindings WHERE environment_id=? AND action_type=? LIMIT 1`,
      [environmentId, actionType],
    );
    const binding = rows[0];
    if (!binding)
      throw new NotFoundException('当前环境尚未配置 CI/CD 动作绑定');
    if (!binding.enabled)
      throw new ServiceUnavailableException('当前环境的 CI/CD 动作绑定已停用');
    if (!binding.executor_key)
      throw new ServiceUnavailableException('当前环境没有可用执行器');
    return binding as BindingRow & { executor_key: string };
  }

  private bindingMatcher(binding: BindingRow) {
    return binding.job_name_pattern
      ? compileJobDiscoveryPattern(binding.job_name_pattern)
      : null;
  }

  private matchesBindingJob(binding: BindingRow, jobName: string) {
    const matcher = this.bindingMatcher(binding);
    return (
      (!matcher || matcher.test(jobName)) &&
      matchesJobActionFilter(binding.job_action_filter_json, jobName)
    );
  }

  async discoverJobs(
    authorization: string | undefined,
    environmentId: string,
    actionType: CicdActionType,
    keyword?: string,
  ) {
    await this.actor(authorization);
    const binding = await this.binding(environmentId, actionType);
    const matcher = this.bindingMatcher(binding);
    if (binding.provider_type === 'EXTERNAL_SPOT_PUBLISH') {
      const normalizedKeyword = String(keyword || '')
        .trim()
        .toLowerCase();
      const items = (await this.spotPublish.catalog()).filter(
        (item) =>
          !normalizedKeyword ||
          item.name.toLowerCase().includes(normalizedKeyword),
      );
      return {
        environmentId,
        actionType,
        executorKey: binding.executor_key,
        filterMode: 'ALL' as const,
        pattern: null,
        actionFilter: {},
        total: items.length,
        jobs: items.map((item) => ({
          name: item.name,
          color: 'external',
          disabled: false,
          registered: true,
          catalog: {
            jobKey: `icoin-spot-${item.name}`,
            displayName: item.name,
            serviceKey: item.name,
            enabled: true,
            requiresApproval: true,
            concurrencyPolicy: 'FORBID_SAME_JOB',
          },
        })),
      };
    }
    const config = await this.jenkinsConfig(binding.executor_key);
    const root = await this.jenkinsGet<any>(
      config,
      '/api/json?tree=jobs[name,color,_class]',
    );
    const normalizedKeyword = String(keyword || '')
      .trim()
      .toLowerCase();
    const discovered = (root.data?.jobs || [])
      .filter((job: any) =>
        this.matchesBindingJob(binding, String(job.name || '')),
      )
      .filter(
        (job: any) =>
          !normalizedKeyword ||
          String(job.name || '')
            .toLowerCase()
            .includes(normalizedKeyword),
      )
      .slice(0, 2_000);
    const registered = await this.db.query<any[]>(
      `SELECT job_key,jenkins_job_full_name,display_name,service_key,enabled,requires_approval,concurrency_policy
       FROM cicd_job_catalog WHERE environment_id=? AND action_type=?`,
      [environmentId, actionType],
    );
    const catalog = new Map(
      registered.map((job) => [job.jenkins_job_full_name, job]),
    );
    return {
      environmentId,
      actionType,
      executorKey: binding.executor_key,
      filterMode: matcher ? 'PATTERN' : 'ALL',
      pattern: binding.job_name_pattern,
      actionFilter: parseJobActionFilter(binding.job_action_filter_json),
      total: discovered.length,
      jobs: discovered.map((job: any) => {
        const registeredJob = catalog.get(job.name);
        return {
          name: String(job.name || ''),
          color: job.color || null,
          disabled: job.color === 'disabled',
          registered: !!registeredJob,
          catalog: registeredJob
            ? {
                jobKey: registeredJob.job_key,
                displayName: registeredJob.display_name,
                serviceKey: registeredJob.service_key,
                enabled: !!registeredJob.enabled,
                requiresApproval: !!registeredJob.requires_approval,
                concurrencyPolicy: registeredJob.concurrency_policy,
              }
            : null,
        };
      }),
    };
  }

  async getDiscoveredJobDetail(
    authorization: string | undefined,
    environmentId: string,
    actionType: CicdActionType,
    jobName: string,
  ) {
    await this.actor(authorization);
    const binding = await this.binding(environmentId, actionType);
    const normalizedJobName = String(jobName || '').trim();
    if (binding.provider_type === 'EXTERNAL_SPOT_PUBLISH') {
      const item = (await this.spotPublish.catalog()).find(
        (entry) => entry.name === normalizedJobName,
      );
      if (!item) throw new NotFoundException('服务不在 iCoin 现货推包目录中');
      return {
        environmentId,
        actionType,
        executorKey: binding.executor_key,
        name: item.name,
        color: 'external',
        buildable: true,
        concurrentBuild: false,
        remoteParameters: [
          {
            name: 'GIT_REF',
            type: 'StringParameterDefinition',
            default: item.defaultRef,
          },
          {
            name: 'REGISTRY',
            type: 'ChoiceParameterDefinition',
            default: item.registries[0] || '',
            choices: item.registries,
          },
        ],
        registered: true,
        catalog: {
          jobKey: `icoin-spot-${item.name}`,
          enabled: true,
          requiresApproval: true,
          concurrencyPolicy: 'FORBID_SAME_JOB',
          schema: {
            version: 1,
            parameters: [
              {
                name: 'GIT_REF',
                type: 'git_branch',
                required: true,
                default: item.defaultRef,
              },
              {
                name: 'REGISTRY',
                type: 'enum',
                required: true,
                default: item.registries[0] || '',
                choices: item.registries,
              },
            ],
          },
          reconciliation: {
            matches: true,
            missing: [],
            unexpected: [],
            mismatched: [],
          },
        },
      };
    }
    if (!this.matchesBindingJob(binding, normalizedJobName)) {
      throw new ForbiddenException('该 Job 不属于当前环境允许的发现范围');
    }
    const config = await this.jenkinsConfig(binding.executor_key);
    const detail = await this.jenkinsGet<any>(
      config,
      `${this.jobPath(normalizedJobName)}/api/json?tree=name,url,color,buildable,concurrentBuild,property[_class,parameterDefinitions[name,type,_class,description,defaultParameterValue[value],choices]]`,
    );
    const remoteParameters = this.parseRemoteParameters(
      detail.data?.property || [],
    );
    const catalog = await this.db.query<any[]>(
      `SELECT job_key,parameter_schema_json,enabled,requires_approval,concurrency_policy
       FROM cicd_job_catalog WHERE environment_id=? AND action_type=? AND jenkins_job_full_name=? LIMIT 1`,
      [environmentId, actionType, normalizedJobName],
    );
    const registered = catalog[0];
    return {
      environmentId,
      actionType,
      executorKey: binding.executor_key,
      name: String(detail.data?.name || normalizedJobName),
      color: detail.data?.color || null,
      buildable: !!detail.data?.buildable,
      concurrentBuild: !!detail.data?.concurrentBuild,
      remoteParameters,
      registered: !!registered,
      catalog: registered
        ? {
            jobKey: registered.job_key,
            enabled: !!registered.enabled,
            requiresApproval: !!registered.requires_approval,
            concurrencyPolicy: registered.concurrency_policy,
            schema: parseParameterSchema(registered.parameter_schema_json),
            reconciliation: compareParameterSchema(
              registered.parameter_schema_json,
              remoteParameters,
            ),
          }
        : null,
    };
  }

  async listEnvironmentBindings(authorization?: string) {
    await this.actor(authorization);
    const rows = await this.db.query<any[]>(
      `SELECT b.environment_id,b.action_type,b.provider_type,b.executor_key,b.job_name_pattern,b.job_action_filter_json,b.enabled,
              e.display_name AS executor_display_name,e.read_only
       FROM cicd_environment_bindings b
       LEFT JOIN cicd_executors e ON e.executor_key=b.executor_key
       ORDER BY b.environment_id,b.action_type`,
    );
    return rows.map((row) => ({
      ...row,
      enabled: !!row.enabled,
      read_only: !!row.read_only,
      action_filter: parseJobActionFilter(row.job_action_filter_json),
      job_action_filter_json: undefined,
    }));
  }

  async listJobs(
    authorization: string | undefined,
    environmentId: string,
    actionType: CicdActionType,
    keyword?: string,
  ) {
    await this.actor(authorization);
    const values: any[] = [environmentId, actionType];
    let filter = '';
    if (keyword?.trim()) {
      filter =
        ' AND (display_name LIKE ? OR service_key LIKE ? OR jenkins_job_full_name LIKE ?)';
      const escaped = keyword.trim().replace(/[\\%_]/g, '\\$&');
      values.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }
    const rows = await this.db.query<any[]>(
      `SELECT job_key,environment_id,action_type,executor_key,jenkins_job_full_name,display_name,service_key,
              parameter_schema_json,enabled,requires_approval,concurrency_policy
       FROM cicd_job_catalog WHERE environment_id=? AND action_type=?${filter}
       ORDER BY display_name LIMIT 200`,
      values,
    );
    return rows.map((row) => ({
      ...row,
      enabled: !!row.enabled,
      requires_approval: !!row.requires_approval,
      parameter_schema: parseParameterSchema(row.parameter_schema_json),
      parameter_schema_json: undefined,
    }));
  }

  async listExecutors(authorization?: string) {
    await this.actor(authorization);
    const rows = await this.db.query<ExecutorRow[]>(
      `SELECT executor_key,provider_type,display_name,base_url_conf_key,username_conf_key,token_conf_key,timeout_conf_key,enabled,read_only
       FROM cicd_executors ORDER BY display_name`,
    );
    return Promise.all(
      rows.map(async (row) => {
        const [baseUrl, username, token] = await Promise.all([
          this.siteConf.getString(row.base_url_conf_key, ''),
          this.siteConf.getString(row.username_conf_key, ''),
          this.siteConf.getString(row.token_conf_key, ''),
        ]);
        let host = '';
        try {
          host = baseUrl ? new URL(baseUrl).host : '';
        } catch {
          host = 'invalid';
        }
        return {
          executor_key: row.executor_key,
          provider_type: row.provider_type,
          display_name: row.display_name,
          enabled: !!row.enabled,
          read_only: !!row.read_only,
          configured: !!(baseUrl && username && token),
          host,
        };
      }),
    );
  }

  async diagnose(authorization: string | undefined, executorKey: string) {
    await this.actor(authorization, true);
    const config = await this.jenkinsConfig(executorKey);
    const startedAt = Date.now();
    const [who, root, crumb, queue] = await Promise.all([
      this.jenkinsGet<any>(config, '/whoAmI/api/json'),
      this.jenkinsGet<any>(
        config,
        '/api/json?tree=nodeName,jobs[name,color,_class]',
      ),
      this.jenkinsGet<any>(config, '/crumbIssuer/api/json'),
      this.jenkinsGet<any>(config, '/queue/api/json?tree=items[id]'),
    ]);
    const jobs = root.data?.jobs || [];
    return {
      executorKey,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      version: root.headers['x-jenkins'] || null,
      identity: {
        name: who.data?.name || null,
        authenticated: !!who.data?.authenticated,
        authorities: who.data?.authorities || [],
      },
      api: {
        root: true,
        crumb: !!crumb.data?.crumb && !!crumb.data?.crumbRequestField,
        queue: Array.isArray(queue.data?.items),
      },
      jobCount: jobs.length,
      disabledJobCount: jobs.filter((job: any) => job.color === 'disabled')
        .length,
      readOnly: !!config.read_only,
    };
  }

  async syncRemoteParameterSchema(
    authorization: string | undefined,
    input: {
      environmentId: string;
      actionType: CicdActionType;
      jobName: string;
      confirmation: 'SYNC_REMOTE_PARAMETERS';
    },
  ) {
    await this.actor(authorization, true);
    const binding = await this.binding(input.environmentId, input.actionType);
    if (binding.provider_type !== 'JENKINS')
      throw new BadRequestException('仅 Jenkins Job 支持同步远端参数契约');
    const jobName = String(input.jobName || '').trim();
    if (!jobName || !this.matchesBindingJob(binding, jobName))
      throw new ForbiddenException('该 Job 不属于当前环境允许的发现范围');

    const catalog = await this.db.query<any[]>(
      `SELECT job_key,parameter_schema_json
       FROM cicd_job_catalog
       WHERE environment_id=? AND action_type=? AND jenkins_job_full_name=?
       LIMIT 1`,
      [input.environmentId, input.actionType, jobName],
    );
    const registered = catalog[0];
    if (!registered)
      throw new NotFoundException('只能同步已登记到 Catalog 的 Jenkins Job');

    const config = await this.jenkinsConfig(binding.executor_key);
    const detail = await this.jenkinsGet<any>(
      config,
      `${this.jobPath(jobName)}/api/json?tree=name,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value],choices]]`,
    );
    const remoteParameters = this.parseRemoteParameters(
      detail.data?.property || [],
    );
    const sensitiveNames = sensitiveJenkinsParameterNames(remoteParameters);
    if (sensitiveNames.length) {
      throw new BadRequestException(
        `远端 Job 包含敏感参数，禁止自动同步：${sensitiveNames.join(', ')}`,
      );
    }

    const schema = buildParameterSchemaFromRemote(
      registered.parameter_schema_json,
      remoteParameters,
    );
    const previous = compareParameterSchema(
      registered.parameter_schema_json,
      remoteParameters,
    );
    if (!previous.matches) {
      await this.db.query(
        `UPDATE cicd_job_catalog
         SET parameter_schema_json=?,updated_at=UTC_TIMESTAMP()
         WHERE job_key=? AND environment_id=? AND action_type=? AND jenkins_job_full_name=?`,
        [
          JSON.stringify(schema),
          registered.job_key,
          input.environmentId,
          input.actionType,
          jobName,
        ],
      );
    }
    return {
      jobKey: registered.job_key,
      environmentId: input.environmentId,
      actionType: input.actionType,
      jobName,
      updated: !previous.matches,
      schema,
      remoteParameters,
      reconciliation: compareParameterSchema(schema, remoteParameters),
    };
  }

  async reconcile(
    authorization: string | undefined,
    environmentId: string,
    actionType: CicdActionType,
  ) {
    await this.actor(authorization, true);
    const binding = await this.binding(environmentId, actionType);
    const matcher = this.bindingMatcher(binding);
    const config = await this.jenkinsConfig(binding.executor_key);
    const root = await this.jenkinsGet<any>(
      config,
      '/api/json?tree=jobs[name,color,_class]',
    );
    const discovered = (root.data?.jobs || []).filter((job: any) =>
      this.matchesBindingJob(binding, String(job.name || '')),
    );
    const catalog = await this.listJobs(
      authorization,
      environmentId,
      actionType,
    );
    const reconciliation = await Promise.all(
      catalog.map(async (job: any) => {
        const discoveredJob = discovered.find(
          (item: any) => item.name === job.jenkins_job_full_name,
        );
        if (!discoveredJob)
          return {
            jobKey: job.job_key,
            jobName: job.jenkins_job_full_name,
            exists: false,
            buildable: false,
            schema: {
              matches: false,
              missing: [],
              unexpected: [],
              mismatched: [],
            },
          };
        const detail = await this.jenkinsGet<any>(
          config,
          `${this.jobPath(job.jenkins_job_full_name)}/api/json?tree=buildable,concurrentBuild,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value],choices]]`,
        );
        const remoteParameters = this.parseRemoteParameters(
          detail.data?.property || [],
        );
        return {
          jobKey: job.job_key,
          jobName: job.jenkins_job_full_name,
          exists: true,
          buildable: !!detail.data?.buildable,
          concurrentBuild: !!detail.data?.concurrentBuild,
          remoteParameters,
          schema: compareParameterSchema(
            job.parameter_schema,
            remoteParameters,
          ),
        };
      }),
    );
    const registered = new Set(
      catalog.map((job: any) => job.jenkins_job_full_name),
    );
    return {
      environmentId,
      actionType,
      executorKey: binding.executor_key,
      pattern: binding.job_name_pattern,
      checkedAt: new Date().toISOString(),
      actionFilter: parseJobActionFilter(binding.job_action_filter_json),
      discoveredCount: discovered.length,
      registeredCount: catalog.length,
      unregisteredCount: discovered.filter(
        (job: any) => !registered.has(job.name),
      ).length,
      unregisteredJobs: discovered
        .filter((job: any) => !registered.has(job.name))
        .slice(0, 200)
        .map((job: any) => ({
          name: job.name,
          disabled: job.color === 'disabled',
        })),
      jobs: reconciliation,
    };
  }
}
