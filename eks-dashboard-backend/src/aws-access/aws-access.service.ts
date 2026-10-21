import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import type { ResultSetHeader } from 'mysql2';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuditService } from '../audit/audit.service';
import { MfaVerificationService } from '../auth/mfa-verification.service';
import { AwsCredentialProviderFactory } from '../aws-governance/aws-credential-provider.factory';
import type { AwsGovernanceActor } from '../aws-governance/aws-governance.types';
import { SiteConfService } from '../site-conf/site-conf.service';

const HUMAN_READ = 'HUMAN_READ';

@Injectable()
export class AwsAccessService {
  private readonly logger = new Logger(AwsAccessService.name);
  private expiryRunning = false;
  private outboxRunning = false;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly mfa: MfaVerificationService,
    private readonly audit: AuditService,
    private readonly siteConf: SiteConfService,
    private readonly credentials: AwsCredentialProviderFactory,
  ) {}

  async configuration(actor: AwsGovernanceActor) {
    const account = await this.hashexAccount();
    const enabled = await this.siteConf.getBoolean(
      'aws_access.hashex.enabled',
      false,
    );
    return {
      enabled,
      account: {
        id: Number(account.id),
        environmentId: account.environment_id,
        accountId: account.account_id,
        displayName: account.display_name,
      },
      templates: enabled
        ? [
            {
              key: HUMAN_READ,
              name: 'Human Read（只读）',
              description: 'AWS ViewOnlyAccess；禁止写入，区域由会话策略约束。',
            },
          ]
        : [],
      regions: this.json<string[]>(account.default_regions_json, ['ap-east-1']),
      canManage: actor.permissions.includes('aws-access:grant:manage'),
      deliveryMode: 'AWS_CONSOLE_FEDERATION',
    };
  }

  async listGrants(actor: AwsGovernanceActor) {
    const readAll = actor.permissions.includes('aws-access:grant:read-all');
    const where = readAll ? '' : 'WHERE g.grantee_user_id=?';
    const params = readAll ? [] : [actor.userId];
    const rows = await this.db.query<any[]>(
      `SELECT g.id,g.grantee_user_id,u.username,u.display_name,g.environment_id,
              g.permission_template_key,g.regions_json,g.reason,g.status,g.valid_from,
              g.valid_until,g.revoked_at,g.revoke_reason,g.created_at,g.updated_at,
              (SELECT COUNT(*) FROM aws_access_sessions s WHERE s.grant_id=g.id) session_count,
              (SELECT MAX(s.prepared_at) FROM aws_access_sessions s WHERE s.grant_id=g.id) last_session_at
       FROM aws_access_grants g
       JOIN users u ON u.id=g.grantee_user_id
       ${where}
       ORDER BY g.created_at DESC,g.id DESC`,
      params,
    );
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      grantee_user_id: Number(row.grantee_user_id),
      regions: this.json(row.regions_json, []),
      session_count: Number(row.session_count || 0),
    }));
  }

  async createGrant(
    actor: AwsGovernanceActor,
    input: {
      granteeUserId: number;
      cloudAccountId: number;
      permissionTemplateKey: string;
      regions: string[];
      validUntil: string;
      reason: string;
      mfaCode: string;
    },
  ) {
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    const account = await this.hashexAccount();
    if (Number(account.id) !== Number(input.cloudAccountId))
      throw new BadRequestException('首版仅支持 hashex 云账号');
    if (!(await this.siteConf.getBoolean('aws_access.hashex.enabled', false)))
      throw new BadRequestException('hashex AWS 临时访问尚未启用');
    if (input.permissionTemplateKey !== HUMAN_READ)
      throw new BadRequestException('不支持的权限模板');
    const userRows = await this.db.query<any[]>(
      "SELECT id,username,status FROM users WHERE id=? AND status='active' LIMIT 1",
      [input.granteeUserId],
    );
    if (!userRows[0]) throw new NotFoundException('目标用户不存在或已禁用');
    const allowedRegions = this.json<string[]>(
      account.default_regions_json,
      [],
    );
    const regions = [...new Set(input.regions.map((item) => item.trim()))];
    if (
      !regions.length ||
      regions.some((item) => !allowedRegions.includes(item))
    )
      throw new BadRequestException('所选区域不在 hashex 受控范围内');
    const validUntil = new Date(input.validUntil);
    const now = Date.now();
    if (
      !Number.isFinite(validUntil.getTime()) ||
      validUntil.getTime() < now + 15 * 60_000
    )
      throw new BadRequestException('授权到期时间至少晚于当前时间 15 分钟');
    if (validUntil.getTime() > now + 30 * 24 * 60 * 60_000)
      throw new BadRequestException('首版单次授权最长 30 天');
    const targetRoleArn = await this.siteConf.getString(
      'aws_access.hashex.human_read_role_arn',
    );
    this.requireRoleArn(targetRoleArn, account.account_id, 'Human Read');
    const snapshot = {
      version: 1,
      granteeUserId: Number(input.granteeUserId),
      cloudAccountId: Number(account.id),
      environmentId: String(account.environment_id),
      accountId: String(account.account_id),
      permissionTemplateKey: HUMAN_READ,
      targetRoleArn,
      regions: [...regions].sort(),
      validUntil: validUntil.toISOString(),
      reason: input.reason.trim(),
    };
    if (!snapshot.reason) throw new BadRequestException('授权原因不能为空');
    const grantHash = this.sha256(JSON.stringify(snapshot));
    const result = await this.db.withTransaction(async (conn) => {
      const [insert] = await conn.execute<ResultSetHeader>(
        `INSERT INTO aws_access_grants
         (grantee_user_id,granted_by_user_id,cloud_account_id,environment_id,
          permission_template_key,target_role_arn,regions_json,reason,
          grant_snapshot_json,grant_hash,status,valid_from,valid_until)
         VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE',UTC_TIMESTAMP(3),?)`,
        [
          snapshot.granteeUserId,
          actor.userId,
          snapshot.cloudAccountId,
          snapshot.environmentId,
          snapshot.permissionTemplateKey,
          snapshot.targetRoleArn,
          JSON.stringify(snapshot.regions),
          snapshot.reason,
          JSON.stringify(snapshot),
          grantHash,
          this.mysqlDate(validUntil),
        ],
      );
      await conn.execute(
        `INSERT INTO aws_access_grant_events
         (grant_id,event_type,actor_user_id,snapshot_hash,summary_json)
         VALUES (?,'GRANTED',?,?,?)`,
        [
          insert.insertId,
          actor.userId,
          grantHash,
          JSON.stringify({ template: HUMAN_READ, regions: snapshot.regions }),
        ],
      );
      await conn.execute(
        `INSERT INTO aws_access_audit_outbox
         (grant_id,event_type,actor_user_id,payload_json) VALUES (?,?,?,?)`,
        [
          insert.insertId,
          'GRANTED',
          actor.userId,
          JSON.stringify({
            template: HUMAN_READ,
            granteeUserId: snapshot.granteeUserId,
          }),
        ],
      );
      return { id: Number(insert.insertId), grantHash };
    });
    await this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName,
      environmentId: snapshot.environmentId,
      action: 'awsAccess.grant.create',
      actionName: '创建 AWS 临时授权',
      menuKey: 'menu:aws-access',
      targetType: 'aws_access_grant',
      targetId: String(result.id),
      meta: {
        granteeUserId: snapshot.granteeUserId,
        template: HUMAN_READ,
        validUntil: snapshot.validUntil,
      },
      status: 'success',
    });
    return { id: result.id, status: 'ACTIVE' };
  }

  async revokeGrant(
    actor: AwsGovernanceActor,
    id: number,
    input: { reason: string; mfaCode: string },
  ) {
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    if (!input.reason.trim()) throw new BadRequestException('回收原因不能为空');
    const grant = await this.grant(id);
    if (grant.status !== 'ACTIVE')
      throw new BadRequestException('只有生效中的授权可以提前回收');
    await this.db.withTransaction(async (conn) => {
      const [updated] = await conn.execute<ResultSetHeader>(
        `UPDATE aws_access_grants SET status='REVOKED',revoked_by_user_id=?,
         revoked_at=UTC_TIMESTAMP(3),revoke_reason=? WHERE id=? AND status='ACTIVE'`,
        [actor.userId, input.reason.trim(), id],
      );
      if (updated.affectedRows !== 1)
        throw new BadRequestException('授权状态已变化，请刷新后重试');
      await conn.execute(
        `UPDATE aws_access_sessions SET status='CLOSED',closed_at=UTC_TIMESTAMP(3)
         WHERE grant_id=? AND status='PREPARED'`,
        [id],
      );
      await conn.execute(
        `INSERT INTO aws_access_audit_outbox
         (grant_id,event_type,actor_user_id,payload_json) VALUES (?,?,?,?)`,
        [
          id,
          'REVOKED',
          actor.userId,
          JSON.stringify({ reason: input.reason.trim() }),
        ],
      );
      await conn.execute(
        `INSERT INTO aws_access_grant_events
         (grant_id,event_type,actor_user_id,snapshot_hash,summary_json)
         VALUES (?,'REVOKED',?,?,?)`,
        [
          id,
          actor.userId,
          grant.grant_hash,
          JSON.stringify({ reason: input.reason.trim() }),
        ],
      );
    });
    return { id, status: 'REVOKED' };
  }

  async prepareSession(actor: AwsGovernanceActor, grantId: number) {
    const grant = await this.grant(grantId);
    if (Number(grant.grantee_user_id) !== actor.userId)
      throw new ForbiddenException('只能使用授予给自己的 AWS 权限');
    this.assertGrantUsable(grant);
    const ttl = Math.min(
      300,
      Math.max(
        30,
        await this.siteConf.getNumber('aws_access.ticket_ttl_seconds', 120),
      ),
    );
    const ticket = randomBytes(32).toString('base64url');
    const ticketHash = this.sha256(ticket);
    const sessionName =
      `dashboard-u${actor.userId}-g${grantId}-${Date.now()}`.slice(0, 64);
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO aws_access_sessions
       (grant_id,grantee_user_id,ticket_hash,grant_hash,role_session_name,status,expires_at)
       VALUES (?,?,?,?,?,'PREPARED',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))`,
      [grantId, actor.userId, ticketHash, grant.grant_hash, sessionName, ttl],
    );
    await this.event(
      grantId,
      'SESSION_PREPARED',
      actor.userId,
      grant.grant_hash,
      { sessionId: Number(result.insertId), ttlSeconds: ttl },
    );
    return { ticket, expiresInSeconds: ttl };
  }

  async consumeSession(actor: AwsGovernanceActor, ticket: string) {
    const ticketHash = this.sha256(ticket);
    const rows = await this.db.query<any[]>(
      `SELECT s.*,g.status grant_status,g.valid_until,g.target_role_arn,g.regions_json,
              g.grant_hash current_grant_hash,g.environment_id
       FROM aws_access_sessions s JOIN aws_access_grants g ON g.id=s.grant_id
       WHERE s.ticket_hash=? LIMIT 1`,
      [ticketHash],
    );
    const session = rows[0];
    if (!session || Number(session.grantee_user_id) !== actor.userId)
      throw new ForbiddenException('一次性 AWS 会话 ticket 无效');
    if (session.status !== 'PREPARED')
      throw new BadRequestException('一次性 AWS 会话 ticket 已使用或已失效');
    if (this.asUtc(session.expires_at).getTime() <= Date.now()) {
      await this.denySession(session, actor.userId, 'TICKET_EXPIRED');
      throw new BadRequestException('一次性 AWS 会话 ticket 已过期');
    }
    if (session.grant_hash !== session.current_grant_hash) {
      await this.denySession(session, actor.userId, 'STALE_GRANT_HASH');
      throw new ForbiddenException('授权快照已变化，请重新发起会话');
    }
    this.assertGrantUsable({
      status: session.grant_status,
      valid_until: session.valid_until,
    });
    const claimed = await this.db.query<ResultSetHeader>(
      `UPDATE aws_access_sessions SET status='CONSUMED',consumed_at=UTC_TIMESTAMP(3)
       WHERE id=? AND status='PREPARED'`,
      [session.id],
    );
    if (claimed.affectedRows !== 1)
      throw new BadRequestException('一次性 AWS 会话 ticket 已被消费');
    try {
      const redirectUrl = await this.consoleUrl(actor, session);
      await this.event(
        Number(session.grant_id),
        'SESSION_CONSUMED',
        actor.userId,
        session.grant_hash,
        { sessionId: Number(session.id), deliveryMode: session.delivery_mode },
      );
      return { redirectUrl };
    } catch (error: any) {
      await this.db.query(
        `UPDATE aws_access_sessions SET status='DENIED',closed_at=UTC_TIMESTAMP(3),failure_code='BROKER_ERROR'
         WHERE id=?`,
        [session.id],
      );
      await this.event(
        Number(session.grant_id),
        'SESSION_DENIED',
        actor.userId,
        session.grant_hash,
        { sessionId: Number(session.id), code: 'BROKER_ERROR' },
      );
      this.logger.warn(
        `AWS console federation failed grant=${session.grant_id} session=${session.id} code=${error?.name || 'Error'}`,
      );
      throw new BadRequestException(
        'AWS 临时会话签发失败，请联系管理员检查 Broker 配置',
      );
    }
  }

  @Interval(30_000)
  async expire() {
    if (this.expiryRunning) return;
    this.expiryRunning = true;
    try {
      const grants = await this.db.query<any[]>(
        `SELECT id,grant_hash FROM aws_access_grants
         WHERE status='ACTIVE' AND valid_until<=UTC_TIMESTAMP(3) LIMIT 200`,
      );
      for (const grant of grants) {
        const updated = await this.db.query<ResultSetHeader>(
          `UPDATE aws_access_grants SET status='EXPIRED'
           WHERE id=? AND status='ACTIVE' AND valid_until<=UTC_TIMESTAMP(3)`,
          [grant.id],
        );
        if (updated.affectedRows)
          await this.event(
            Number(grant.id),
            'EXPIRED',
            null,
            grant.grant_hash,
            {},
          );
      }
      const sessions = await this.db.query<any[]>(
        `SELECT id,grant_id,grant_hash FROM aws_access_sessions
         WHERE status='PREPARED' AND expires_at<=UTC_TIMESTAMP(3) LIMIT 500`,
      );
      for (const session of sessions) {
        const updated = await this.db.query<ResultSetHeader>(
          `UPDATE aws_access_sessions SET status='EXPIRED',closed_at=UTC_TIMESTAMP(3),failure_code='TICKET_EXPIRED'
           WHERE id=? AND status='PREPARED'`,
          [session.id],
        );
        if (updated.affectedRows)
          await this.event(
            Number(session.grant_id),
            'SESSION_EXPIRED',
            null,
            session.grant_hash,
            { sessionId: Number(session.id) },
          );
      }
    } catch (error: any) {
      this.logger.warn(
        `AWS access expiry worker failed: ${error?.message || error}`,
      );
    } finally {
      this.expiryRunning = false;
    }
  }

  @Interval(15_000)
  async dispatchAuditOutbox() {
    if (this.outboxRunning) return;
    this.outboxRunning = true;
    try {
      const rows = await this.db.query<any[]>(
        `SELECT o.id,o.grant_id,o.event_type,o.actor_user_id,o.payload_json,
                g.environment_id,u.username,u.display_name
         FROM aws_access_audit_outbox o
         JOIN aws_access_grants g ON g.id=o.grant_id
         LEFT JOIN users u ON u.id=o.actor_user_id
         WHERE o.dispatched_at IS NULL AND o.available_at<=UTC_TIMESTAMP(3)
         ORDER BY o.id LIMIT 100`,
      );
      for (const row of rows) {
        try {
          const recorded = await this.audit.record({
            actorUserId: row.actor_user_id ? Number(row.actor_user_id) : null,
            actorUsername: row.username || null,
            actorDisplayName: row.display_name || null,
            environmentId: row.environment_id,
            action: `awsAccess.${String(row.event_type).toLowerCase()}`,
            actionName: `AWS 临时访问事件：${row.event_type}`,
            menuKey: 'menu:aws-access',
            targetType: 'aws_access_grant',
            targetId: String(row.grant_id),
            meta: this.json(row.payload_json, {}),
            status: 'success',
          });
          if (!recorded) throw new Error('audit log write failed');
          await this.db.query(
            `UPDATE aws_access_audit_outbox SET dispatched_at=UTC_TIMESTAMP(3),attempts=attempts+1,last_error=NULL
             WHERE id=? AND dispatched_at IS NULL`,
            [row.id],
          );
        } catch (error: any) {
          await this.db.query(
            `UPDATE aws_access_audit_outbox SET attempts=attempts+1,last_error=?,
             available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(300,POW(2,LEAST(attempts,8))) SECOND)
             WHERE id=? AND dispatched_at IS NULL`,
            [String(error?.message || error).slice(0, 500), row.id],
          );
        }
      }
    } finally {
      this.outboxRunning = false;
    }
  }

  private async consoleUrl(actor: AwsGovernanceActor, session: any) {
    const region = this.json<string[]>(session.regions_json, [])[0];
    const brokerRoleArn = await this.siteConf.getString(
      'aws_access.hashex.broker_role_arn',
    );
    this.requireRoleArn(brokerRoleArn, '290368114919', 'Credential Broker');
    const brokerCredentials = this.credentials.createAssumeRoleCredentials({
      roleArn: brokerRoleArn,
      region,
      roleSessionName: `dashboard-broker-u${actor.userId}-${Date.now()}`.slice(
        0,
        64,
      ),
      durationSeconds: 900,
    });
    const remainingSeconds = Math.floor(
      (this.asUtc(session.valid_until).getTime() - Date.now()) / 1000,
    );
    const maxMinutes = Math.min(
      60,
      Math.max(
        15,
        await this.siteConf.getNumber('aws_access.session_max_minutes', 60),
      ),
    );
    const durationSeconds = Math.min(maxMinutes * 60, remainingSeconds, 3600);
    if (durationSeconds < 900)
      throw new BadRequestException(
        '授权剩余时间不足 15 分钟，无法启动 AWS 会话',
      );
    const regions = this.json<string[]>(session.regions_json, []);
    const sts = new STSClient({ region, credentials: brokerCredentials });
    const assumed = await sts.send(
      new AssumeRoleCommand({
        RoleArn: session.target_role_arn,
        RoleSessionName: session.role_session_name,
        DurationSeconds: durationSeconds,
        Tags: [
          { Key: 'DashboardUserId', Value: String(actor.userId) },
          { Key: 'DashboardGrantId', Value: String(session.grant_id) },
        ],
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowWithinRolePermissions',
              Effect: 'Allow',
              Action: '*',
              Resource: '*',
            },
            {
              Sid: 'DenyOutsideGrantedRegions',
              Effect: 'Deny',
              Action: '*',
              Resource: '*',
              Condition: {
                StringNotEquals: { 'aws:RequestedRegion': regions },
                Null: { 'aws:RequestedRegion': 'false' },
              },
            },
          ],
        }),
      }),
    );
    const c = assumed.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken)
      throw new Error('STS returned incomplete credentials');
    await this.db.query(
      `UPDATE aws_access_sessions SET aws_session_arn=?,cloudtrail_correlation_json=? WHERE id=?`,
      [
        assumed.AssumedRoleUser?.Arn || null,
        JSON.stringify({
          roleSessionName: session.role_session_name,
          assumedRoleArn: assumed.AssumedRoleUser?.Arn || null,
          dashboardUserId: actor.userId,
          dashboardGrantId: Number(session.grant_id),
          accountId: '290368114919',
          region,
        }),
        session.id,
      ],
    );
    const federation = await axios.get<{ SigninToken: string }>(
      'https://signin.aws.amazon.com/federation',
      {
        timeout: 10_000,
        params: {
          Action: 'getSigninToken',
          Session: JSON.stringify({
            sessionId: c.AccessKeyId,
            sessionKey: c.SecretAccessKey,
            sessionToken: c.SessionToken,
          }),
        },
      },
    );
    if (!federation.data?.SigninToken) throw new Error('Missing SigninToken');
    const destination = `https://${region}.console.aws.amazon.com/console/home?region=${encodeURIComponent(region)}`;
    return `https://signin.aws.amazon.com/federation?Action=login&Issuer=${encodeURIComponent('dashboard')}&Destination=${encodeURIComponent(destination)}&SigninToken=${encodeURIComponent(federation.data.SigninToken)}`;
  }

  private async denySession(session: any, actorUserId: number, code: string) {
    await this.db.query(
      `UPDATE aws_access_sessions SET status='DENIED',closed_at=UTC_TIMESTAMP(3),failure_code=?
       WHERE id=? AND status='PREPARED'`,
      [code, session.id],
    );
    await this.event(
      Number(session.grant_id),
      'SESSION_DENIED',
      actorUserId,
      session.grant_hash,
      { sessionId: Number(session.id), code },
    );
  }

  private async hashexAccount() {
    const rows = await this.db.query<any[]>(
      "SELECT * FROM aws_cloud_accounts WHERE environment_id='hashex' AND enabled=1 LIMIT 1",
    );
    if (!rows[0]) throw new NotFoundException('hashex AWS 云账号未配置');
    return rows[0];
  }

  private async grant(id: number) {
    const rows = await this.db.query<any[]>(
      'SELECT * FROM aws_access_grants WHERE id=? LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('AWS 临时授权不存在');
    return rows[0];
  }

  private assertGrantUsable(grant: any) {
    if (grant.status !== 'ACTIVE')
      throw new ForbiddenException('AWS 临时授权未生效');
    if (this.asUtc(grant.valid_until).getTime() <= Date.now())
      throw new ForbiddenException('AWS 临时授权已到期');
  }

  private event(
    grantId: number,
    eventType: string,
    actorUserId: number | null,
    snapshotHash: string,
    summary: Record<string, unknown>,
  ) {
    return this.db.withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO aws_access_grant_events
         (grant_id,event_type,actor_user_id,snapshot_hash,summary_json)
         VALUES (?,?,?,?,?)`,
        [
          grantId,
          eventType,
          actorUserId,
          snapshotHash,
          JSON.stringify(summary),
        ],
      );
      await conn.execute(
        `INSERT INTO aws_access_audit_outbox
         (grant_id,event_type,actor_user_id,payload_json) VALUES (?,?,?,?)`,
        [grantId, eventType, actorUserId, JSON.stringify(summary)],
      );
    });
  }

  private json<T>(value: unknown, fallback: T): T {
    try {
      if (typeof value === 'string') return JSON.parse(value) as T;
      return (value as T) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private requireRoleArn(value: string, accountId: string, name: string) {
    const pattern = new RegExp(
      `^arn:aws:iam::${accountId}:role/[A-Za-z0-9+=,.@_/-]+$`,
    );
    if (!pattern.test(value))
      throw new BadRequestException(`${name} Role ARN 配置无效`);
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private mysqlDate(value: Date) {
    return value.toISOString().slice(0, 23).replace('T', ' ');
  }

  private asUtc(value: unknown) {
    const text = String(value || '');
    return new Date(
      /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`,
    );
  }
}
