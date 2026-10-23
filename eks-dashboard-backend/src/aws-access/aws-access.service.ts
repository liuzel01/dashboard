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
const HUMAN_TAG_WRITE = 'HUMAN_TAG_WRITE';
const HUMAN_SECURITY_GROUP_WRITE = 'HUMAN_SECURITY_GROUP_WRITE';
const HUMAN_S3_WRITE = 'HUMAN_S3_WRITE';
const HUMAN_READ_POLICY_ARN =
  'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess';

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

  async configuration(actor: AwsGovernanceActor, environmentId: string) {
    const account = await this.account(environmentId, false);
    if (!account) {
      return {
        enabled: false,
        account: null,
        templates: [],
        regions: [],
        canManage: actor.permissions.includes('aws-access:grant:manage'),
        deliveryMode: 'AWS_CONSOLE_FEDERATION',
        unavailableReason: `环境 ${environmentId} 尚未配置 AWS 云账号和临时访问角色`,
      };
    }
    const confPrefix = `aws_access.${environmentId}`;
    const enabled = await this.siteConf.getBoolean(
      `${confPrefix}.enabled`,
      false,
    );
    const humanReadRoleArn = await this.siteConf.getString(
      `${confPrefix}.human_read_role_arn`,
    );
    const humanTagWriteRoleArn = await this.siteConf.getString(
      `${confPrefix}.human_tag_write_role_arn`,
    );
    const humanSecurityGroupWriteRoleArn = await this.siteConf.getString(
      `${confPrefix}.human_security_group_write_role_arn`,
    );
    const humanS3WriteRoleArn = await this.siteConf.getString(
      `${confPrefix}.human_s3_write_role_arn`,
    );
    const securityGroupScope = await this.siteConf.getJson<string[]>(
      `${confPrefix}.security_group_write_scope`,
      [],
    );
    const s3WriteScope = await this.siteConf.getJson<
      Array<{ resourceAccount: string; bucket: string; prefix: string }>
    >(`${confPrefix}.s3_write_scope`, []);
    const tagWritePolicyArn = await this.siteConf.getString(
      `${confPrefix}.human_tag_write_policy_arn`,
    );
    const securityGroupWritePolicyArn = await this.siteConf.getString(
      `${confPrefix}.human_security_group_write_policy_arn`,
    );
    const s3WritePolicyArn = await this.siteConf.getString(
      `${confPrefix}.human_s3_write_policy_arn`,
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
              name: 'AWS 全局资源配置只读',
              shortName: '资源配置只读',
              description:
                '查看 AWS 资源的配置、状态和关联关系，不允许创建、修改或删除资源。',
              riskLevel: 'LOW',
              primaryServices: [
                'EC2 / EBS',
                'ELB',
                'EKS',
                'RDS',
                'S3',
                'Route 53',
                'ACM',
                'IAM',
              ],
              allowedCapabilities: [
                '列举和查看 AWS 资源',
                '读取资源配置、状态和关联关系',
                '在授权区域内进入 AWS Console 进行只读排查',
              ],
              deniedCapabilities: [
                '创建、修改或删除 AWS 资源',
                '启动、停止或重启计算资源',
                '修改 IAM、网络、安全组或资源标签',
                '上传对象或修改业务数据',
              ],
              maxDurationMinutes: 30 * 24 * 60,
              targetRoleArn: humanReadRoleArn,
              policyReferences: [HUMAN_READ_POLICY_ARN],
              policyModel: 'AWS_MANAGED_POLICY',
              verification: {
                method: 'IAM Policy Simulation + real AssumeRole',
                verifiedAt: '2026-10-21',
                writeActionsDenied: true,
              },
              notes: [
                '区域由临时会话策略进一步限制。',
                'AWS 托管策略可能由 AWS 更新，实际权限以当前策略版本和会话策略交集为准。',
              ],
            },
            ...(humanTagWriteRoleArn
              ? [
                  {
                    key: HUMAN_TAG_WRITE,
                    name: 'AWS 治理标签维护',
                    shortName: '治理标签维护',
                    description:
                      '在查看 AWS 资源配置的基础上，仅允许维护 EC2 实例、EBS 卷和安全组的 environment、owner 标签。',
                    riskLevel: 'MEDIUM',
                    primaryServices: [
                      'EC2 Instance',
                      'EBS Volume',
                      'Security Group',
                    ],
                    allowedCapabilities: [
                      '列举和查看 AWS 资源配置与状态',
                      '新增、修改或移除 environment 标签',
                      '新增、修改或移除 owner 标签',
                      '在授权区域内进入 AWS Console 执行上述操作',
                    ],
                    deniedCapabilities: [
                      '修改 Name 或其他非白名单标签',
                      '创建、删除、启动、停止或重启 AWS 资源',
                      '修改安全组规则、网络、IAM 或存储配置',
                      '上传对象或修改业务数据',
                    ],
                    maxDurationMinutes: 30 * 24 * 60,
                    targetRoleArn: humanTagWriteRoleArn,
                    policyReferences: [
                      HUMAN_READ_POLICY_ARN,
                      tagWritePolicyArn,
                    ].filter(Boolean),
                    policyModel: 'AWS_MANAGED_POLICY + CUSTOMER_MANAGED_POLICY',
                    verification: {
                      method: 'IAM Policy Simulation + real AssumeRole DryRun',
                      verifiedAt: '2026-10-23',
                      writeActionsDenied: false,
                    },
                    notes: [
                      '写权限仅适用于 ap-east-1 的 EC2 Instance、EBS Volume 和 Security Group。',
                      '允许的标签键仅为 environment、owner；其他写操作由目标 Role 拒绝。',
                      '当前沿用管理员 MFA 直接授权流程，双人审批作为后续增强。',
                    ],
                  },
                ]
              : []),
            ...(humanSecurityGroupWriteRoleArn
              ? [
                  {
                    key: HUMAN_SECURITY_GROUP_WRITE,
                    name: 'AWS 安全组入站规则维护',
                    shortName: '安全组入站规则维护',
                    description:
                      '在查看 AWS 资源配置的基础上，仅允许为白名单安全组新增或移除入站规则。',
                    riskLevel: 'HIGH',
                    primaryServices: ['EC2 Security Group'],
                    allowedCapabilities: [
                      '列举和查看 AWS 资源配置与状态',
                      `新增或移除账号区域内安全组的入站规则：${securityGroupScope.join('、')}`,
                      '在授权区域内进入 AWS Console 执行上述操作',
                    ],
                    deniedCapabilities: [
                      '修改安全组出站规则',
                      '创建、删除安全组或维护其他安全组',
                      '修改 VPC、子网、路由、IAM 或其他 AWS 资源',
                    ],
                    maxDurationMinutes: 30 * 24 * 60,
                    targetRoleArn: humanSecurityGroupWriteRoleArn,
                    policyReferences: [
                      HUMAN_READ_POLICY_ARN,
                      securityGroupWritePolicyArn,
                    ].filter(Boolean),
                    policyModel: 'AWS_MANAGED_POLICY + CUSTOMER_MANAGED_POLICY',
                    verification: {
                      method: 'IAM Policy Simulation + real AssumeRole DryRun',
                      verifiedAt: '2026-10-23',
                      writeActionsDenied: false,
                    },
                    notes: [
                      '仅开放 AuthorizeSecurityGroupIngress、RevokeSecurityGroupIngress。',
                      '当前沿用管理员 MFA 直接授权流程，双人审批作为后续增强。',
                    ],
                  },
                ]
              : []),
            ...(humanS3WriteRoleArn
              ? [
                  {
                    key: HUMAN_S3_WRITE,
                    name: 'AWS S3 对象写入',
                    shortName: 'S3 对象写入',
                    description:
                      `在全局资源配置只读的基础上，允许向 ${environmentId} 账号自身拥有的 S3 Bucket 上传或覆盖对象。`,
                    riskLevel: 'HIGH',
                    primaryServices: ['Amazon S3'],
                    allowedCapabilities: [
                      '列举和查看 AWS 资源配置与状态',
                      '上传或覆盖账号自身 Bucket 中的对象',
                      ...s3WriteScope.map(
                        (item) =>
                          `账号 ${item.resourceAccount}：s3://${item.bucket}/${item.prefix}`,
                      ),
                    ],
                    deniedCapabilities: [
                      '删除对象或对象版本',
                      '写入其他 AWS 账号拥有的 Bucket',
                      '修改桶策略、ACL、版本控制、生命周期或加密配置',
                    ],
                    maxDurationMinutes: 30 * 24 * 60,
                    targetRoleArn: humanS3WriteRoleArn,
                    policyReferences: [
                      HUMAN_READ_POLICY_ARN,
                      s3WritePolicyArn,
                    ].filter(Boolean),
                    policyModel: 'AWS_MANAGED_POLICY + CUSTOMER_MANAGED_POLICY',
                    verification: {
                      method: 'IAM Policy Simulation + real AssumeRole',
                      verifiedAt: '2026-10-23',
                      writeActionsDenied: false,
                    },
                    notes: [
                      `写入范围按 s3:ResourceAccount 限制为账号 ${account.account_id} 自身拥有的 Bucket。`,
                      'S3 为全局服务；会话仍要求从所选区域访问，但资源边界以账号归属为准。',
                      'S3 PutObject 不支持 DryRun，真实上传需由人工验收。',
                      '当前沿用管理员 MFA 直接授权流程，双人审批作为后续增强。',
                    ],
                  },
                ]
              : []),
          ]
        : [],
      regions: this.json<string[]>(account.default_regions_json, ['ap-east-1']),
      canManage: actor.permissions.includes('aws-access:grant:manage'),
      deliveryMode: 'AWS_CONSOLE_FEDERATION',
    };
  }

  async listGrants(actor: AwsGovernanceActor, environmentId: string) {
    const readAll = actor.permissions.includes('aws-access:grant:read-all');
    const where = readAll
      ? 'WHERE g.environment_id=?'
      : 'WHERE g.environment_id=? AND g.grantee_user_id=?';
    const params = readAll
      ? [environmentId]
      : [environmentId, actor.userId];
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
    environmentId: string,
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
    const account = await this.account(environmentId);
    if (Number(account.id) !== Number(input.cloudAccountId))
      throw new BadRequestException('云账号与当前目标环境不匹配');
    const confPrefix = `aws_access.${environmentId}`;
    if (!(await this.siteConf.getBoolean(`${confPrefix}.enabled`, false)))
      throw new BadRequestException(
        `环境 ${environmentId} 的 AWS 临时访问尚未启用`,
      );
    const templateRoleConfKeys: Record<string, string> = {
      [HUMAN_READ]: `${confPrefix}.human_read_role_arn`,
      [HUMAN_TAG_WRITE]: `${confPrefix}.human_tag_write_role_arn`,
      [HUMAN_SECURITY_GROUP_WRITE]:
        `${confPrefix}.human_security_group_write_role_arn`,
      [HUMAN_S3_WRITE]: `${confPrefix}.human_s3_write_role_arn`,
    };
    if (!templateRoleConfKeys[input.permissionTemplateKey])
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
      throw new BadRequestException(
        `所选区域不在 ${environmentId} 受控范围内`,
      );
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
      templateRoleConfKeys[input.permissionTemplateKey],
    );
    this.requireRoleArn(
      targetRoleArn,
      account.account_id,
      input.permissionTemplateKey,
    );
    const snapshot = {
      version: 1,
      granteeUserId: Number(input.granteeUserId),
      cloudAccountId: Number(account.id),
      environmentId: String(account.environment_id),
      accountId: String(account.account_id),
      permissionTemplateKey: input.permissionTemplateKey,
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
          JSON.stringify({
            template: snapshot.permissionTemplateKey,
            regions: snapshot.regions,
          }),
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
            template: snapshot.permissionTemplateKey,
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
        template: snapshot.permissionTemplateKey,
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
    const environmentId = String(session.environment_id);
    const account = await this.account(environmentId);
    const brokerRoleArn = await this.siteConf.getString(
      `aws_access.${environmentId}.broker_role_arn`,
    );
    this.requireRoleArn(
      brokerRoleArn,
      String(account.account_id),
      `${environmentId} Credential Broker`,
    );
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
          accountId: String(account.account_id),
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

  private async account(environmentId: string, required?: true): Promise<any>;
  private async account(
    environmentId: string,
    required: false,
  ): Promise<any | null>;
  private async account(environmentId: string, required = true) {
    const rows = await this.db.query<any[]>(
      'SELECT * FROM aws_cloud_accounts WHERE environment_id=? AND enabled=1 LIMIT 1',
      [environmentId],
    );
    if (!rows[0] && required)
      throw new NotFoundException(
        `环境 ${environmentId} 的 AWS 云账号未配置`,
      );
    return rows[0] || null;
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
