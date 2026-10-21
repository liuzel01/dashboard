import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateTagsCommand,
  DeleteTagsCommand,
  DescribeTagsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { ResultSetHeader } from 'mysql2';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { MfaVerificationService } from '../auth/mfa-verification.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import { AwsCredentialProviderFactory } from './aws-credential-provider.factory';
import type { AwsGovernanceActor } from './aws-governance.types';

const SUPPORTED_TYPES = new Set([
  'ec2:instance',
  'ec2:volume',
  'ec2:security-group',
]);

type CreateInput = {
  desiredTags: Record<string, string>;
  reason: string;
  rollbackPlan: string;
  maintenanceStart: string;
  maintenanceEnd: string;
  clientRequestId: string;
};

@Injectable()
export class AwsRemediationService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly mfa: MfaVerificationService,
    private readonly siteConf: SiteConfService,
    private readonly credentialFactory: AwsCredentialProviderFactory,
  ) {}

  async preview(findingId: number, accountId: number, input: CreateInput) {
    const finding = await this.eligibleFinding(findingId, accountId);
    const desiredTags = await this.validateInput(input);
    const currentTags = await this.snapshotTags(finding);
    return {
      findingId,
      resourceType: finding.resource_type,
      resourceId: finding.resource_id,
      region: finding.region,
      currentTags,
      desiredTags,
      changes: Object.entries(desiredTags).map(([key, value]) => ({
        key,
        before: currentTags[key] ?? null,
        after: value,
      })),
      dryRunRequired: true,
      approvalRequired: true,
      rollbackAvailable: true,
    };
  }

  async create(
    actor: AwsGovernanceActor,
    findingId: number,
    accountId: number,
    input: CreateInput,
  ) {
    const existing = await this.db.query<any[]>(
      'SELECT * FROM aws_remediation_tasks WHERE client_request_id=? LIMIT 1',
      [input.clientRequestId],
    );
    if (existing[0]) return this.response(existing[0]);
    const finding = await this.eligibleFinding(findingId, accountId);
    const desiredTags = await this.validateInput(input);
    const beforeTags = await this.snapshotTags(finding);
    const result: any = await this.db.query(
      `INSERT INTO aws_remediation_tasks
       (finding_id,cloud_account_id,environment_id,action_key,resource_type,resource_id,region,
        desired_tags_json,before_tags_json,reason,rollback_plan,maintenance_start,maintenance_end,
        requested_by_user_id,client_request_id)
       VALUES (?,?,?,'APPLY_GOVERNANCE_TAGS',?,?,?,?,?,?,?,?,?,?,?)`,
      [
        findingId,
        accountId,
        finding.environment_id,
        finding.resource_type,
        finding.resource_id,
        finding.region,
        JSON.stringify(desiredTags),
        JSON.stringify(beforeTags),
        input.reason.trim(),
        input.rollbackPlan.trim(),
        this.mysqlDate(new Date(input.maintenanceStart)),
        this.mysqlDate(new Date(input.maintenanceEnd)),
        actor.userId,
        input.clientRequestId.trim(),
      ],
    );
    await this.event(Number(result.insertId), 'CREATED', actor.userId, {
      desiredTags,
      maintenanceStart: input.maintenanceStart,
      maintenanceEnd: input.maintenanceEnd,
    });
    return this.get(Number(result.insertId), accountId);
  }

  async list(accountId: number) {
    const rows = await this.db.query<any[]>(
      `SELECT t.*,ru.display_name requester_name,au.display_name approver_name,eu.display_name executor_name
       FROM aws_remediation_tasks t
       LEFT JOIN users ru ON ru.id=t.requested_by_user_id
       LEFT JOIN users au ON au.id=t.approved_by_user_id
       LEFT JOIN users eu ON eu.id=t.executed_by_user_id
       WHERE t.cloud_account_id=? ORDER BY t.id DESC LIMIT 200`,
      [accountId],
    );
    return rows.map((row) => this.response(row));
  }

  async approve(
    actor: AwsGovernanceActor,
    id: number,
    accountId: number,
    input: { mfaCode: string; clientRequestId: string },
  ) {
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    const task = await this.task(id, accountId);
    if (Number(task.requested_by_user_id) === actor.userId)
      throw new ForbiddenException('整改任务必须由另一名管理员审批');
    if (
      task.status === 'APPROVED' &&
      task.approval_request_id === input.clientRequestId
    )
      return this.response(task);
    if (task.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('只有待审批任务可以审批');
    const result: ResultSetHeader = await this.db.query(
      `UPDATE aws_remediation_tasks SET status='APPROVED',approved_by_user_id=?,approval_request_id=?,approved_at=UTC_TIMESTAMP(3)
       WHERE id=? AND status='PENDING_APPROVAL'`,
      [actor.userId, input.clientRequestId, id],
    );
    if (result.affectedRows !== 1)
      throw new BadRequestException('任务状态已变化，请刷新后重试');
    await this.event(id, 'APPROVED', actor.userId, {});
    return this.get(id, accountId);
  }

  async execute(
    actor: AwsGovernanceActor,
    id: number,
    accountId: number,
    input: { mfaCode: string; clientRequestId: string },
  ) {
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    let task = await this.task(id, accountId);
    if (
      task.status === 'SUCCEEDED' &&
      task.execution_request_id === input.clientRequestId
    )
      return this.response(task);
    if (task.status !== 'APPROVED')
      throw new BadRequestException('只有已审批任务可以执行');
    const now = Date.now();
    if (
      now < new Date(task.maintenance_start).getTime() ||
      now > new Date(task.maintenance_end).getTime()
    )
      throw new BadRequestException('当前不在已审批的维护窗口内');
    const claimed: ResultSetHeader = await this.db.query(
      `UPDATE aws_remediation_tasks SET status='EXECUTING',executed_by_user_id=?,execution_request_id=?,last_error=NULL
       WHERE id=? AND status='APPROVED'`,
      [actor.userId, input.clientRequestId, id],
    );
    if (claimed.affectedRows !== 1)
      throw new BadRequestException('任务已被其他执行人处理，请刷新后重试');
    task = await this.task(id, accountId);
    try {
      const client = await this.writeClient(task);
      const beforeTags = await this.liveTags(client, task.resource_id);
      const desiredTags = this.json<Record<string, string>>(
        task.desired_tags_json,
        {},
      );
      await this.dryRun(
        client,
        new CreateTagsCommand({
          Resources: [task.resource_id],
          Tags: Object.entries(desiredTags).map(([Key, Value]) => ({
            Key,
            Value,
          })),
          DryRun: true,
        }),
      );
      await client.send(
        new CreateTagsCommand({
          Resources: [task.resource_id],
          Tags: Object.entries(desiredTags).map(([Key, Value]) => ({
            Key,
            Value,
          })),
        }),
      );
      await this.db.query(
        `UPDATE aws_remediation_tasks SET status='SUCCEEDED',before_tags_json=?,executed_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [JSON.stringify(beforeTags), id],
      );
      await this.db.query(
        `UPDATE aws_findings SET status='REMEDIATING',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status IN ('OPEN','ACKNOWLEDGED','REOPENED')`,
        [task.finding_id],
      );
      await this.event(id, 'EXECUTED', actor.userId, { desiredTags });
      return this.get(id, accountId);
    } catch (error: any) {
      await this.db.query(
        `UPDATE aws_remediation_tasks SET status='FAILED',last_error=? WHERE id=?`,
        [String(error?.message || error).slice(0, 1000), id],
      );
      await this.event(id, 'FAILED', actor.userId, {
        error: String(error?.message || error).slice(0, 500),
      });
      throw error;
    }
  }

  async rollback(
    actor: AwsGovernanceActor,
    id: number,
    accountId: number,
    input: { mfaCode: string },
  ) {
    await this.mfa.verifyForUser(actor.userId, input.mfaCode);
    const task = await this.task(id, accountId);
    if (task.status !== 'SUCCEEDED')
      throw new BadRequestException('只有执行成功的整改任务可以回滚');
    const client = await this.writeClient(task);
    const before = this.json<Record<string, string>>(task.before_tags_json, {});
    const desired = this.json<Record<string, string>>(
      task.desired_tags_json,
      {},
    );
    const restore = Object.keys(desired)
      .filter((key) => Object.prototype.hasOwnProperty.call(before, key))
      .map((Key) => ({ Key, Value: before[Key] }));
    const remove = Object.keys(desired).filter(
      (key) => !Object.prototype.hasOwnProperty.call(before, key),
    );
    if (restore.length) {
      await this.dryRun(
        client,
        new CreateTagsCommand({
          Resources: [task.resource_id],
          Tags: restore,
          DryRun: true,
        }),
      );
      await client.send(
        new CreateTagsCommand({ Resources: [task.resource_id], Tags: restore }),
      );
    }
    if (remove.length) {
      await this.dryRun(
        client,
        new DeleteTagsCommand({
          Resources: [task.resource_id],
          Tags: remove.map((Key) => ({ Key })),
          DryRun: true,
        }),
      );
      await client.send(
        new DeleteTagsCommand({
          Resources: [task.resource_id],
          Tags: remove.map((Key) => ({ Key })),
        }),
      );
    }
    await this.db.query(
      `UPDATE aws_remediation_tasks SET status='ROLLED_BACK',rolled_back_at=UTC_TIMESTAMP(3) WHERE id=? AND status='SUCCEEDED'`,
      [id],
    );
    await this.db.query(
      `UPDATE aws_findings SET status='REOPENED',resolved_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
      [task.finding_id],
    );
    await this.event(id, 'ROLLED_BACK', actor.userId, { restoredTags: before });
    return this.get(id, accountId);
  }

  private async eligibleFinding(id: number, accountId: number) {
    const rows = await this.db.query<any[]>(
      `SELECT f.*,a.environment_id FROM aws_findings f
       JOIN aws_cloud_accounts a ON a.id=f.cloud_account_id
       WHERE f.id=? AND f.cloud_account_id=? LIMIT 1`,
      [id, accountId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('AWS finding not found');
    if (
      row.rule_key !== 'required-tags-missing' ||
      !SUPPORTED_TYPES.has(row.resource_type)
    )
      throw new BadRequestException('当前 Finding 不支持自动整改');
    if (!['OPEN', 'ACKNOWLEDGED', 'REOPENED'].includes(row.status))
      throw new BadRequestException('当前 Finding 状态不允许创建整改任务');
    return row;
  }

  private async validateInput(input: CreateInput) {
    const allowed = this.json<string[]>(
      await this.siteConf.getString(
        'aws_governance.remediation.allowed_tag_keys',
        '["environment","owner"]',
      ),
      ['environment', 'owner'],
    );
    const tags = input.desiredTags || {};
    const entries = Object.entries(tags);
    if (
      !entries.length ||
      entries.some(
        ([key, value]) =>
          !allowed.includes(key) ||
          !String(value).trim() ||
          String(value).length > 256,
      )
    )
      throw new BadRequestException(
        `仅允许填写非空治理标签：${allowed.join(', ')}`,
      );
    if (
      !input.reason?.trim() ||
      !input.rollbackPlan?.trim() ||
      !input.clientRequestId?.trim()
    )
      throw new BadRequestException('整改原因、回滚方案和幂等请求 ID 不能为空');
    const start = new Date(input.maintenanceStart);
    const end = new Date(input.maintenanceEnd);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    )
      throw new BadRequestException('维护窗口不合法');
    if (end.getTime() - start.getTime() > 24 * 60 * 60_000)
      throw new BadRequestException('单次维护窗口最长 24 小时');
    return Object.fromEntries(
      entries.map(([key, value]) => [key, String(value).trim()]),
    );
  }

  private async snapshotTags(finding: any) {
    const rows = await this.db.query<any[]>(
      `SELECT normalized_json FROM aws_resource_current
       WHERE cloud_account_id=? AND region=? AND resource_type=? AND resource_id=? AND deleted_at IS NULL LIMIT 1`,
      [
        finding.cloud_account_id,
        finding.region,
        finding.resource_type,
        finding.resource_id,
      ],
    );
    return this.json<Record<string, string>>(
      this.json<any>(rows[0]?.normalized_json, {}).tags,
      {},
    );
  }

  private async writeClient(task: any) {
    const brokerRoleArn = await this.siteConf.getString(
      'aws_access.hashex.broker_role_arn',
    );
    const writeRoleArn = await this.siteConf.getString(
      'aws_governance.hashex.human_write_role_arn',
    );
    if (!brokerRoleArn || !writeRoleArn)
      throw new BadRequestException('AWS 受控整改 Role 尚未配置');
    const broker = this.credentialFactory.createAssumeRoleCredentials({
      roleArn: brokerRoleArn,
      region: task.region,
      roleSessionName: `dashboard-remediation-broker-${task.id}`,
    });
    const credentials = fromTemporaryCredentials({
      masterCredentials: broker,
      clientConfig: { region: task.region },
      params: {
        RoleArn: writeRoleArn,
        RoleSessionName: `dashboard-remediation-${task.id}`,
        DurationSeconds: 900,
      },
    });
    return new EC2Client({ region: task.region, credentials });
  }

  private async liveTags(client: EC2Client, resourceId: string) {
    const response = await client.send(
      new DescribeTagsCommand({
        Filters: [{ Name: 'resource-id', Values: [resourceId] }],
      }),
    );
    return Object.fromEntries(
      (response.Tags || [])
        .filter((tag) => tag.Key)
        .map((tag) => [String(tag.Key), String(tag.Value || '')]),
    );
  }

  private async dryRun(
    client: EC2Client,
    command: CreateTagsCommand | DeleteTagsCommand,
  ) {
    try {
      await client.send(command);
      throw new BadRequestException('AWS DryRun 未返回预期结果');
    } catch (error: any) {
      if (String(error?.name || error?.Code) === 'DryRunOperation') return;
      throw error;
    }
  }

  private async task(id: number, accountId: number) {
    const rows = await this.db.query<any[]>(
      'SELECT * FROM aws_remediation_tasks WHERE id=? AND cloud_account_id=? LIMIT 1',
      [id, accountId],
    );
    if (!rows[0]) throw new NotFoundException('AWS remediation task not found');
    return rows[0];
  }

  private async get(id: number, accountId: number) {
    return this.response(await this.task(id, accountId));
  }

  private async event(
    taskId: number,
    eventType: 'CREATED' | 'APPROVED' | 'EXECUTED' | 'FAILED' | 'ROLLED_BACK',
    actorUserId: number,
    summary: Record<string, unknown>,
  ) {
    await this.db.query(
      `INSERT INTO aws_remediation_task_events (task_id,event_type,actor_user_id,summary_json)
       VALUES (?,?,?,?)`,
      [taskId, eventType, actorUserId, JSON.stringify(summary)],
    );
  }

  private response(row: any) {
    return {
      id: Number(row.id),
      findingId: Number(row.finding_id),
      accountId: Number(row.cloud_account_id),
      environmentId: row.environment_id,
      actionKey: row.action_key,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      region: row.region,
      desiredTags: this.json(row.desired_tags_json, {}),
      beforeTags: this.json(row.before_tags_json, {}),
      reason: row.reason,
      rollbackPlan: row.rollback_plan,
      status: row.status,
      requestedByUserId: Number(row.requested_by_user_id),
      requesterName: row.requester_name || null,
      approvedByUserId: row.approved_by_user_id
        ? Number(row.approved_by_user_id)
        : null,
      approverName: row.approver_name || null,
      executedByUserId: row.executed_by_user_id
        ? Number(row.executed_by_user_id)
        : null,
      executorName: row.executor_name || null,
      maintenanceStart: row.maintenance_start,
      maintenanceEnd: row.maintenance_end,
      approvedAt: row.approved_at,
      executedAt: row.executed_at,
      rolledBackAt: row.rolled_back_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private json<T>(value: any, fallback: T): T {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value || fallback;
    } catch {
      return fallback;
    }
  }

  private mysqlDate(value: Date) {
    return value.toISOString().slice(0, 23).replace('T', ' ');
  }
}
