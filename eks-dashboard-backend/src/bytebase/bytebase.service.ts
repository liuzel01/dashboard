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

  private async actor(
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
      `SELECT request_id,environment_id,project_name,database_name,title,sql_sha256,status,actor_username,issue_name,plan_name,rollout_name,last_error,created_at,updated_at FROM bytebase_requests ${admin ? '' : 'WHERE actor_user_id=?'} ORDER BY id DESC LIMIT 200`,
      admin ? [] : [actor.userId],
    );
  }
  async request(authorization: string | undefined, requestId: string) {
    const actor = await this.actor(authorization, 'menu:bytebase');
    const rows = await this.db.query<any[]>(
      `SELECT request_id,environment_id,project_name,database_name,title,sql_sha256,status,actor_user_id,actor_username,issue_name,plan_name,rollout_name,last_error,created_at,updated_at FROM bytebase_requests WHERE request_id=? LIMIT 1`,
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
    if (Number(counts.ERROR || 0) > 0 || Number(counts.RUNNING || 0) > 0)
      throw new BadRequestException('Plan Check 尚未通过，禁止发布');
    const issue = await this.remote(
      c,
      'submitter',
      'PATCH',
      `/v1/${rows[0].issue_name}?updateMask=draft`,
      { name: rows[0].issue_name, draft: false },
    );
    await this.db.query(
      `UPDATE bytebase_requests SET status='RELEASE_CONFIRMED',updated_at=UTC_TIMESTAMP(3) WHERE request_id=?`,
      [rows[0].request_id],
    );
    return {
      requestId: rows[0].request_id,
      status: 'RELEASE_CONFIRMED',
      issueName: issue.name || rows[0].issue_name,
    };
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
