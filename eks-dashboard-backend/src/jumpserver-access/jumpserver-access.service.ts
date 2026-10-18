/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { SiteConfService } from '../site-conf/site-conf.service';

type Actor = { userId: number; username: string; permissions: string[] };

@Injectable()
export class JumpserverAccessService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
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
      username: String(me.username),
      permissions,
    };
  }

  private async config(identity: 'reader' | 'grant') {
    const rows = await this.db.query<any[]>(
      'SELECT * FROM jumpserver_providers WHERE provider_key=? AND enabled=1 LIMIT 1',
      ['primary'],
    );
    const row = rows[0];
    if (!row)
      throw new ServiceUnavailableException('JumpServer Provider 未启用');
    const baseUrl = (await this.siteConf.getString(row.base_url_conf_key, ''))
      .trim()
      .replace(/\/+$/, '');
    const portalUrl = (
      await this.siteConf.getString(row.portal_url_conf_key, '')
    )
      .trim()
      .replace(/\/+$/, '');
    const id = await this.siteConf.getString(
      identity === 'reader' ? row.reader_id_conf_key : row.grant_id_conf_key,
      '',
    );
    const secret = await this.siteConf.getString(
      identity === 'reader'
        ? row.reader_secret_conf_key
        : row.grant_secret_conf_key,
      '',
    );
    for (const [label, value] of [
      ['base URL', baseUrl],
      ['Access Key ID', id],
      ['Access Key Secret', secret],
    ])
      if (!value)
        throw new ServiceUnavailableException(
          `JumpServer ${identity} ${label} 未配置`,
        );
    const parsed = new URL(baseUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new ServiceUnavailableException(
        'JumpServer 必须配置为无用户信息的 HTTPS 地址',
      );
    return { ...row, baseUrl, portalUrl: portalUrl || baseUrl, id, secret };
  }

  private async remote(
    identity: 'reader' | 'grant',
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    data?: unknown,
  ) {
    const allowedGet = [
      '/api/health/',
      '/api/v1/users/profile/',
      '/api/v1/users/users/',
      '/api/v1/users/groups/',
      '/api/v1/assets/nodes/',
      '/api/v1/assets/assets/',
      '/api/v1/assets/platforms/',
      '/api/v1/accounts/accounts/',
      '/api/v1/perms/asset-permissions/',
      '/api/v1/perms/users/',
    ];
    const allowedWrite = ['/api/v1/perms/asset-permissions/'];
    if (method === 'GET' && !allowedGet.some((p) => path.startsWith(p)))
      throw new BadRequestException('JumpServer endpoint 不在只读 allowlist');
    if (
      method !== 'GET' &&
      (identity !== 'grant' || !allowedWrite.some((p) => path.startsWith(p)))
    )
      throw new ForbiddenException('JumpServer 写 endpoint 不在 allowlist');
    const c = await this.config(identity);
    const date = new Date().toUTCString();
    const signing = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${date}`;
    const signature = createHmac('sha256', c.secret)
      .update(signing)
      .digest('base64');
    const response = await axios.request({
      method,
      url: `${c.baseUrl}${path}`,
      data,
      timeout: 15_000,
      maxContentLength: 5_000_000,
      validateStatus: () => true,
      headers: {
        Accept: 'application/json',
        Date: date,
        Authorization: `Signature keyId="${c.id}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}"`,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (response.status < 200 || response.status >= 300)
      throw new ServiceUnavailableException(
        `JumpServer ${identity} 请求失败（HTTP ${response.status}）`,
      );
    return response.data;
  }

  async diagnostics(authorization?: string) {
    await this.actor(authorization, 'jumpserver:config:manage');
    const result: any = {
      providerKey: 'primary',
      communityEdition: true,
      reader: {},
      grant: {},
    };
    for (const identity of ['reader', 'grant'] as const) {
      try {
        const profile = await this.remote(
          identity,
          'GET',
          '/api/v1/users/profile/',
        );
        result[identity] = {
          ok: true,
          username: profile.username,
          serviceAccount: !!profile.is_service_account,
          roles: (profile.system_roles || []).map(
            (r: any) => r.display_name || r.name,
          ),
        };
      } catch (e: any) {
        result[identity] = {
          ok: false,
          error: String(e?.message || e).slice(0, 200),
        };
      }
    }
    return result;
  }

  async catalog(authorization: string | undefined, kind: string, keyword = '') {
    await this.actor(authorization, 'jumpserver:config:manage');
    const map: Record<string, string> = {
      users: '/api/v1/users/users/',
      groups: '/api/v1/users/groups/',
      nodes: '/api/v1/assets/nodes/',
      assets: '/api/v1/assets/assets/',
      permissions: '/api/v1/perms/asset-permissions/',
    };
    if (!map[kind])
      throw new BadRequestException('不支持的 JumpServer 目录类型');
    const query = new URLSearchParams({ limit: '200', offset: '0' });
    if (keyword.trim()) query.set('search', keyword.trim());
    // JumpServer Community Edition's built-in System Auditor can read users
    // and assets, but returns 403 for node/group catalogs. Keep the broader
    // Grant Manager constrained to the same GET allowlist for those catalogs.
    const identity = ['groups', 'nodes', 'permissions'].includes(kind)
      ? 'grant'
      : 'reader';
    const data = await this.remote(identity, 'GET', `${map[kind]}?${query}`);
    const results = (data.results || []).filter(
      (value: any) =>
        kind !== 'permissions' ||
        (value.is_valid !== false &&
          value.is_active !== false &&
          !String(value.name || '').startsWith('dashboard:')),
    );
    return {
      kind,
      count: results.length,
      items: results.map((v: any) => ({
        id: String(v.id),
        name: String(v.name || v.username || ''),
        username: v.username ? String(v.username) : undefined,
        address: kind === 'assets' ? String(v.address || '') : undefined,
        isActive: v.is_active !== false,
      })),
    };
  }

  async configuration(authorization?: string) {
    await this.actor(authorization, 'jumpserver:config:manage');
    const [mappings, userBindings] = await Promise.all([
      this.db.query<any[]>(
        `SELECT m.*,u.username AS dashboard_username FROM jumpserver_identity_mappings m JOIN users u ON u.id=m.dashboard_user_id ORDER BY m.id DESC`,
      ),
      this.db.query<any[]>(
        `SELECT ub.dashboard_user_id,ub.bundle_id,ub.enabled,u.username dashboard_username,b.name bundle_name,
                b.accounts_json,b.protocols_json,b.actions_json,
                b.source_permission_id,b.source_permission_name,b.source_snapshot_hash,
                GROUP_CONCAT(DISTINCT CONCAT(t.target_type,':',t.remote_id,':',t.remote_name) SEPARATOR '\n') targets
           FROM jumpserver_user_bundle_bindings ub
           JOIN users u ON u.id=ub.dashboard_user_id
           JOIN jumpserver_access_bundles b ON b.id=ub.bundle_id
           LEFT JOIN jumpserver_bundle_targets t ON t.bundle_id=b.id
          WHERE ub.provider_key='primary'
          GROUP BY ub.provider_key,ub.dashboard_user_id,ub.bundle_id,ub.enabled,u.username,b.name,b.accounts_json,b.protocols_json,b.actions_json,b.source_permission_id,b.source_permission_name,b.source_snapshot_hash
          ORDER BY ub.updated_at DESC`,
      ),
    ]);
    return {
      mappings,
      userBindings: userBindings.map((binding) => ({
        ...binding,
        accounts: this.json(binding.accounts_json),
        protocols: this.json(binding.protocols_json),
        actions: this.json(binding.actions_json),
        targets: this.lines(binding.targets),
      })),
    };
  }

  async permissionTemplate(authorization: string | undefined, id: string) {
    await this.actor(authorization, 'jumpserver:config:manage');
    return this.loadPermissionTemplate(id);
  }

  private async loadPermissionTemplate(id: string) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(String(id || '')))
      throw new BadRequestException('Asset Permission ID 不合法');
    const detail = await this.remote(
      'grant',
      'GET',
      `/api/v1/perms/asset-permissions/${encodeURIComponent(id)}/`,
    );
    const name = String(detail.name || '').trim();
    if (!name || detail.is_valid === false || detail.is_active === false)
      throw new BadRequestException('Asset Permission 不存在或已失效');
    if (name.startsWith('dashboard:'))
      throw new BadRequestException('不能将 Dashboard 受管授权作为模板');
    const targets = [
      ...(Array.isArray(detail.assets) ? detail.assets : []).map((value: any) =>
        this.targetRef('ASSET', value),
      ),
      ...(Array.isArray(detail.nodes) ? detail.nodes : []).map((value: any) =>
        this.targetRef('NODE', value),
      ),
    ];
    const accounts = this.strings(detail.accounts);
    const protocols = this.strings(detail.protocols);
    const actions = this.actionStrings(detail.actions);
    if (
      !targets.length ||
      !accounts.length ||
      !protocols.length ||
      !actions.length
    )
      throw new BadRequestException(
        'Asset Permission 缺少可复用的资产、账号、协议或动作范围',
      );
    const risks: string[] = [];
    if (accounts.includes('@ALL')) risks.push('允许目标范围内的全部账号');
    if (protocols.includes('all')) risks.push('允许全部协议');
    const elevated = actions.filter((value) => value !== 'connect');
    if (elevated.length) risks.push(`包含高风险动作：${elevated.join(', ')}`);
    if (targets.filter((target) => target.type === 'NODE').length)
      risks.push('包含节点范围；节点新增资产可能自动进入授权范围');
    return {
      id: String(detail.id || id),
      name,
      targets,
      accounts,
      protocols,
      actions,
      dateExpired: detail.date_expired || null,
      risks,
    };
  }

  async upsertMapping(authorization: string | undefined, input: any) {
    const actor = await this.actor(authorization, 'jumpserver:config:manage');
    const remote = await this.remote(
      'reader',
      'GET',
      `/api/v1/users/users/?username=${encodeURIComponent(String(input.remoteUsername || ''))}&limit=20&offset=0`,
    );
    const match = (remote.results || []).find(
      (u: any) => String(u.username) === String(input.remoteUsername),
    );
    if (!match || match.is_active === false)
      throw new BadRequestException('JumpServer 用户不存在或已禁用');
    await this.db.query(
      `INSERT INTO jumpserver_identity_mappings(provider_key,dashboard_user_id,remote_user_id,remote_username,status,verified_at,created_by) VALUES('primary',?,?,?,?,UTC_TIMESTAMP(3),?) ON DUPLICATE KEY UPDATE remote_user_id=VALUES(remote_user_id),remote_username=VALUES(remote_username),status=VALUES(status),verified_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)`,
      [
        Number(input.dashboardUserId),
        String(match.id),
        String(match.username),
        input.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
        actor.userId,
      ],
    );
    return {
      ok: true,
      remoteUserId: String(match.id),
      remoteUsername: String(match.username),
    };
  }

  async createUserGrant(authorization: string | undefined, input: any) {
    const actor = await this.actor(authorization, 'jumpserver:config:manage');
    const dashboardUserId = Number(input.dashboardUserId);
    const targets = Array.isArray(input.targets) ? input.targets : [];
    const accounts = this.strings(input.accounts);
    const protocols = this.strings(input.protocols);
    if (!dashboardUserId || !targets.length)
      throw new BadRequestException('请选择用户和资产范围');
    if (!accounts.length || !protocols.length)
      throw new BadRequestException('账号选择器和协议不能为空');
    const mappings = await this.db.query<any[]>(
      `SELECT m.id FROM jumpserver_identity_mappings m JOIN users u ON u.id=m.dashboard_user_id
        WHERE m.provider_key='primary' AND m.dashboard_user_id=? AND m.status='ACTIVE' AND u.status='active' LIMIT 1`,
      [dashboardUserId],
    );
    if (!mappings[0])
      throw new BadRequestException('用户尚未建立有效 JumpServer 身份映射');
    const grant = await this.db.withTransaction(async (conn) => {
      const label = String(input.name || targets[0]?.name || 'asset')
        .trim()
        .slice(0, 80);
      const name = `user-${dashboardUserId}-${label}-${randomUUID().slice(0, 8)}`;
      const [created]: any = await conn.execute(
        `INSERT INTO jumpserver_access_bundles(provider_key,name,description,accounts_json,protocols_json,actions_json,enabled,created_by)
         VALUES('primary',?,?,?,?,?,1,?)`,
        [
          name,
          String(input.description || '').slice(0, 500),
          JSON.stringify(accounts),
          JSON.stringify(protocols),
          JSON.stringify(['connect']),
          actor.userId,
        ],
      );
      const bundleId = Number(created.insertId);
      for (const target of targets) {
        const type = target.type === 'NODE' ? 'NODE' : 'ASSET';
        await conn.execute(
          'INSERT INTO jumpserver_bundle_targets(bundle_id,target_type,remote_id,remote_name) VALUES(?,?,?,?)',
          [
            bundleId,
            type,
            String(target.id),
            String(target.name || '').slice(0, 255),
          ],
        );
      }
      await conn.execute(
        `INSERT INTO jumpserver_user_bundle_bindings(provider_key,dashboard_user_id,bundle_id,enabled,created_by)
         VALUES('primary',?,?,1,?)`,
        [dashboardUserId, bundleId, actor.userId],
      );
      return { bundleId, name };
    });
    const sync = await this.syncUser(authorization, dashboardUserId);
    return { ...grant, dashboardUserId, sync };
  }

  async createUserGrantFromTemplate(
    authorization: string | undefined,
    input: any,
  ) {
    const actor = await this.actor(authorization, 'jumpserver:config:manage');
    const dashboardUserId = Number(input.dashboardUserId);
    if (!dashboardUserId) throw new BadRequestException('请选择运维系统用户');
    const template = await this.loadPermissionTemplate(
      String(input.permissionId || ''),
    );
    const mappings = await this.db.query<any[]>(
      `SELECT m.id FROM jumpserver_identity_mappings m JOIN users u ON u.id=m.dashboard_user_id
        WHERE m.provider_key='primary' AND m.dashboard_user_id=? AND m.status='ACTIVE' AND u.status='active' LIMIT 1`,
      [dashboardUserId],
    );
    if (!mappings[0])
      throw new BadRequestException('用户尚未建立有效 JumpServer 身份映射');
    const snapshot = {
      targets: template.targets,
      accounts: template.accounts,
      protocols: template.protocols,
      actions: template.actions,
    };
    const snapshotHash = this.hash(JSON.stringify(snapshot));
    const grant = await this.db.withTransaction(async (conn) => {
      const label = template.name
        .replace(/[^\p{L}\p{N}._-]+/gu, '-')
        .slice(0, 60);
      const name = `template-${dashboardUserId}-${label || 'permission'}-${randomUUID().slice(0, 8)}`;
      const [created]: any = await conn.execute(
        `INSERT INTO jumpserver_access_bundles(provider_key,name,description,accounts_json,protocols_json,actions_json,source_permission_id,source_permission_name,source_snapshot_hash,enabled,created_by)
         VALUES('primary',?,?,?,?,?,?,?,?,1,?)`,
        [
          name,
          `Copied from JumpServer Asset Permission: ${template.name}`.slice(
            0,
            500,
          ),
          JSON.stringify(template.accounts),
          JSON.stringify(template.protocols),
          JSON.stringify(template.actions),
          template.id,
          template.name.slice(0, 128),
          snapshotHash,
          actor.userId,
        ],
      );
      const bundleId = Number(created.insertId);
      for (const target of template.targets)
        await conn.execute(
          'INSERT INTO jumpserver_bundle_targets(bundle_id,target_type,remote_id,remote_name) VALUES(?,?,?,?)',
          [bundleId, target.type, target.id, target.name.slice(0, 255)],
        );
      await conn.execute(
        `INSERT INTO jumpserver_user_bundle_bindings(provider_key,dashboard_user_id,bundle_id,enabled,created_by)
         VALUES('primary',?,?,1,?)`,
        [dashboardUserId, bundleId, actor.userId],
      );
      return { bundleId, name };
    });
    const sync = await this.syncUser(authorization, dashboardUserId);
    return {
      ...grant,
      dashboardUserId,
      sourcePermission: { id: template.id, name: template.name, snapshotHash },
      sync,
    };
  }

  async unbindUser(
    authorization: string | undefined,
    bundleId: number,
    dashboardUserId: number,
  ) {
    await this.actor(authorization, 'jumpserver:config:manage');
    const result: any = await this.db.query(
      `UPDATE jumpserver_user_bundle_bindings SET enabled=0,updated_at=UTC_TIMESTAMP(3)
        WHERE provider_key='primary' AND dashboard_user_id=? AND bundle_id=? AND enabled=1`,
      [dashboardUserId, bundleId],
    );
    if (!Number(result.affectedRows || 0))
      throw new BadRequestException('用户未绑定该授权包');
    return { ok: true, requiresSync: true };
  }

  async syncUser(authorization: string | undefined, dashboardUserId: number) {
    const actor = await this.actor(authorization, 'jumpserver:sync:execute');
    const mappings = await this.db.query<any[]>(
      `SELECT m.* FROM jumpserver_identity_mappings m JOIN users u ON u.id=m.dashboard_user_id WHERE m.provider_key='primary' AND m.dashboard_user_id=? AND m.status='ACTIVE' AND u.status='active' LIMIT 1`,
      [dashboardUserId],
    );
    if (!mappings[0])
      throw new BadRequestException('用户尚未建立有效 JumpServer 身份映射');
    const bundles = await this.db.query<any[]>(
      `SELECT DISTINCT b.* FROM jumpserver_user_bundle_bindings ub JOIN jumpserver_access_bundles b ON b.id=ub.bundle_id AND b.enabled=1 WHERE ub.provider_key='primary' AND ub.dashboard_user_id=? AND ub.enabled=1`,
      [dashboardUserId],
    );
    const existing = await this.db.query<any[]>(
      'SELECT * FROM jumpserver_grant_states WHERE provider_key=? AND dashboard_user_id=?',
      ['primary', dashboardUserId],
    );
    const wanted = new Set(bundles.map((b) => Number(b.id)));
    const results: any[] = [];
    for (const state of existing.filter(
      (s) => !wanted.has(Number(s.bundle_id)) && s.remote_permission_id,
    )) {
      await this.revokeManaged(actor, dashboardUserId, state);
      results.push({
        bundleId: Number(state.bundle_id),
        status: 'REVOKED',
      });
    }
    if (bundles.length === 0 && results.length === 0)
      throw new BadRequestException(
        '用户未绑定任何已启用的 JumpServer 授权包，请先由管理员为该用户分配授权包',
      );
    for (const bundle of bundles) {
      const targets = await this.db.query<any[]>(
        'SELECT * FROM jumpserver_bundle_targets WHERE bundle_id=? ORDER BY id',
        [bundle.id],
      );
      const desired = {
        user: mappings[0].remote_user_id,
        bundle: Number(bundle.id),
        targets: targets.map((t) => [t.target_type, t.remote_id]),
        accounts: this.json(bundle.accounts_json),
        protocols: this.json(bundle.protocols_json),
        actions: this.json(bundle.actions_json).length
          ? this.json(bundle.actions_json)
          : ['connect'],
      };
      const hash = createHash('sha256')
        .update(JSON.stringify(desired))
        .digest('hex');
      const old = existing.find(
        (s) => Number(s.bundle_id) === Number(bundle.id),
      );
      if (
        old?.remote_permission_id &&
        old.desired_hash === hash &&
        old.status === 'SYNCED'
      ) {
        results.push({
          bundleId: Number(bundle.id),
          status: 'SYNCED',
          unchanged: true,
        });
        continue;
      }
      if (old?.remote_permission_id)
        await this.revokeManaged(actor, dashboardUserId, old);
      try {
        const payload = {
          name: `dashboard:bundle:${bundle.id}:user:${dashboardUserId}`,
          users: [mappings[0].remote_user_id],
          user_groups: [],
          assets: targets
            .filter((t) => t.target_type === 'ASSET')
            .map((t) => t.remote_id),
          nodes: targets
            .filter((t) => t.target_type === 'NODE')
            .map((t) => t.remote_id),
          accounts: desired.accounts,
          protocols: desired.protocols,
          actions: desired.actions,
          is_active: true,
          date_start: new Date().toISOString(),
          date_expired: '2099-12-31T23:59:59Z',
          comment: 'Managed by Dashboard; do not edit manually',
        };
        const remote = await this.remote(
          'grant',
          'POST',
          '/api/v1/perms/asset-permissions/',
          payload,
        );
        await this.db.query(
          `INSERT INTO jumpserver_grant_states(provider_key,dashboard_user_id,bundle_id,remote_permission_id,desired_hash,status,last_error,last_synced_at) VALUES('primary',?,?,?,?,? ,NULL,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE remote_permission_id=VALUES(remote_permission_id),desired_hash=VALUES(desired_hash),status='SYNCED',last_error=NULL,last_synced_at=UTC_TIMESTAMP(3)`,
          [dashboardUserId, bundle.id, String(remote.id), hash, 'SYNCED'],
        );
        results.push({ bundleId: Number(bundle.id), status: 'SYNCED' });
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 500);
        await this.db.query(
          `INSERT INTO jumpserver_grant_states(provider_key,dashboard_user_id,bundle_id,desired_hash,status,last_error) VALUES('primary',?,?,?,'FAILED',?) ON DUPLICATE KEY UPDATE desired_hash=VALUES(desired_hash),status='FAILED',last_error=VALUES(last_error)`,
          [dashboardUserId, bundle.id, hash, msg],
        );
        results.push({
          bundleId: Number(bundle.id),
          status: 'FAILED',
          error: msg,
        });
      }
    }
    await this.event(
      actor.userId,
      dashboardUserId,
      'GRANT_SYNC',
      String(dashboardUserId),
      results.every((r) => ['SYNCED', 'REVOKED'].includes(r.status))
        ? 'SUCCESS'
        : 'PARTIAL',
      `同步 ${results.length} 个授权包`,
    );
    return { dashboardUserId, results };
  }

  private async revokeManaged(actor: Actor, targetUserId: number, state: any) {
    const detail = await this.remote(
      'grant',
      'GET',
      `/api/v1/perms/asset-permissions/${encodeURIComponent(state.remote_permission_id)}/`,
    );
    if (!String(detail.name || '').startsWith('dashboard:bundle:'))
      throw new ForbiddenException('拒绝删除非 Dashboard 受管授权');
    await this.remote(
      'grant',
      'DELETE',
      `/api/v1/perms/asset-permissions/${encodeURIComponent(state.remote_permission_id)}/`,
    );
    await this.db.query(
      `UPDATE jumpserver_grant_states SET status='REVOKED',remote_permission_id=NULL,last_error=NULL,last_synced_at=UTC_TIMESTAMP(3) WHERE provider_key='primary' AND dashboard_user_id=? AND bundle_id=?`,
      [targetUserId, state.bundle_id],
    );
    await this.event(
      actor.userId,
      targetUserId,
      'GRANT_REVOKE',
      String(state.bundle_id),
      'SUCCESS',
      '已回收 Dashboard 受管授权',
    );
  }

  async myStatus(authorization?: string) {
    const actor = await this.actor(authorization, 'jumpserver:portal:launch');
    const rows = await this.db.query<any[]>(
      `SELECT m.remote_username,g.bundle_id,g.remote_permission_id,g.status,b.name bundle_name
         FROM jumpserver_identity_mappings m
         LEFT JOIN jumpserver_user_bundle_bindings ub
           ON ub.provider_key=m.provider_key AND ub.dashboard_user_id=m.dashboard_user_id AND ub.enabled=1
         LEFT JOIN jumpserver_grant_states g
           ON g.dashboard_user_id=m.dashboard_user_id AND g.provider_key=m.provider_key AND g.bundle_id=ub.bundle_id
         LEFT JOIN jumpserver_access_bundles b ON b.id=ub.bundle_id AND b.enabled=1
        WHERE m.provider_key='primary' AND m.dashboard_user_id=? AND m.status='ACTIVE'`,
      [actor.userId],
    );
    const synced = rows.filter(
      (r) => r.status === 'SYNCED' && r.remote_permission_id,
    );
    for (const row of synced) {
      try {
        const remote = await this.remote(
          'grant',
          'GET',
          `/api/v1/perms/asset-permissions/${encodeURIComponent(row.remote_permission_id)}/`,
        );
        if (
          !remote.is_valid ||
          !String(remote.name || '').startsWith('dashboard:bundle:')
        )
          row.status = 'DRIFTED';
      } catch {
        row.status = 'DRIFTED';
      }
    }
    return {
      mapped: rows.length > 0,
      eligible: synced.length > 0 && synced.every((r) => r.status === 'SYNCED'),
      remoteUsername: rows[0]?.remote_username || null,
      grants: rows
        .filter((r) => r.bundle_id)
        .map((r) => ({
          bundleId: r.bundle_id,
          bundleName: r.bundle_name,
          status: r.status,
        })),
    };
  }

  async prepareTicket(authorization: string | undefined, sessionId: string) {
    const actor = await this.actor(authorization, 'jumpserver:portal:launch');
    const status = await this.myStatus(authorization);
    if (!status.eligible)
      throw new ForbiddenException('JumpServer 实际授权尚未生效或存在漂移');
    if (!sessionId) throw new UnauthorizedException('登录会话无效');
    const ticket = randomBytes(32).toString('base64url');
    const ttl = Math.min(
      300,
      Math.max(
        60,
        await this.siteConf.getNumber(
          'jumpserver.portal.ticket_ttl_seconds',
          120,
        ),
      ),
    );
    const ticketId = randomUUID();
    await this.db.query(
      'INSERT INTO jumpserver_portal_tickets(ticket_id,ticket_hash,dashboard_user_id,session_hash,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))',
      [ticketId, this.hash(ticket), actor.userId, this.hash(sessionId), ttl],
    );
    await this.event(
      actor.userId,
      actor.userId,
      'PORTAL_PREPARED',
      ticketId,
      'SUCCESS',
      `单次跳转 Ticket 已创建，有效 ${ttl} 秒`,
    );
    return { ticket, expiresInSeconds: ttl };
  }

  async consumeTicket(
    authorization: string | undefined,
    sessionId: string,
    ticket: string,
  ) {
    const actor = await this.actor(authorization, 'jumpserver:portal:launch');
    const ticketId = await this.db.withTransaction(async (conn) => {
      const [rows]: any = await conn.execute(
        `SELECT * FROM jumpserver_portal_tickets WHERE ticket_hash=? AND dashboard_user_id=? AND session_hash=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`,
        [this.hash(ticket), actor.userId, this.hash(sessionId)],
      );
      if (!rows[0])
        throw new ForbiddenException(
          'Ticket 无效、已过期、已使用或不属于当前会话',
        );
      await conn.execute(
        'UPDATE jumpserver_portal_tickets SET consumed_at=UTC_TIMESTAMP(3) WHERE ticket_id=? AND consumed_at IS NULL',
        [rows[0].ticket_id],
      );
      return String(rows[0].ticket_id);
    });
    const status = await this.myStatus(authorization);
    if (!status.eligible)
      throw new ForbiddenException('JumpServer 实际授权已失效');
    const c = await this.config('reader');
    await this.event(
      actor.userId,
      actor.userId,
      'PORTAL_CONSUMED',
      ticketId,
      'SUCCESS',
      '单次跳转 Ticket 已消费',
    );
    return { portalUrl: c.portalUrl };
  }

  private json(v: any): string[] {
    try {
      const x = typeof v === 'string' ? JSON.parse(v) : v;
      return Array.isArray(x) ? x.map(String) : [];
    } catch {
      return [];
    }
  }
  private lines(v: any) {
    return String(v || '')
      .split('\n')
      .filter(Boolean);
  }
  private strings(v: any): string[] {
    return Array.isArray(v)
      ? [
          ...new Set(
            v
              .map(String)
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ]
      : [];
  }
  private actionStrings(v: any): string[] {
    return Array.isArray(v)
      ? [
          ...new Set(
            v
              .map((value: any) =>
                String(
                  typeof value === 'object' && value
                    ? value.value || value.name || ''
                    : value,
                ).trim(),
              )
              .filter(Boolean),
          ),
        ]
      : [];
  }
  private targetRef(type: 'ASSET' | 'NODE', value: any) {
    const id = String(
      typeof value === 'object' && value
        ? value.id || value.value || ''
        : value,
    );
    if (!id) throw new BadRequestException('Asset Permission 包含无效资产引用');
    const name = String(
      typeof value === 'object' && value
        ? value.name || value.label || value.id || id
        : id,
    );
    return { type, id, name };
  }
  private hash(v: string) {
    return createHash('sha256').update(String(v)).digest('hex');
  }
  private async event(
    actor: number,
    target: number | null,
    type: string,
    ref: string,
    outcome: string,
    summary: string,
  ) {
    await this.db.query(
      'INSERT INTO jumpserver_events(actor_user_id,target_user_id,event_type,target_ref,outcome,summary) VALUES(?,?,?,?,?,?)',
      [actor, target, type, ref, outcome, summary.slice(0, 1000)],
    );
  }
}
