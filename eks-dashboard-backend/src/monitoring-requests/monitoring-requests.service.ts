import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
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
    const actor = await this.actor(auth); if (!this.can(actor, APPROVE)) throw new ForbiddenException(`Missing permissions: ${APPROVE}`); const row=await this.read(requestId);
    if (row.status !== 'SUBMITTED') throw new BadRequestException('仅已提交申请可审批'); if (this.owns(actor,row)) throw new ForbiddenException('申请人不能审批自己的申请');
    await this.db.query('UPDATE monitoring_requests SET status=?,approver_user_id=?,approval_comment=?,approved_at=IF(?=\'APPROVED\',UTC_TIMESTAMP(),NULL),updated_at=UTC_TIMESTAMP() WHERE request_id=?', [status,actor.userId,comment?.trim() || null,status,requestId]);
    await this.event(requestId,actor,status === 'APPROVED' ? 'APPROVED' : 'REJECTED','SUBMITTED',status,comment); return this.read(requestId);
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
  async withdraw(auth: string | undefined, requestId: string, comment?: string) {
    const actor=await this.actor(auth); const row=await this.read(requestId); if (!this.owns(actor,row) || !['DRAFT','SUBMITTED','REJECTED'].includes(row.status)) throw new ForbiddenException('当前状态不可撤回');
    await this.db.query('UPDATE monitoring_requests SET status=\'WITHDRAWN\',updated_at=UTC_TIMESTAMP() WHERE request_id=?',[requestId]); await this.event(requestId,actor,'WITHDRAWN',row.status,'WITHDRAWN',comment); return this.read(requestId);
  }
}
