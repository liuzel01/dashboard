import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { SiteConfService } from '../site-conf/site-conf.service';
import { timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';

type Actor = { userId: number; username: string; permissions: string[] };
type RequestInput = { appId: string; resourceType: string; resourceName: string; reason: string };
const MENU = 'menu:monitoring-requests';
const APPROVE = 'monitoring-requests:approve';
const MANAGE = 'monitoring-requests:manage';
const REAL_APPLY_MINUTES = 5;
const REAL_APPLY_MAX_MINUTES = 30;
const JENKINS_TIMEOUT_MIN_MS = 1_000;
const JENKINS_TIMEOUT_MAX_MS = 60_000;
const GITLAB_TIMEOUT_MIN_MS = 1_000;
const GITLAB_TIMEOUT_MAX_MS = 60_000;

@Injectable()
export class MonitoringRequestsService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
  ) {}

  private async actor(authorization?: string): Promise<Actor> {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer ')) throw new UnauthorizedException('Missing token');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user = payload.source === 'keycloak' || typeof payload.sub !== 'number'
      ? await this.access.ensureUserByUsername(payload.username, { displayName: payload.displayName })
      : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    const permissions = (me.permissions || []).map(String);
    if (!permissions.includes(MENU)) throw new ForbiddenException(`Missing permissions: ${MENU}`);
    return { userId: Number(me.id), username: String(me.username), permissions };
  }
  private can(actor: Actor, permission: string) { return actor.permissions.includes(permission); }
  private async read(requestId: string) {
    const rows = await this.db.query<any[]>(`SELECT r.*, u.username AS requester_username, u.display_name AS requester_display_name,
      au.username AS approver_username, au.display_name AS approver_display_name
      FROM monitoring_requests r JOIN users u ON u.id=r.requester_user_id
      LEFT JOIN users au ON au.id=r.approver_user_id WHERE r.request_id=? LIMIT 1`, [requestId]);
    if (!rows[0]) throw new NotFoundException('申请不存在');
    const r = rows[0];
    r.events = await this.db.query<any[]>('SELECT event_type, actor_username, comment, from_status, to_status, created_at FROM monitoring_request_events WHERE request_id=? ORDER BY id ASC', [requestId]);
    return r;
  }
  private owns(actor: Actor, row: any) { return Number(row.requester_user_id) === actor.userId; }
  private assertRead(actor: Actor, row: any) { if (!this.owns(actor, row) && !this.can(actor, APPROVE) && !this.can(actor, MANAGE)) throw new ForbiddenException('仅可查看本人申请'); }
  private async event(requestId: string, actor: Actor, type: string, from: string | null, to: string | null, comment?: string) {
    await this.db.query('INSERT INTO monitoring_request_events (request_id,event_type,actor_user_id,actor_username,from_status,to_status,comment,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())', [requestId, type, actor.userId, actor.username, from, to, comment?.trim() || null]);
  }
  private resourcePath(appId: string) { return `platform/environments/hash/apps/${appId}/monitoring/`; }
  private requireNonBlank(value: string, field: string) {
    if (!value || !value.trim()) throw new BadRequestException(`${field}不能为空`);
  }
  private async approvalTokenMatches(provided?: string) {
    // Managed through SiteConf; an absent/empty value must always fail closed.
    const expected = await this.siteConf.getString('monitoring.requests.jenkins_approval_token', '');
    if (!expected || !provided) return false;
    const a = Buffer.from(expected); const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async list(auth: string | undefined, query: any) {
    const actor = await this.actor(auth); const page = Math.max(1, Number(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const where: string[] = []; const values: any[] = [];
    if (!this.can(actor, APPROVE) && !this.can(actor, MANAGE)) { where.push('r.requester_user_id=?'); values.push(actor.userId); }
    if (query.status) { where.push('r.status=?'); values.push(query.status); }
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await this.db.query<any[]>(`SELECT COUNT(*) total FROM monitoring_requests r ${sql}`, values);
    const items = await this.db.query<any[]>(`SELECT r.*,u.username requester_username,u.display_name requester_display_name,au.username approver_username FROM monitoring_requests r JOIN users u ON u.id=r.requester_user_id LEFT JOIN users au ON au.id=r.approver_user_id ${sql} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { items, total: Number(total[0]?.total || 0), page, pageSize };
  }
  async get(auth: string | undefined, requestId: string) { const actor = await this.actor(auth); const row = await this.read(requestId); this.assertRead(actor,row); return row; }
  async create(auth: string | undefined, input: RequestInput) {
    this.requireNonBlank(input.reason, '申请说明');
    const actor = await this.actor(auth); const requestId = `HASH-MON-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${randomUUID().replace(/-/g,'').slice(0,6).toUpperCase()}`;
    await this.db.query('INSERT INTO monitoring_requests (request_id,status,requester_user_id,app_id,resource_type,resource_name,resource_path,reason,created_at,updated_at) VALUES (?,\'DRAFT\',?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())', [requestId,actor.userId,input.appId,input.resourceType,input.resourceName,this.resourcePath(input.appId),input.reason.trim()]);
    await this.event(requestId,actor,'CREATED',null,'DRAFT'); return this.read(requestId);
  }
  async updateDraft(auth: string | undefined, requestId: string, input: Partial<RequestInput>) {
    const actor = await this.actor(auth); const row = await this.read(requestId); if (!this.owns(actor,row) || row.status !== 'DRAFT') throw new ForbiddenException('仅申请人可编辑草稿');
    const appId = input.appId || row.app_id; await this.db.query('UPDATE monitoring_requests SET app_id=?,resource_type=?,resource_name=?,resource_path=?,reason=?,updated_at=UTC_TIMESTAMP() WHERE request_id=?', [appId,input.resourceType || row.resource_type,input.resourceName || row.resource_name,this.resourcePath(appId),input.reason?.trim() || row.reason,requestId]);
    await this.event(requestId,actor,'DRAFT_UPDATED','DRAFT','DRAFT'); return this.read(requestId);
  }
  async submit(auth: string | undefined, requestId: string, input: { mrIid:number; commitSha:string }) {
    if (!Number.isInteger(input.mrIid) || input.mrIid < 1 || !/^[a-f0-9]{40}$/i.test(input.commitSha)) throw new BadRequestException('MR IID 或 Commit SHA 无效');
    const actor = await this.actor(auth); const row = await this.read(requestId); if (!this.owns(actor,row) || !['DRAFT','REJECTED','WITHDRAWN'].includes(row.status)) throw new ForbiddenException('当前状态不可提交');
    await this.db.query('UPDATE monitoring_requests SET status=\'SUBMITTED\',mr_iid=?,commit_sha=?,approver_user_id=NULL,approval_comment=NULL,approved_at=NULL,updated_at=UTC_TIMESTAMP() WHERE request_id=?', [input.mrIid,input.commitSha.toLowerCase(),requestId]);
    await this.event(requestId,actor,'SUBMITTED',row.status,'SUBMITTED'); return this.read(requestId);
  }
  async decide(auth: string | undefined, requestId: string, status: 'APPROVED'|'REJECTED', comment?: string) {
    const actor = await this.actor(auth); if (!this.can(actor, APPROVE)) throw new ForbiddenException(`Missing permissions: ${APPROVE}`); let row=await this.read(requestId);
    if (row.status !== 'SUBMITTED') throw new BadRequestException('仅已提交申请可审批'); if (this.owns(actor,row)) throw new ForbiddenException('申请人不能审批自己的申请');
    // Approval is intentionally non-mutating for GitLab. The approver authorizes the change;
    // a later explicit Preview action performs the controlled merge and immediately validates
    // the resulting immutable merge commit before any Jenkins execution is queued.
    await this.db.query('UPDATE monitoring_requests SET status=?,approver_user_id=?,approval_comment=?,approved_at=IF(?=\'APPROVED\',UTC_TIMESTAMP(),NULL),updated_at=UTC_TIMESTAMP() WHERE request_id=?', [status, actor.userId, comment?.trim() || null, status, requestId]);
    await this.event(requestId,actor,status === 'APPROVED' ? 'APPROVED' : 'REJECTED','SUBMITTED',status,comment); return this.read(requestId);
  }
  /** A separate approval creates one short-lived real-apply grant. */
  async grantRealApply(auth: string | undefined, requestId: string, validMinutes: number, comment?: string) {
    const actor = await this.actor(auth);
    if (!this.can(actor, APPROVE)) throw new ForbiddenException(`Missing permissions: ${APPROVE}`);
    if (!Number.isInteger(validMinutes) || validMinutes < REAL_APPLY_MINUTES || validMinutes > REAL_APPLY_MAX_MINUTES) {
      throw new BadRequestException(`真实 Apply 授权有效期必须为 ${REAL_APPLY_MINUTES}-${REAL_APPLY_MAX_MINUTES} 分钟`);
    }
    const row = await this.read(requestId);
    if (row.status !== 'APPROVED') throw new BadRequestException('仅已批准申请可授予真实 Apply 权限');
    if (this.owns(actor, row)) throw new ForbiddenException('申请人不能授予自己的真实 Apply 权限');
    await this.db.withTransaction(async conn => {
      await conn.execute('UPDATE monitoring_real_apply_authorizations SET revoked_at=UTC_TIMESTAMP() WHERE request_id=? AND consumed_at IS NULL AND revoked_at IS NULL', [requestId]);
      await conn.execute('INSERT INTO monitoring_real_apply_authorizations (request_id,mr_iid,commit_sha,granted_by_user_id,comment,expires_at,created_at) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE),UTC_TIMESTAMP())', [requestId, Number(row.mr_iid), String(row.commit_sha).toLowerCase(), actor.userId, comment?.trim() || null, validMinutes]);
      const auditComment = '有效期 ' + validMinutes + ' 分钟' + (comment?.trim() ? '：' + comment.trim() : '');
      await conn.execute('INSERT INTO monitoring_request_events (request_id,event_type,actor_user_id,actor_username,from_status,to_status,comment,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())', [requestId, 'REAL_APPLY_GRANTED', actor.userId, actor.username, 'APPROVED', 'APPROVED', auditComment]);
    });
    return { authorized: true, requestId, validMinutes };
  }
  /** Read-only preflight proves a matching one-time grant still exists. */
  async authorizeRealApplyPreflight(requestId: string, input: { mrIid: number; commitSha: string }, token?: string) {
    if (!(await this.approvalTokenMatches(token))) throw new UnauthorizedException('Invalid Jenkins approval token');
    const rows = await this.db.query<any[]>(`SELECT r.status,a.mr_iid,a.commit_sha FROM monitoring_requests r JOIN monitoring_real_apply_authorizations a ON a.request_id=r.request_id WHERE r.request_id=? AND a.consumed_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > UTC_TIMESTAMP() ORDER BY a.id DESC LIMIT 1`, [requestId]);
    const row = rows[0];
    if (!row || row.status !== 'APPROVED') throw new ForbiddenException('No active real Apply authorization for this approved request');
    if (Number(row.mr_iid) !== input.mrIid || String(row.commit_sha).toLowerCase() !== input.commitSha.toLowerCase()) throw new ForbiddenException('Real Apply authorization MR IID/Commit SHA binding does not match this build');
    return { authorized: true, requestId, mrIid: Number(row.mr_iid), commitSha: String(row.commit_sha), dryRun: false };
  }
  /** Jenkins calls this immediately before the only mutating kubectl command. */
  async consumeRealApplyAuthorization(requestId: string, input: { mrIid: number; commitSha: string }, token?: string) {
    if (!(await this.approvalTokenMatches(token))) throw new UnauthorizedException('Invalid Jenkins approval token');
    return this.db.withTransaction(async conn => {
      const [rows] = await conn.execute<any[]>('SELECT r.status,a.id,a.mr_iid,a.commit_sha FROM monitoring_requests r JOIN monitoring_real_apply_authorizations a ON a.request_id=r.request_id WHERE r.request_id=? AND a.consumed_at IS NULL AND a.revoked_at IS NULL ORDER BY a.id DESC LIMIT 1 FOR UPDATE', [requestId]);
      const row = rows[0];
      if (!row || row.status !== 'APPROVED') throw new ForbiddenException('No active real Apply authorization for this approved request');
      if (Number(row.mr_iid) !== input.mrIid || String(row.commit_sha).toLowerCase() !== input.commitSha.toLowerCase()) throw new ForbiddenException('Real Apply authorization MR IID/Commit SHA binding does not match this build');
      const [result] = await conn.execute<any>('UPDATE monitoring_real_apply_authorizations SET consumed_at=UTC_TIMESTAMP() WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()', [row.id]);
      if (Number(result.affectedRows) !== 1) throw new ForbiddenException('Real Apply authorization is expired, revoked, or already consumed');
      await conn.execute('INSERT INTO monitoring_real_apply_executions (request_id,authorization_id,mr_iid,commit_sha,executed_by,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP())', [requestId, row.id, Number(row.mr_iid), String(row.commit_sha).toLowerCase(), 'jenkins']);
      return { authorized: true, requestId, mrIid: Number(row.mr_iid), commitSha: String(row.commit_sha), dryRun: false };
    });
  }
  /**
   * Called only by Jenkins before it runs a pipeline. This is deliberately
   * read-only and preview-only: a missing secret, changed MR/SHA, withdrawn
   * request, or DRY_RUN=false is rejected before any cluster command can run.
   */
  async authorizeDryRun(requestId: string, input: { mrIid: number; commitSha: string; dryRun: boolean }, token?: string) {
    if (!(await this.approvalTokenMatches(token))) throw new UnauthorizedException('Invalid Jenkins approval token');
    if (input.dryRun !== true) throw new ForbiddenException('Dashboard authorization is preview-only; DRY_RUN must be true');
    const row = await this.read(requestId);
    if (row.status !== 'APPROVED') throw new ForbiddenException(`Request status must be APPROVED, received ${row.status}`);
    if (Number(row.mr_iid) !== input.mrIid || String(row.commit_sha).toLowerCase() !== input.commitSha.toLowerCase()) {
      throw new ForbiddenException('Approved MR IID/Commit SHA binding does not match this build');
    }
    return { authorized: true, requestId: row.request_id, mrIid: Number(row.mr_iid), commitSha: String(row.commit_sha), dryRun: true, approvedAt: row.approved_at };
  }
  private async gitlabMergeConfig() {
    const enabled = await this.siteConf.getBoolean('monitoring.requests.gitlab.merge.enabled', false);
    const baseUrl = (await this.siteConf.getString('monitoring.requests.gitlab.base_url', '')).trim().replace(/\/+$/, '');
    const projectId = (await this.siteConf.getString('monitoring.requests.gitlab.project_id', '')).trim();
    const botToken = (await this.siteConf.getString('monitoring.requests.gitlab.bot_token', '')).trim();
    const targetBranch = (await this.siteConf.getString('monitoring.requests.gitlab.target_branch', 'hash-jenkins')).trim();
    const timeoutMs = Math.min(GITLAB_TIMEOUT_MAX_MS, Math.max(GITLAB_TIMEOUT_MIN_MS, await this.siteConf.getNumber('monitoring.requests.gitlab.timeout_ms', 15_000)));
    if (!enabled) return { enabled: false as const };
    if (!/^https?:\/\/[A-Za-z0-9._:-]+(?:\/api\/v4)?$/.test(baseUrl) || !/^\d+$/.test(projectId) || !botToken || targetBranch !== 'hash-jenkins') {
      throw new ServiceUnavailableException('GitLab 受控自动合并器未完成配置');
    }
    return { enabled: true as const, baseUrl, projectId, botToken, targetBranch, timeoutMs };
  }
  private async gitlabRequest<T>(config: Extract<Awaited<ReturnType<MonitoringRequestsService['gitlabMergeConfig']>>, { enabled: true }>, method: 'get'|'put', path: string, data?: unknown) {
    return axios.request<T>({ method, url: config.baseUrl + path, timeout: config.timeoutMs, headers: { 'PRIVATE-TOKEN': config.botToken }, data, validateStatus: () => true });
  }
  private async mergeApprovedRequest(row: any, actor: Actor) {
    const config = await this.gitlabMergeConfig();
    if (!config.enabled) return row;
    const project = encodeURIComponent(config.projectId);
    const mrPath = `/projects/${project}/merge_requests/${Number(row.mr_iid)}`;
    const mrResponse = await this.gitlabRequest<any>(config, 'get', mrPath);
    const mr = mrResponse.data;
    const sourceSha = String(row.commit_sha).toLowerCase();
    const marker = `Dashboard-Request-ID: ${row.request_id}`;
    const bound = mrResponse.status === 200 && mr?.target_branch === config.targetBranch && String(mr?.sha || '').toLowerCase() === sourceSha && String(mr?.description || '').includes(marker);
    if (!bound || !['opened', 'merged'].includes(mr?.state)) {
      throw new BadRequestException('GitLab MR 不满足受控合并条件（目标分支/SHA/申请标记完全匹配，且状态必须为 Open 或已合并）');
    }
    if (mr.state === 'opened') {
      const merged = await this.gitlabRequest<any>(config, 'put', `${mrPath}/merge`, { sha: sourceSha, should_remove_source_branch: false });
      if (![200, 201].includes(merged.status)) {
        const detail = String(merged.data?.message || merged.data?.error || `HTTP ${merged.status}`).slice(0, 800);
        await this.event(row.request_id, actor, 'GITLAB_MERGE_FAILED', 'SUBMITTED', 'SUBMITTED', `GitLab 合并失败：${detail}`);
        throw new BadRequestException(`GitLab 合并失败：${detail}`);
      }
    }
    // GitLab's merge endpoint can return before a subsequent GET observes the merged state.
    // A retry is safe: a matching already-merged MR is reconciled rather than merged again.
    const verified = await this.gitlabRequest<any>(config, 'get', mrPath);
    const mergeSha = String(verified.data?.merge_commit_sha || verified.data?.squash_commit_sha || '').toLowerCase();
    if (verified.status !== 200 || verified.data?.state !== 'merged' || verified.data?.target_branch !== config.targetBranch || !/^[a-f0-9]{40}$/.test(mergeSha)) {
      await this.event(row.request_id, actor, 'GITLAB_MERGE_FAILED', 'SUBMITTED', 'SUBMITTED', 'GitLab 合并后回读未得到有效 merged 状态或 merge commit SHA');
      throw new BadRequestException('GitLab 合并后回读校验失败；未批准该申请');
    }
    const mergedAt = new Date(String(verified.data.merged_at || ''));
    if (Number.isNaN(mergedAt.getTime())) {
      await this.event(row.request_id, actor, 'GITLAB_MERGE_FAILED', 'APPROVED', 'APPROVED', 'GitLab 合并后回读未得到有效 merged_at 时间');
      throw new BadRequestException('GitLab 合并后回读校验失败；未得到有效合并时间');
    }
    return { ...row, commit_sha: mergeSha, gitlab_merged_at: mergedAt, gitlab_merge_commit_sha: mergeSha };
  }

  private async jenkinsConfig() {
    if (!(await this.siteConf.getBoolean('monitoring.requests.jenkins.enabled', false))) throw new ServiceUnavailableException('Dashboard Jenkins 受控执行未启用');
    const baseUrl = (await this.siteConf.getString('monitoring.requests.jenkins.base_url', '')).trim().replace(/\/+$/, '');
    const username = (await this.siteConf.getString('monitoring.requests.jenkins.username', '')).trim();
    const apiToken = (await this.siteConf.getString('monitoring.requests.jenkins.api_token', '')).trim();
    const jobName = (await this.siteConf.getString('monitoring.requests.jenkins.job_name', 'platform-bootstrap-hash')).trim();
    const timeoutMs = Math.min(JENKINS_TIMEOUT_MAX_MS, Math.max(JENKINS_TIMEOUT_MIN_MS, await this.siteConf.getNumber('monitoring.requests.jenkins.timeout_ms', 15_000)));
    if (!baseUrl || !username || !apiToken || jobName !== 'platform-bootstrap-hash') throw new ServiceUnavailableException('Jenkins 受控执行器未完成配置');
    if (!/^https?:\/\/[A-Za-z0-9._:-]+$/.test(baseUrl)) throw new ServiceUnavailableException('Jenkins 地址配置无效');
    return { baseUrl, username, apiToken, jobName, timeoutMs };
  }
  private async jenkinsRequest<T>(method: 'get'|'post', path: string, config: any = {}) {
    const c = await this.jenkinsConfig();
    return axios.request<T>({ method, url: c.baseUrl + path, auth: { username: c.username, password: c.apiToken }, timeout: c.timeoutMs, validateStatus: () => true, ...config });
  }
  private extractDiff(consoleText: string) {
    const completed = consoleText.indexOf('DRY_RUN=true:');
    if (completed < 0) return null;
    const start = consoleText.indexOf('diff -u -N ');
    if (start < 0 || start > completed) return '# No server-side changes detected.\n';
    const diff = consoleText.slice(start, completed).replace(/\/tmp\/[A-Za-z0-9._-]+/g, '<server-dry-run>');
    return diff.length <= 200_000 ? diff : null;
  }
  private async refreshExecutionRecord(ex: any, actor?: Actor) {
    if (!ex.build_number) {
      const q = await this.jenkinsRequest<any>('get', `/queue/item/${ex.queue_id}/api/json`);
      const n = Number(q.data?.executable?.number);
      if (n) {
        await this.db.query('UPDATE monitoring_jenkins_executions SET build_number=?,status="RUNNING",updated_at=UTC_TIMESTAMP() WHERE id=?', [n, ex.id]);
        ex = { ...ex, build_number: n, status: 'RUNNING' };
      }
    }
    if (!ex.build_number) return ex;
    const mustReadConsole = ex.mode === 'preview' && ex.status === 'SUCCESS' && !ex.diff_text;
    if (!mustReadConsole && ['SUCCESS', 'FAILURE', 'ABORTED'].includes(ex.status)) return ex;
    const b = await this.jenkinsRequest<any>('get', `/job/platform-bootstrap-hash/${ex.build_number}/api/json`);
    if (b.data?.building) return ex;
    const status = String(b.data?.result || 'FAILURE');
    const log = (await this.jenkinsRequest<string>('get', `/job/platform-bootstrap-hash/${ex.build_number}/consoleText`, { responseType: 'text' })).data || '';
    const diff = ex.mode === 'preview' && status === 'SUCCESS' ? this.extractDiff(log) : null;
    await this.db.query('UPDATE monitoring_jenkins_executions SET status=?,diff_text=?,finished_at=COALESCE(finished_at,UTC_TIMESTAMP()),updated_at=UTC_TIMESTAMP() WHERE id=?', [status, diff, ex.id]);
    if (actor && !['SUCCESS', 'FAILURE', 'ABORTED'].includes(ex.status) && ['SUCCESS', 'FAILURE', 'ABORTED'].includes(status)) {
      await this.event(ex.request_id, actor, status === 'SUCCESS' ? (ex.mode === 'preview' ? 'PREVIEW_SUCCEEDED' : 'REAL_APPLY_SUCCEEDED') : (ex.mode === 'preview' ? 'PREVIEW_FAILED' : 'REAL_APPLY_FAILED'), 'APPROVED', 'APPROVED', `Jenkins #${ex.build_number} ${status}`);
    }
    return { ...ex, status, diff_text: diff, finished_at: ex.finished_at || new Date() };
  }
  private async refreshMatchingPreview(requestId: string, mrIid: number, commitSha: string) {
    const rows = await this.db.query<any[]>('SELECT * FROM monitoring_jenkins_executions WHERE request_id=? AND mode="preview" AND mr_iid=? AND commit_sha=? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) AND (status NOT IN ("SUCCESS","FAILURE","ABORTED") OR diff_text IS NULL) ORDER BY id DESC', [requestId, mrIid, commitSha]);
    for (const execution of rows) await this.refreshExecutionRecord(execution);
  }
  async startDashboardExecution(auth: string | undefined, requestId: string, mode: 'preview'|'apply', comment?: string, confirmation?: string) {
    const actor = await this.actor(auth); let row = await this.read(requestId); this.assertRead(actor, row);
    if (row.status !== 'APPROVED' || !row.mr_iid || !row.commit_sha) throw new BadRequestException('申请必须为已批准且已绑定 MR/SHA');
    const gitlab = await this.gitlabMergeConfig();
    if (gitlab.enabled && mode === 'preview' && (!row.gitlab_merged_at || String(row.gitlab_merge_commit_sha || '').toLowerCase() !== String(row.commit_sha).toLowerCase())) {
      const merged = await this.mergeApprovedRequest(row, actor);
      await this.db.query('UPDATE monitoring_requests SET commit_sha=?,gitlab_merged_at=?,gitlab_merge_commit_sha=?,gitlab_merge_error=NULL,updated_at=UTC_TIMESTAMP() WHERE request_id=?', [merged.commit_sha, merged.gitlab_merged_at, merged.gitlab_merge_commit_sha, requestId]);
      await this.event(requestId, actor, 'GITLAB_MERGED', 'APPROVED', 'APPROVED', `GitLab MR !${row.mr_iid} 已受控合并；commit ${merged.gitlab_merge_commit_sha}`);
      row = await this.read(requestId);
    }
    if (gitlab.enabled && (!row.gitlab_merged_at || String(row.gitlab_merge_commit_sha || '').toLowerCase() !== String(row.commit_sha).toLowerCase())) {
      throw new BadRequestException('请先通过“生成最终 Diff”完成受控 GitLab 合并，再确认真实执行');
    }
    let applyGrantCreated = false;
    if (mode === 'apply') {
      if (!this.can(actor, APPROVE) || this.owns(actor, row)) throw new ForbiddenException('仅非申请人的审批人可确认真实执行');
      if (confirmation !== 'APPLY' || !comment?.trim()) throw new BadRequestException('真实执行需要输入 APPLY 并填写确认说明');
      // Refresh matching previews here as well as from the UI. A Jenkins build can
      // finish between UI polls; the Apply gate must never reject a completed valid preview
      // merely because the browser has not manually refreshed it yet.
      await this.refreshMatchingPreview(requestId, Number(row.mr_iid), String(row.commit_sha).toLowerCase());
      const preview = await this.db.query<any[]>('SELECT * FROM monitoring_jenkins_executions WHERE request_id=? AND mode="preview" AND status="SUCCESS" AND mr_iid=? AND commit_sha=? AND diff_text IS NOT NULL AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) ORDER BY id DESC LIMIT 1', [requestId, row.mr_iid, String(row.commit_sha).toLowerCase()]);
      if (!preview[0]) throw new BadRequestException('当前 MR/SHA 尚无 30 分钟内成功的最终 Diff 预检');
    } else if (!this.owns(actor, row) && !this.can(actor, APPROVE) && !this.can(actor, MANAGE)) throw new ForbiddenException('无权发起预检');
    const c = await this.jenkinsConfig();
    const crumb = await this.jenkinsRequest<any>('get', '/crumbIssuer/api/json');
    if (crumb.status !== 200 || !crumb.data?.crumbRequestField || !crumb.data?.crumb) throw new ServiceUnavailableException('Jenkins crumb 获取失败');
    if (mode === 'apply') { await this.grantRealApply(auth, requestId, 15, `Dashboard 确认真实执行；预检已通过；${comment!.trim()}`); applyGrantCreated = true; }
    const params = new URLSearchParams({ REQUEST_ID: requestId, MR_IID: String(row.mr_iid), COMMIT_SHA: String(row.commit_sha), APPLICATION_ID: String(row.app_id), DRY_RUN: mode === 'preview' ? 'true' : 'false' });
    let queued: any;
    try { queued = await this.jenkinsRequest<any>('post', `/job/${encodeURIComponent(c.jobName)}/buildWithParameters`, { data: params.toString(), headers: { [crumb.data.crumbRequestField]: crumb.data.crumb, 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 }); }
    catch (err) { if (applyGrantCreated) await this.db.query('UPDATE monitoring_real_apply_authorizations SET revoked_at=UTC_TIMESTAMP() WHERE request_id=? AND consumed_at IS NULL AND revoked_at IS NULL', [requestId]); throw err; }
    const queueUrl = String(queued.headers?.location || '');
    const queueId = Number((queueUrl.match(/\/queue\/item\/(\d+)/) || [])[1]);
    if (![201, 302].includes(queued.status) || !Number.isInteger(queueId)) { if (applyGrantCreated) await this.db.query('UPDATE monitoring_real_apply_authorizations SET revoked_at=UTC_TIMESTAMP() WHERE request_id=? AND consumed_at IS NULL AND revoked_at IS NULL', [requestId]); throw new ServiceUnavailableException('Jenkins 未接受构建请求'); }
    const result = await this.db.query<any>('INSERT INTO monitoring_jenkins_executions (request_id,mode,mr_iid,commit_sha,application_id,queue_id,status,requested_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,"QUEUED",?,UTC_TIMESTAMP(),UTC_TIMESTAMP())', [requestId, mode, row.mr_iid, String(row.commit_sha).toLowerCase(), row.app_id, queueId, actor.userId]);
    await this.event(requestId, actor, mode === 'preview' ? 'PREVIEW_QUEUED' : 'REAL_APPLY_QUEUED', 'APPROVED', 'APPROVED', `Jenkins 队列 #${queueId}`);
    return { id: Number(result.insertId), mode, queueId, status: 'QUEUED' };
  }
  async refreshDashboardExecution(auth: string | undefined, requestId: string, id: number) {
    const actor = await this.actor(auth); const row = await this.read(requestId); this.assertRead(actor, row);
    const rows = await this.db.query<any[]>('SELECT * FROM monitoring_jenkins_executions WHERE id=? AND request_id=? LIMIT 1', [id, requestId]);
    if (!rows[0]) throw new NotFoundException('执行记录不存在');
    await this.refreshExecutionRecord(rows[0], actor);
    return (await this.db.query<any[]>('SELECT id,mode,mr_iid,commit_sha,application_id,queue_id,build_number,status,diff_text,created_at,updated_at,finished_at FROM monitoring_jenkins_executions WHERE id=?', [id]))[0];
  }
  async listDashboardExecutions(auth: string | undefined, requestId: string) { const actor=await this.actor(auth); const row=await this.read(requestId); this.assertRead(actor,row); return this.db.query<any[]>('SELECT id,mode,mr_iid,commit_sha,application_id,queue_id,build_number,status,diff_text,created_at,updated_at,finished_at FROM monitoring_jenkins_executions WHERE request_id=? ORDER BY id DESC',[requestId]); }
  async withdraw(auth: string | undefined, requestId: string, comment?: string) {
    const actor=await this.actor(auth); const row=await this.read(requestId); if (!this.owns(actor,row) || !['DRAFT','SUBMITTED','REJECTED'].includes(row.status)) throw new ForbiddenException('当前状态不可撤回');
    await this.db.query('UPDATE monitoring_requests SET status=\'WITHDRAWN\',updated_at=UTC_TIMESTAMP() WHERE request_id=?',[requestId]); await this.event(requestId,actor,'WITHDRAWN',row.status,'WITHDRAWN',comment); return this.read(requestId);
  }
}
