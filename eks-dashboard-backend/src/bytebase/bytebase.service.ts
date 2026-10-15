/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { MfaVerificationService } from '../auth/mfa-verification.service';
import { SiteConfService } from '../site-conf/site-conf.service';

type Actor = { userId: number; username: string; permissions: string[] };
type Identity = 'catalog' | 'reader' | 'submitter' | 'deployer';

@Injectable()
export class BytebaseService {
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
    private readonly mfa: MfaVerificationService,
  ) {}

  async actor(
    authorization: string | undefined,
    permission: string,
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
      username: String(me.username || payload.username),
      permissions,
    };
  }

  private async config(environmentId: string) {
    const rows = await this.db.query<any[]>(
      `SELECT b.*,e.* FROM bytebase_environment_bindings b JOIN bytebase_executors e ON e.executor_key=b.executor_key WHERE b.environment_id=? LIMIT 1`,
      [environmentId],
    );
    const row = rows[0];
    if (!row || !row.enabled)
      throw new ServiceUnavailableException('当前环境未配置 Bytebase 执行器');
    const get = (key: string) => this.siteConf.getString(key, '');
    const baseUrl = (await get(row.base_url_conf_key))
      .trim()
      .replace(/\/+$/, '');
    if (!/^https:\/\//i.test(baseUrl))
      throw new ServiceUnavailableException('Bytebase 必须配置 HTTPS 地址');
    const identities: any = {};
    for (const [name, emailKey, keyKey] of [
      ['catalog', row.catalog_email_conf_key, row.catalog_key_conf_key],
      ['reader', row.reader_email_conf_key, row.reader_key_conf_key],
      ['submitter', row.submitter_email_conf_key, row.submitter_key_conf_key],
      ['deployer', row.deployer_email_conf_key, row.deployer_key_conf_key],
    ])
      identities[name] = { email: await get(emailKey), key: await get(keyKey) };
    return {
      ...row,
      baseUrl,
      identities,
      capabilities:
        typeof row.capabilities_json === 'string'
          ? JSON.parse(row.capabilities_json)
          : row.capabilities_json,
      projectFilter: row.project_filter_json
        ? typeof row.project_filter_json === 'string'
          ? JSON.parse(row.project_filter_json)
          : row.project_filter_json
        : null,
    };
  }

  private async token(c: any, identity: Identity) {
    const i = c.identities[identity];
    if (!i?.email || !i?.key)
      throw new ServiceUnavailableException(`Bytebase ${identity} 凭据未配置`);
    const cacheKey = `${c.executor_key}:${identity}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const r = await axios.post(
      `${c.baseUrl}/v1/auth/login`,
      { email: i.email, password: i.key, web: false },
      { timeout: 15000, validateStatus: () => true },
    );
    if (r.status !== 200 || !r.data?.token)
      throw new ServiceUnavailableException(
        `Bytebase ${identity} 认证失败（HTTP ${r.status}）`,
      );
    this.tokenCache.set(cacheKey, {
      token: String(r.data.token),
      expiresAt: Date.now() + 50 * 60_000,
    });
    return String(r.data.token);
  }

  private async remote(
    c: any,
    identity: Identity,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    data?: unknown,
  ) {
    const token = await this.token(c, identity);
    const r = await axios.request({
      method,
      url: `${c.baseUrl}${path}`,
      data,
      headers: { authorization: `Bearer ${token}` },
      timeout: 20000,
      validateStatus: () => true,
      maxRedirects: 0,
    });
    if (r.status >= 200 && r.status < 300) return r.data;
    const message = String(
      r.data?.message || r.data?.error || `HTTP ${r.status}`,
    ).slice(0, 800);
    if (r.status === 403)
      throw new ForbiddenException(`Bytebase 权限不足：${message}`);
    if (r.status === 404)
      throw new NotFoundException(`Bytebase 资源不存在：${message}`);
    if (r.status === 400)
      throw new BadRequestException(`Bytebase 请求不合法：${message}`);
    throw new BadGatewayException(`Bytebase 调用失败：${message}`);
  }

  private assertProject(c: any, project: string) {
    if (
      c.projectFilter &&
      Array.isArray(c.projectFilter) &&
      !c.projectFilter.includes(project)
    )
      throw new ForbiddenException('项目不在当前环境允许范围内');
  }

  async bindings(authorization?: string) {
    await this.actor(authorization, 'menu:bytebase');
    return this.db.query<any[]>(
      `SELECT b.environment_id,b.executor_key,b.capabilities_json,b.enabled,e.display_name FROM bytebase_environment_bindings b JOIN bytebase_executors e ON e.executor_key=b.executor_key WHERE b.enabled=1 ORDER BY b.environment_id`,
    );
  }
  async catalog(authorization: string | undefined, environmentId: string) {
    await this.actor(authorization, 'bytebase:catalog:read');
    const c = await this.config(environmentId);
    const data = await this.remote(
      c,
      'catalog',
      'GET',
      '/v1/projects?pageSize=1000',
    );
    const projects = (data.projects || []).filter(
      (p: any) => !c.projectFilter || c.projectFilter.includes(p.name),
    );
    return {
      environmentId,
      projects,
      capabilities: c.capabilities,
      jit: {
        supported: false,
        reason: 'Bytebase Free 3.21 不支持 Access Grant/JIT API',
      },
    };
  }
  async databases(
    authorization: string | undefined,
    environmentId: string,
    project: string,
  ) {
    await this.actor(authorization, 'bytebase:catalog:read');
    const c = await this.config(environmentId);
    this.assertProject(c, project);
    return this.remote(
      c,
      'reader',
      'GET',
      `/v1/${project}/databases?pageSize=1000`,
    );
  }
  async issues(
    authorization: string | undefined,
    environmentId: string,
    project: string,
  ) {
    await this.actor(authorization, 'bytebase:catalog:read');
    const c = await this.config(environmentId);
    this.assertProject(c, project);
    return this.remote(
      c,
      'submitter',
      'GET',
      `/v1/${project}/issues?pageSize=100`,
    );
  }
  async diagnostics(authorization: string | undefined, environmentId: string) {
    await this.actor(authorization, 'bytebase:config:manage');
    const c = await this.config(environmentId);
    const started = Date.now();
    const info = await this.remote(c, 'catalog', 'GET', '/v1/actuator/info');
    const projects = await this.remote(
      c,
      'catalog',
      'GET',
      '/v1/projects?pageSize=1',
    );
    await this.token(c, 'reader');
    await this.token(c, 'submitter');
    await this.token(c, 'deployer');
    return {
      ok: true,
      environmentId,
      latencyMs: Date.now() - started,
      version: info.version || null,
      externalUrl: info.externalUrl || null,
      projectProbeCount: (projects.projects || []).length,
      identities: ['catalog', 'reader', 'submitter', 'deployer'],
      jit: 'UNSUPPORTED',
    };
  }
  async requests(authorization?: string) {
    const actor = await this.actor(authorization, 'menu:bytebase');
    const admin = actor.permissions.includes('bytebase:rollout:execute');
    return this.db.query<any[]>(
      `SELECT request_id,environment_id,project_name,database_name,title,sql_sha256,status,actor_username,issue_name,plan_name,rollout_name,issue_status,approval_status,rollout_status,task_summary_json,last_error,release_confirmed_at,last_reconciled_at,terminal_at,created_at,updated_at FROM bytebase_requests ${admin ? '' : 'WHERE actor_user_id=?'} ORDER BY id DESC LIMIT 200`,
      admin ? [] : [actor.userId],
    );
  }
  async request(authorization: string | undefined, requestId: string) {
    const actor = await this.actor(authorization, 'menu:bytebase');
    const rows = await this.db.query<any[]>(
      `SELECT request_id,environment_id,project_name,database_name,title,sql_sha256,status,actor_user_id,actor_username,issue_name,plan_name,rollout_name,issue_status,approval_status,rollout_status,task_summary_json,last_error,release_confirmed_at,last_reconciled_at,terminal_at,created_at,updated_at FROM bytebase_requests WHERE request_id=? LIMIT 1`,
      [requestId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Bytebase 变更申请不存在');
    if (
      row.actor_user_id !== actor.userId &&
      !actor.permissions.includes('bytebase:rollout:execute')
    )
      throw new ForbiddenException('无权查看该申请');
    return row;
  }

  async requestDetail(authorization: string | undefined, requestId: string) {
    const row = await this.request(authorization, requestId);
    if (!row.plan_name || !row.issue_name)
      return {
        request: row,
        issue: null,
        plan: null,
        statement: null,
        statementIntegrity: 'UNAVAILABLE',
        deploymentDiagnostics: [],
        events: [],
      };
    const c = await this.config(row.environment_id);
    const [issue, plan, events] = await Promise.all([
      this.remote(c, 'submitter', 'GET', `/v1/${row.issue_name}`),
      this.remote(c, 'submitter', 'GET', `/v1/${row.plan_name}`),
      this.db.query<any[]>(
        `SELECT event_type,from_status,to_status,summary,created_at FROM bytebase_request_events WHERE request_id=? ORDER BY id DESC LIMIT 100`,
        [requestId],
      ),
    ]);
    const specs = Array.isArray(plan.specs) ? plan.specs : [];
    const sheetName = specs[0]?.changeDatabaseConfig?.sheet;
    let statement: string | null = null;
    let statementIntegrity: 'VERIFIED' | 'CHANGED' | 'UNAVAILABLE' =
      'UNAVAILABLE';
    if (sheetName) {
      const sheet = await this.remote(
        c,
        'submitter',
        'GET',
        `/v1/${sheetName}`,
      );
      statement = Buffer.from(String(sheet.content || ''), 'base64').toString(
        'utf8',
      );
      statementIntegrity =
        createHash('sha256').update(statement).digest('hex') === row.sql_sha256
          ? 'VERIFIED'
          : 'CHANGED';
    }
    const deploymentDiagnostics: any[] = [];
    try {
      const rollout = await this.remote(
        c,
        'deployer',
        'GET',
        `/v1/${row.plan_name}/rollout`,
      );
      const taskNames = new Set(
        (rollout?.stages || []).flatMap((stage: any) =>
          (stage.tasks || []).map((task: any) => String(task.name || '')),
        ),
      );
      const runs = await this.remote(
        c,
        'deployer',
        'GET',
        `/v1/${row.plan_name}/rollout/stages/-/tasks/-/taskRuns`,
      );
      const failedRuns = (runs.taskRuns || [])
        .filter((run: any) =>
          ['FAILED', 'CANCELED'].includes(
            String(run.status || '').toUpperCase(),
          ),
        )
        .filter((run: any) => {
          const taskName = String(run.name || '').split('/taskRuns/')[0];
          return taskNames.size === 0 || taskNames.has(taskName);
        })
        .slice(0, 50);
      for (const run of failedRuns) {
        let entries: any[] = [];
        try {
          const log = await this.remote(
            c,
            'deployer',
            'GET',
            `/v1/${run.name}/log`,
          );
          entries = Array.isArray(log.entries) ? log.entries : [];
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
        deploymentDiagnostics.push(this.summarizeTaskRun(run, entries));
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    return {
      request: row,
      issue,
      plan,
      statement,
      statementIntegrity,
      deploymentDiagnostics,
      events,
    };
  }

  private summarizeTaskRun(run: any, entries: any[]) {
    const timeline = entries.slice(-200).map((entry: any) => {
      const type = String(entry.type || 'UNKNOWN');
      const payload =
        entry.commandExecute ||
        entry.databaseSync ||
        entry.transactionControl ||
        entry.schemaDump ||
        entry.priorBackup ||
        entry.retryInfo ||
        entry.computeDiff ||
        entry.ghostMigration ||
        entry.releaseFileExecute ||
        {};
      const error = String(
        payload?.response?.error || payload?.error || '',
      ).slice(0, 4000);
      return {
        type,
        action:
          type === 'TRANSACTION_CONTROL'
            ? String(payload.type || '')
            : undefined,
        status: error ? 'ERROR' : 'OK',
        error: error || undefined,
        logTime:
          entry.logTime ||
          payload.logTime ||
          payload.response?.logTime ||
          payload.endTime ||
          payload.startTime ||
          null,
      };
    });
    const errors = Array.from(
      new Set(
        [String(run.detail || ''), ...timeline.map((item: any) => item.error)]
          .filter(Boolean)
          .map((value) => String(value).slice(0, 4000)),
      ),
    ).slice(0, 20);
    return {
      name: String(run.name || ''),
      status: String(run.status || 'UNKNOWN'),
      detail: String(run.detail || '').slice(0, 4000) || null,
      startTime: run.startTime || null,
      updateTime: run.updateTime || null,
      errors,
      timeline,
    };
  }

  async cancelRequest(
    authorization: string | undefined,
    requestId: string,
    input: { mfaCode: string; reason?: string },
  ) {
    const actor = await this.actor(authorization, 'bytebase:rollout:execute');
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    const rows = await this.db.query<any[]>(
      `SELECT * FROM bytebase_requests WHERE request_id=? LIMIT 1`,
      [requestId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Bytebase 变更申请不存在');
    if (!row.issue_name || !row.plan_name)
      throw new BadRequestException('该申请缺少 Bytebase Issue 或 Plan');
    if (
      ![
        'AWAITING_ADMIN_CONFIRMATION',
        'RELEASE_CONFIRMED',
        'ROLLOUT_RUNNING',
        'UNKNOWN',
      ].includes(row.status)
    )
      throw new BadRequestException('该申请当前状态不可取消');
    const c = await this.config(row.environment_id);
    const reason =
      input.reason?.trim() || `Dashboard 管理员 ${actor.username} 取消申请`;
    const issueBeforeCancel = await this.remote(
      c,
      'submitter',
      'GET',
      `/v1/${row.issue_name}`,
    );
    if (issueBeforeCancel.draft === true) {
      await this.remote(
        c,
        'submitter',
        'PATCH',
        `/v1/${row.plan_name}?updateMask=state`,
        { name: row.plan_name, state: 'DELETED' },
      );
      await this.db.query(
        `UPDATE bytebase_requests SET status='CANCELLED',issue_status='CANCELED',rollout_status='CANCELLED',last_error=NULL,terminal_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE request_id=?`,
        [requestId],
      );
      await this.recordEvent(
        requestId,
        'CANCELLED',
        row.status,
        'CANCELLED',
        `管理员 ${actor.username} 已关闭 Bytebase Draft Plan 并撤销待确认申请`,
      );
      return { requestId, status: 'CANCELLED', bestEffort: false };
    }
    let activeRollout = false;
    try {
      const rollout = await this.remote(
        c,
        'deployer',
        'GET',
        `/v1/${row.plan_name}/rollout`,
      );
      activeRollout = true;
      for (const stage of rollout?.stages || []) {
        const tasks = Array.isArray(stage.tasks) ? stage.tasks : [];
        const notStarted = tasks
          .filter(
            (task: any) =>
              String(task.status || '').toUpperCase() === 'NOT_STARTED',
          )
          .map((task: any) => String(task.name));
        if (notStarted.length)
          await this.remote(
            c,
            'deployer',
            'POST',
            `/v1/${stage.name}/tasks:batchSkip`,
            { parent: stage.name, tasks: notStarted, reason },
          );
        for (const task of tasks.filter((candidate: any) =>
          ['PENDING', 'RUNNING'].includes(
            String(candidate.status || '').toUpperCase(),
          ),
        )) {
          const runs = await this.remote(
            c,
            'deployer',
            'GET',
            `/v1/${task.name}/taskRuns`,
          );
          const cancellable = (runs.taskRuns || [])
            .filter((run: any) =>
              ['PENDING', 'AVAILABLE', 'RUNNING'].includes(
                String(run.status || '').toUpperCase(),
              ),
            )
            .map((run: any) => String(run.name));
          if (cancellable.length)
            await this.remote(
              c,
              'deployer',
              'POST',
              `/v1/${task.name}/taskRuns:batchCancel`,
              { parent: task.name, taskRuns: cancellable },
            );
        }
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const project = row.issue_name.split('/issues/')[0];
    await this.remote(
      c,
      'submitter',
      'POST',
      `/v1/${project}/issues:batchUpdateStatus`,
      {
        parent: project,
        issues: [row.issue_name],
        status: 'CANCELED',
        reason,
      },
    );
    const nextStatus = activeRollout ? 'CANCEL_REQUESTED' : 'CANCELLED';
    await this.db.query(
      `UPDATE bytebase_requests SET status=?,issue_status='CANCELED',rollout_status=?,last_error=NULL,terminal_at=IF(?='CANCELLED',UTC_TIMESTAMP(3),NULL),updated_at=UTC_TIMESTAMP(3) WHERE request_id=?`,
      [
        nextStatus,
        activeRollout ? 'CANCEL_REQUESTED' : 'CANCELLED',
        nextStatus,
        requestId,
      ],
    );
    await this.recordEvent(
      requestId,
      activeRollout ? 'CANCEL_REQUESTED' : 'CANCELLED',
      row.status,
      nextStatus,
      activeRollout
        ? `管理员 ${actor.username} 已请求停止发布；运行中任务为尽力取消`
        : `管理员 ${actor.username} 已撤销待确认申请`,
    );
    return { requestId, status: nextStatus, bestEffort: activeRollout };
  }

  async createChange(authorization: string | undefined, input: any) {
    const actor = await this.actor(authorization, 'bytebase:change:submit');
    const c = await this.config(input.environmentId);
    this.assertProject(c, input.project);
    const dbs = await this.remote(
      c,
      'reader',
      'GET',
      `/v1/${input.project}/databases?pageSize=1000`,
    );
    if (!(dbs.databases || []).some((d: any) => d.name === input.database))
      throw new BadRequestException('目标数据库不属于所选项目');
    const id = randomUUID(),
      hash = createHash('sha256').update(input.statement).digest('hex');
    await this.db.query(
      `INSERT INTO bytebase_requests (request_id,environment_id,project_name,database_name,title,sql_sha256,status,actor_user_id,actor_username) VALUES (?,?,?,?,?,?,'CREATING',?,?)`,
      [
        id,
        input.environmentId,
        input.project,
        input.database,
        input.title,
        hash,
        actor.userId,
        actor.username,
      ],
    );
    try {
      const sheet = await this.remote(
        c,
        'submitter',
        'POST',
        `/v1/${input.project}/sheets`,
        { content: Buffer.from(input.statement, 'utf8').toString('base64') },
      );
      const plan = await this.remote(
        c,
        'submitter',
        'POST',
        `/v1/${input.project}/plans`,
        {
          title: input.title,
          description: input.description || `Dashboard request ${id}`,
          specs: [
            {
              id: randomUUID(),
              changeDatabaseConfig: {
                targets: [input.database],
                sheet: sheet.name,
              },
            },
          ],
        },
      );
      await this.remote(
        c,
        'submitter',
        'POST',
        `/v1/${plan.name}:runPlanChecks`,
        {},
      );
      const issue = await this.remote(
        c,
        'submitter',
        'POST',
        `/v1/${input.project}/issues`,
        {
          title: input.title,
          description: input.description || `Dashboard request ${id}`,
          type: 'DATABASE_CHANGE',
          plan: plan.name,
          // A submitted Bytebase issue with no native approval flow is
          // auto-approved and may be rolled out immediately. Keep it as a
          // draft until a Dashboard administrator passes MFA confirmation.
          draft: true,
        },
      );
      await this.db.query(
        `UPDATE bytebase_requests SET status='AWAITING_ADMIN_CONFIRMATION',issue_name=?,plan_name=?,updated_at=UTC_TIMESTAMP(3) WHERE request_id=?`,
        [issue.name, plan.name, id],
      );
      return {
        requestId: id,
        status: 'AWAITING_ADMIN_CONFIRMATION',
        issueName: issue.name,
        planName: plan.name,
        sqlSha256: hash,
      };
    } catch (e: any) {
      await this.db.query(
        `UPDATE bytebase_requests SET status='FAILED',last_error=?,updated_at=UTC_TIMESTAMP(3) WHERE request_id=?`,
        [String(e?.message || e).slice(0, 1000), id],
      );
      throw e;
    }
  }

  async createRollout(authorization: string | undefined, input: any) {
    const actor = await this.actor(authorization, 'bytebase:rollout:execute');
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    const c = await this.config(input.environmentId);
    const project = input.plan.split('/plans/')[0];
    this.assertProject(c, project);
    const rows = await this.db.query<any[]>(
      `SELECT * FROM bytebase_requests WHERE environment_id=? AND plan_name=? LIMIT 1`,
      [input.environmentId, input.plan],
    );
    if (!rows[0])
      throw new NotFoundException('未找到与该 Plan 对应的 Dashboard 申请');
    if (rows[0].status !== 'AWAITING_ADMIN_CONFIRMATION')
      throw new BadRequestException('该申请不处于待管理员确认状态');
    if (!rows[0].issue_name)
      throw new BadRequestException('该申请缺少 Bytebase Draft Issue');
    // The draft belongs to the submitter service account. Dashboard admin + MFA
    // is the authorization boundary; submit the draft with its owning identity.
    const plan = await this.remote(c, 'submitter', 'GET', `/v1/${input.plan}`);
    const counts = plan.planCheckRunStatusCount || {};
    if (
      Number(counts.ERROR || 0) > 0 ||
      Number(counts.RUNNING || 0) > 0 ||
      Number(counts.DONE || 0) < 1
    )
      throw new BadRequestException('Plan Check 尚未通过，禁止发布');
    const specs = Array.isArray(plan.specs) ? plan.specs : [];
    if (specs.length !== 1)
      throw new BadRequestException('远端 Plan 结构已变化，禁止发布');
    const change = specs[0]?.changeDatabaseConfig;
    if (
      !change ||
      !Array.isArray(change.targets) ||
      change.targets.length !== 1 ||
      change.targets[0] !== rows[0].database_name ||
      !change.sheet
    )
      throw new BadRequestException('远端 Plan 目标数据库已变化，禁止发布');
    const [issueBeforeRelease, sheet] = await Promise.all([
      this.remote(c, 'submitter', 'GET', `/v1/${rows[0].issue_name}`),
      this.remote(c, 'submitter', 'GET', `/v1/${change.sheet}`),
    ]);
    if (
      issueBeforeRelease.draft !== true ||
      issueBeforeRelease.plan !== input.plan
    )
      throw new BadRequestException(
        '远端 Issue 不再是本申请的 Draft，禁止发布',
      );
    const statement = Buffer.from(String(sheet.content || ''), 'base64');
    const remoteHash = createHash('sha256').update(statement).digest('hex');
    if (remoteHash !== rows[0].sql_sha256)
      throw new BadRequestException('远端 SQL 内容已变化，禁止发布');
    const issue = await this.remote(
      c,
      'submitter',
      'PATCH',
      `/v1/${rows[0].issue_name}?updateMask=draft`,
      { name: rows[0].issue_name, draft: false },
    );
    await this.db.query(
      `UPDATE bytebase_requests SET status='RELEASE_CONFIRMED',release_confirmed_at=UTC_TIMESTAMP(3),last_error=NULL,updated_at=UTC_TIMESTAMP(3) WHERE request_id=?`,
      [rows[0].request_id],
    );
    await this.recordEvent(
      rows[0].request_id,
      'RELEASE_CONFIRMED',
      rows[0].status,
      'RELEASE_CONFIRMED',
      `管理员 ${actor.username} 已通过 MFA 确认发布`,
    );
    return {
      requestId: rows[0].request_id,
      status: 'RELEASE_CONFIRMED',
      issueName: issue.name || rows[0].issue_name,
    };
  }

  async reconcileRequest(requestId: string) {
    const rows = await this.db.query<any[]>(
      `SELECT * FROM bytebase_requests WHERE request_id=? LIMIT 1`,
      [requestId],
    );
    const row = rows[0];
    if (!row?.issue_name || !row?.plan_name) return row;
    const c = await this.config(row.environment_id);
    try {
      const issue = await this.remote(
        c,
        'submitter',
        'GET',
        `/v1/${row.issue_name}`,
      );
      let rollout: any;
      try {
        rollout = await this.remote(
          c,
          'submitter',
          'GET',
          `/v1/${row.plan_name}/rollout`,
        );
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
      const tasks = (rollout?.stages || []).flatMap((stage: any) =>
        (stage.tasks || []).map((task: any) => ({
          name: String(task.name || ''),
          status: String(task.status || 'UNKNOWN'),
        })),
      );
      let nextStatus = this.requestStatus(tasks, Boolean(rollout));
      if (
        row.status === 'CANCEL_REQUESTED' &&
        ['RELEASE_CONFIRMED', 'ROLLOUT_RUNNING'].includes(nextStatus)
      )
        nextStatus = 'CANCEL_REQUESTED';
      const rolloutStatus = rollout
        ? nextStatus === 'SUCCEEDED'
          ? 'DONE'
          : nextStatus === 'FAILED'
            ? 'FAILED'
            : nextStatus === 'CANCELLED'
              ? 'CANCELLED'
              : nextStatus === 'CANCEL_REQUESTED'
                ? 'CANCEL_REQUESTED'
              : 'RUNNING'
        : 'PENDING';
      const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(
        nextStatus,
      );
      await this.db.query(
        `UPDATE bytebase_requests SET status=?,rollout_name=?,issue_status=?,approval_status=?,rollout_status=?,task_summary_json=?,last_error=NULL,last_reconciled_at=UTC_TIMESTAMP(3),terminal_at=IF(?,COALESCE(terminal_at,UTC_TIMESTAMP(3)),NULL),updated_at=IF(status<>?,UTC_TIMESTAMP(3),updated_at) WHERE request_id=?`,
        [
          nextStatus,
          rollout?.name || row.rollout_name,
          issue.status || null,
          issue.approvalStatus || null,
          rolloutStatus,
          JSON.stringify(tasks),
          terminal ? 1 : 0,
          nextStatus,
          requestId,
        ],
      );
      if (nextStatus !== row.status)
        await this.recordEvent(
          requestId,
          terminal ? 'TERMINAL' : 'STATUS_CHANGED',
          row.status,
          nextStatus,
          terminal
            ? `Bytebase 发布终态：${nextStatus}`
            : `Bytebase 发布状态：${nextStatus}`,
        );
      return { ...row, status: nextStatus, tasks };
    } catch (error) {
      const message = String(
        error instanceof Error ? error.message : error,
      ).slice(0, 1000);
      await this.db.query(
        `UPDATE bytebase_requests SET status='UNKNOWN',last_error=?,last_reconciled_at=UTC_TIMESTAMP(3),updated_at=IF(status<>'UNKNOWN',UTC_TIMESTAMP(3),updated_at) WHERE request_id=?`,
        [message, requestId],
      );
      if (row.status !== 'UNKNOWN')
        await this.recordEvent(
          requestId,
          'RECONCILE_UNKNOWN',
          row.status,
          'UNKNOWN',
          '远端状态暂时无法确认；后台只读对账将继续，不会重试发布',
        );
      throw error;
    }
  }

  private requestStatus(tasks: Array<{ status: string }>, hasRollout: boolean) {
    if (!hasRollout || tasks.length === 0) return 'RELEASE_CONFIRMED';
    const statuses = tasks.map((task) => task.status.toUpperCase());
    if (statuses.some((status) => ['FAILED', 'ERROR'].includes(status)))
      return 'FAILED';
    if (statuses.some((status) => ['CANCELED', 'CANCELLED'].includes(status)))
      return 'CANCELLED';
    if (statuses.every((status) => ['DONE', 'SKIPPED'].includes(status)))
      return 'SUCCEEDED';
    return 'ROLLOUT_RUNNING';
  }

  private async recordEvent(
    requestId: string,
    eventType: string,
    fromStatus: string | null,
    toStatus: string | null,
    summary: string,
  ) {
    await this.db.query(
      `INSERT INTO bytebase_request_events (request_id,event_type,from_status,to_status,summary,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))`,
      [requestId, eventType, fromStatus, toStatus, summary.slice(0, 500)],
    );
  }

  async jitCapability(
    authorization: string | undefined,
    environmentId: string,
  ) {
    await this.actor(authorization, 'menu:bytebase');
    await this.config(environmentId);
    return {
      supported: false,
      status: 'UNSUPPORTED',
      reason:
        '当前 Bytebase Free 3.21 的 Access Grant/JIT API 受许可证限制；未使用高权限身份绕过',
    };
  }
}
