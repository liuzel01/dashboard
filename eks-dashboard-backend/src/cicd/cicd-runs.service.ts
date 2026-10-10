/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import {
  CicdActionType,
  compileJobDiscoveryPattern,
  JenkinsParameter,
} from './cicd-catalog.policy';
import {
  maskPersistedParameters,
  parseQueueId,
  redactJenkinsLog,
  TERMINAL_CICD_STATUSES,
  validateJenkinsParameters,
} from './cicd-run.policy';

const VIEW = 'menu:cicd-runs';
const EXECUTE_BUILD = 'cicd-runs:execute-build';
const EXECUTE_PUBLISH = 'cicd-runs:execute-publish';
const CANCEL = 'cicd-runs:cancel';
const TERMINAL = new Set<string>(TERMINAL_CICD_STATUSES);

type Actor = { userId: number; username: string; permissions: string[] };
type RunRow = Record<string, any>;

@Injectable()
export class CicdRunsService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
  ) {}

  private async actor(
    authorization?: string,
    permission = VIEW,
  ): Promise<Actor> {
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
    if (!permissions.includes(permission))
      throw new ForbiddenException(`Missing permissions: ${permission}`);
    return {
      userId: Number(me.id),
      username: String(me.username || payload.username || me.id),
      permissions,
    };
  }

  private async executionContext(
    environmentId: string,
    actionType: CicdActionType,
  ) {
    const rows = await this.db.query<any[]>(
      `SELECT b.environment_id,b.action_type,b.executor_key,b.job_name_pattern,b.enabled AS binding_enabled,
              e.enabled AS executor_enabled,e.provider_type,e.base_url_conf_key,e.username_conf_key,e.token_conf_key,e.timeout_conf_key
       FROM cicd_environment_bindings b JOIN cicd_executors e ON e.executor_key=b.executor_key
       WHERE b.environment_id=? AND b.action_type=? LIMIT 1`,
      [environmentId, actionType],
    );
    const row = rows[0];
    if (!row || !row.binding_enabled || !row.executor_enabled)
      throw new ServiceUnavailableException('当前环境的 CI/CD 执行绑定不可用');
    const [baseUrlValue, username, apiToken, timeoutValue] = await Promise.all([
      this.siteConf.getString(row.base_url_conf_key, ''),
      this.siteConf.getString(row.username_conf_key, ''),
      this.siteConf.getString(row.token_conf_key, ''),
      this.siteConf.getNumber(row.timeout_conf_key, 15_000),
    ]);
    const baseUrl = baseUrlValue.trim().replace(/\/+$/, '');
    if (!baseUrl || !username || !apiToken)
      throw new ServiceUnavailableException('Jenkins 执行器凭据未完成配置');
    return {
      ...row,
      baseUrl,
      username,
      apiToken,
      timeoutMs: Math.min(
        60_000,
        Math.max(1_000, Number(timeoutValue) || 15_000),
      ),
    };
  }

  private jobPath(fullName: string) {
    const segments = String(fullName)
      .split('/')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!segments.length || segments.some((v) => v === '.' || v === '..'))
      throw new BadRequestException('Jenkins Job 路径无效');
    return segments.map((v) => `/job/${encodeURIComponent(v)}`).join('');
  }

  private request(
    config: any,
    method: 'get' | 'post',
    path: string,
    options: any = {},
  ) {
    return axios.request({
      method,
      url: `${config.baseUrl}${path}`,
      auth: { username: config.username, password: config.apiToken },
      timeout: config.timeoutMs,
      maxRedirects: 0,
      validateStatus: () => true,
      ...options,
    });
  }

  private remoteParameters(properties: any[]): JenkinsParameter[] {
    return (properties || [])
      .flatMap((property: any) =>
        (property?.parameterDefinitions || []).map((parameter: any) => ({
          name: String(parameter?.name || ''),
          type: String(parameter?.type || parameter?._class || ''),
          default: parameter?.defaultParameterValue?.value ?? '',
          choices: Array.isArray(parameter?.choices)
            ? parameter.choices.map(String)
            : undefined,
        })),
      )
      .filter((item: JenkinsParameter) => item.name);
  }

  private async getRun(runId: string) {
    const rows = await this.db.query<RunRow[]>(
      'SELECT * FROM cicd_runs WHERE run_id=? LIMIT 1',
      [runId],
    );
    if (!rows[0]) throw new NotFoundException('CI/CD 执行记录不存在');
    return rows[0];
  }

  private view(row: RunRow) {
    return {
      ...row,
      parameters:
        typeof row.parameters_json === 'string'
          ? JSON.parse(row.parameters_json)
          : row.parameters_json,
      parameters_json: undefined,
    };
  }

  async trigger(
    authorization: string | undefined,
    input: {
      environmentId: string;
      actionType: CicdActionType;
      jobName: string;
      clientRequestId: string;
      parameters?: Record<string, unknown>;
      confirmation?: string;
    },
  ) {
    const required =
      input.actionType === 'PACKAGE_PUBLISH' ? EXECUTE_PUBLISH : EXECUTE_BUILD;
    const actor = await this.actor(authorization, required);
    if (
      input.actionType === 'PACKAGE_PUBLISH' &&
      input.confirmation !== '确认推包'
    )
      throw new BadRequestException('制品推包必须输入“确认推包”');
    const existing = await this.db.query<RunRow[]>(
      'SELECT * FROM cicd_runs WHERE client_request_id=? LIMIT 1',
      [input.clientRequestId],
    );
    if (existing[0]) return this.view(existing[0]);
    const context = await this.executionContext(
      input.environmentId,
      input.actionType,
    );
    const jobName = input.jobName.trim();
    if (
      context.job_name_pattern &&
      !compileJobDiscoveryPattern(context.job_name_pattern).test(jobName)
    )
      throw new ForbiddenException('该 Job 不属于当前环境允许的执行范围');
    const jobPath = this.jobPath(jobName);
    const detail = await this.request(
      context,
      'get',
      `${jobPath}/api/json?tree=name,url,color,buildable,property[parameterDefinitions[name,type,_class,defaultParameterValue[value],choices]]`,
    );
    if (detail.status === 404)
      throw new NotFoundException('Jenkins Job 不存在');
    if (detail.status !== 200)
      throw new ServiceUnavailableException(
        `Jenkins Job 校验失败（HTTP ${detail.status}）`,
      );
    if (!detail.data?.buildable || detail.data?.color === 'disabled')
      throw new BadRequestException('Jenkins Job 当前不可构建');
    const definitions = this.remoteParameters(detail.data?.property || []);
    const parameters = validateJenkinsParameters(
      definitions,
      input.parameters || {},
    );
    const persistedParameters = maskPersistedParameters(
      definitions,
      parameters,
    );
    const running = await this.db.query<any[]>(
      `SELECT run_id FROM cicd_runs WHERE environment_id=? AND executor_key=? AND job_name=?
       AND status IN ('TRIGGERING','QUEUED','RUNNING') LIMIT 1`,
      [input.environmentId, context.executor_key, jobName],
    );
    if (running[0])
      throw new ConflictException('该环境的同一 Job 已有执行中的任务');
    const runId = randomUUID();
    await this.db.query(
      `INSERT INTO cicd_runs
       (run_id,client_request_id,action_type,environment_id,executor_key,job_name,parameters_json,status,requested_by_user_id,requested_by_username,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'TRIGGERING',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
      [
        runId,
        input.clientRequestId,
        input.actionType,
        input.environmentId,
        context.executor_key,
        jobName,
        JSON.stringify(persistedParameters),
        actor.userId,
        actor.username,
      ],
    );
    try {
      const crumb = await this.request(context, 'get', '/crumbIssuer/api/json');
      if (
        crumb.status !== 200 ||
        !crumb.data?.crumbRequestField ||
        !crumb.data?.crumb
      )
        throw new ServiceUnavailableException('Jenkins crumb 获取失败');
      const body = new URLSearchParams(parameters).toString();
      const endpoint = Object.keys(parameters).length
        ? 'buildWithParameters'
        : 'build';
      const queued = await this.request(
        context,
        'post',
        `${jobPath}/${endpoint}`,
        {
          data: body,
          headers: {
            [crumb.data.crumbRequestField]: crumb.data.crumb,
            'content-type': 'application/x-www-form-urlencoded',
          },
        },
      );
      const queueId = parseQueueId(queued.headers?.location);
      if (![201, 302].includes(queued.status) || !queueId)
        throw new ServiceUnavailableException(
          `Jenkins 未接受构建请求（HTTP ${queued.status}）`,
        );
      await this.db.query(
        `UPDATE cicd_runs SET queue_id=?,queue_url=?,status='QUEUED',queued_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
        [queueId, String(queued.headers?.location || ''), runId],
      );
      await this.db.query(
        `INSERT INTO cicd_run_events (run_id,event_type,message,created_at) VALUES (?,'QUEUED',?,UTC_TIMESTAMP())`,
        [runId, `Jenkins queue #${queueId}`],
      );
      return this.view(await this.getRun(runId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Jenkins 触发失败';
      await this.db.query(
        `UPDATE cicd_runs SET status='FAILURE',error_summary=?,finished_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
        [message.slice(0, 1000), runId],
      );
      throw error;
    }
  }

  async list(authorization: string | undefined, environmentId?: string) {
    await this.actor(authorization);
    const params: unknown[] = [];
    const where = environmentId ? 'WHERE environment_id=?' : '';
    if (environmentId) params.push(environmentId);
    const rows = await this.db.query<RunRow[]>(
      `SELECT * FROM cicd_runs ${where} ORDER BY id DESC LIMIT 100`,
      params,
    );
    return rows.map((row) => this.view(row));
  }

  async refresh(authorization: string | undefined, runId: string) {
    await this.actor(authorization);
    let row = await this.getRun(runId);
    if (TERMINAL.has(String(row.status))) return this.view(row);
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    if (!row.build_number && row.queue_id) {
      const queue = await this.request(
        context,
        'get',
        `/queue/item/${row.queue_id}/api/json`,
      );
      if (queue.status === 200 && queue.data?.cancelled) {
        await this.db.query(
          `UPDATE cicd_runs SET status='CANCELLED',finished_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
          [runId],
        );
      } else if (queue.status === 200 && queue.data?.executable?.number) {
        const number = Number(queue.data.executable.number);
        await this.db.query(
          `UPDATE cicd_runs SET build_number=?,build_url=?,status='RUNNING',started_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
          [number, String(queue.data.executable.url || ''), runId],
        );
      }
      row = await this.getRun(runId);
    }
    if (row.build_number && !TERMINAL.has(String(row.status))) {
      const build = await this.request(
        context,
        'get',
        `${this.jobPath(row.job_name)}/${row.build_number}/api/json?tree=building,result,url,timestamp,duration`,
      );
      if (build.status === 200) {
        const status = build.data?.building
          ? 'RUNNING'
          : String(build.data?.result || 'UNKNOWN');
        await this.db.query(
          `UPDATE cicd_runs SET status=?,build_url=COALESCE(NULLIF(?,''),build_url),duration_ms=?,finished_at=IF(? IN ('SUCCESS','FAILURE','ABORTED','CANCELLED'),COALESCE(finished_at,UTC_TIMESTAMP()),finished_at),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
          [
            status,
            String(build.data?.url || ''),
            Number(build.data?.duration || 0),
            status,
            runId,
          ],
        );
      }
    }
    return this.view(await this.getRun(runId));
  }

  async log(authorization: string | undefined, runId: string, start = 0) {
    await this.actor(authorization);
    const row = await this.getRun(runId);
    if (!row.build_number) return { text: '', nextStart: start, hasMore: true };
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    const response = await this.request(
      context,
      'get',
      `${this.jobPath(row.job_name)}/${row.build_number}/logText/progressiveText?start=${Math.max(0, start)}`,
      { responseType: 'text' },
    );
    if (response.status !== 200)
      throw new ServiceUnavailableException(
        `Jenkins 日志读取失败（HTTP ${response.status}）`,
      );
    return {
      text: redactJenkinsLog(String(response.data || '').slice(0, 500_000)),
      nextStart: Number(response.headers['x-text-size'] || start),
      hasMore: String(response.headers['x-more-data'] || 'false') === 'true',
    };
  }

  async cancel(authorization: string | undefined, runId: string) {
    const actor = await this.actor(authorization, CANCEL);
    const row = await this.getRun(runId);
    if (TERMINAL.has(String(row.status))) return this.view(row);
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    const crumb = await this.request(context, 'get', '/crumbIssuer/api/json');
    if (crumb.status !== 200)
      throw new ServiceUnavailableException('Jenkins crumb 获取失败');
    const headers = { [crumb.data.crumbRequestField]: crumb.data.crumb };
    const path = row.build_number
      ? `${this.jobPath(row.job_name)}/${row.build_number}/stop`
      : `/queue/cancelItem?id=${row.queue_id}`;
    const response = await this.request(context, 'post', path, { headers });
    if (![200, 201, 302].includes(response.status))
      throw new ServiceUnavailableException(
        `Jenkins 取消失败（HTTP ${response.status}）`,
      );
    await this.db.query(
      `UPDATE cicd_runs SET status='CANCELLED',cancelled_by_user_id=?,finished_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
      [actor.userId, runId],
    );
    return this.view(await this.getRun(runId));
  }
}
