import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuditService } from '../audit/audit.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import { AwsCredentialProviderFactory } from './aws-credential-provider.factory';
import { AwsDetectionService } from './aws-detection.service';
import { AwsGovernanceCollector } from './aws-governance.collector';
import type {
  AwsCloudAccount,
  AwsGovernanceActor,
  AwsInventoryCollection,
  AwsInventoryResource,
} from './aws-governance.types';

const COLLECTOR_VERSION = 'phase1-v1';

@Injectable()
export class AwsGovernanceService implements OnModuleInit {
  private readonly logger = new Logger(AwsGovernanceService.name);
  private scheduledCheckRunning = false;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly collector: AwsGovernanceCollector,
    private readonly credentialFactory: AwsCredentialProviderFactory,
    private readonly audit: AuditService,
    private readonly siteConf: SiteConfService,
    private readonly detection: AwsDetectionService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.scheduledCheck(), 10_000);
  }

  async listAccounts(actor: AwsGovernanceActor) {
    const rows = await this.db.query<any[]>(
      `SELECT DISTINCT a.id,a.environment_id,a.account_id,a.display_name,a.partition_name,
              a.default_regions_json,a.platform_audit_role_arn,a.enabled,a.updated_at
       FROM aws_cloud_accounts a
       INNER JOIN aws_cloud_account_role_scopes s ON s.cloud_account_id=a.id
       INNER JOIN user_roles ur ON ur.role_id=s.role_id
       WHERE ur.user_id=?
       ORDER BY a.environment_id,a.account_id`,
      [actor.userId],
    );
    return rows.map((row) => this.accountFromRow(row));
  }

  async overview(actor: AwsGovernanceActor) {
    const accounts = await this.listAccounts(actor);
    const ids = accounts.map((account) => account.id);
    if (!ids.length)
      return {
        accounts: [],
        metrics: {
          resources: 0,
          changes24h: 0,
          failedRuns24h: 0,
          lastSuccessfulAt: null,
        },
        byType: [],
      };
    const placeholders = ids.map(() => '?').join(',');
    const [resourceRows, changeRows, failedRows, lastRows, byType, findings] =
      await Promise.all([
        this.db.query<any[]>(
          `SELECT COUNT(*) count FROM aws_resource_current WHERE cloud_account_id IN (${placeholders}) AND deleted_at IS NULL`,
          ids,
        ),
        this.db.query<any[]>(
          `SELECT COUNT(*) count FROM aws_resource_changes WHERE cloud_account_id IN (${placeholders}) AND detected_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)`,
          ids,
        ),
        this.db.query<any[]>(
          `SELECT COUNT(*) count FROM aws_inventory_runs WHERE cloud_account_id IN (${placeholders}) AND status IN ('PARTIAL','FAILED') AND created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)`,
          ids,
        ),
        this.db.query<any[]>(
          `SELECT MAX(finished_at) last_successful_at FROM aws_inventory_runs WHERE cloud_account_id IN (${placeholders}) AND status='SUCCEEDED'`,
          ids,
        ),
        this.db.query<any[]>(
          `SELECT resource_type,COUNT(*) count FROM aws_resource_current WHERE cloud_account_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY resource_type ORDER BY count DESC,resource_type`,
          ids,
        ),
        this.detection.summary(ids),
      ]);
    return {
      accounts,
      metrics: {
        resources: Number(resourceRows[0]?.count || 0),
        changes24h: Number(changeRows[0]?.count || 0),
        failedRuns24h: Number(failedRows[0]?.count || 0),
        lastSuccessfulAt: this.utcIso(lastRows[0]?.last_successful_at),
      },
      byType: byType.map((row) => ({
        resourceType: row.resource_type,
        count: Number(row.count),
      })),
      findings,
    };
  }

  async listResources(
    actor: AwsGovernanceActor,
    query: Record<string, string | undefined>,
  ) {
    const account = await this.requireAccountScope(
      actor,
      Number(query.accountId),
    );
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const where = ['cloud_account_id=?'];
    const params: any[] = [account.id];
    if (query.resourceType) {
      where.push('resource_type=?');
      params.push(query.resourceType);
    }
    if (query.region) {
      where.push('region=?');
      params.push(query.region);
    }
    if (query.includeDeleted !== 'true') where.push('deleted_at IS NULL');
    if (query.keyword) {
      where.push(
        '(resource_id LIKE ? OR display_name LIKE ? OR resource_arn LIKE ?)',
      );
      const keyword = `%${query.keyword.slice(0, 100)}%`;
      params.push(keyword, keyword, keyword);
    }
    const whereSql = where.join(' AND ');
    const result = await this.db.paginate<any>({
      countSql: `SELECT COUNT(*) total FROM aws_resource_current WHERE ${whereSql}`,
      dataSql: `SELECT id,cloud_account_id,region,resource_type,resource_id,resource_arn,display_name,status,
                       normalized_json,normalized_hash,first_seen_at,last_seen_at,deleted_at
                FROM aws_resource_current WHERE ${whereSql}
                ORDER BY resource_type,display_name,resource_id LIMIT ? OFFSET ?`,
      params,
      page,
      pageSize,
    });
    return {
      ...result,
      items: result.items.map((row: any) => this.resourceResponse(row)),
    };
  }

  async listRuns(
    actor: AwsGovernanceActor,
    accountId: number,
    page = 1,
    pageSize = 20,
  ) {
    const account = await this.requireAccountScope(actor, accountId);
    const result = await this.db.paginate<any>({
      countSql:
        'SELECT COUNT(*) total FROM aws_inventory_runs WHERE cloud_account_id=?',
      dataSql: `SELECT id,cloud_account_id,mode,status,regions_json,collector_version,resource_count,change_count,error_count,
                       errors_json,started_at,finished_at,created_at
                FROM aws_inventory_runs WHERE cloud_account_id=? ORDER BY id DESC LIMIT ? OFFSET ?`,
      params: [account.id],
      page: Math.max(1, Number(page || 1)),
      pageSize: Math.min(100, Math.max(1, Number(pageSize || 20))),
    });
    return {
      ...result,
      items: result.items.map((row: any) => this.runResponse(row)),
    };
  }

  async getRun(actor: AwsGovernanceActor, runId: number) {
    const rows = await this.db.query<any[]>(
      `SELECT r.*,a.environment_id,a.account_id,a.display_name FROM aws_inventory_runs r INNER JOIN aws_cloud_accounts a ON a.id=r.cloud_account_id WHERE r.id=?`,
      [runId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Inventory run not found');
    await this.requireAccountScope(actor, Number(row.cloud_account_id));
    return this.runResponse(row);
  }

  async listChanges(
    actor: AwsGovernanceActor,
    accountId: number,
    runId?: number,
    page = 1,
    pageSize = 50,
  ) {
    const account = await this.requireAccountScope(actor, accountId);
    const where = ['cloud_account_id=?'];
    const params: any[] = [account.id];
    if (runId) {
      where.push('run_id=?');
      params.push(runId);
    }
    const whereSql = where.join(' AND ');
    const result = await this.db.paginate<any>({
      countSql: `SELECT COUNT(*) total FROM aws_resource_changes WHERE ${whereSql}`,
      dataSql: `SELECT id,run_id,cloud_account_id,region,resource_type,resource_id,change_type,before_hash,after_hash,summary_json,detected_at
                FROM aws_resource_changes WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      params,
      page: Math.max(1, Number(page || 1)),
      pageSize: Math.min(100, Math.max(1, Number(pageSize || 50))),
    });
    return {
      ...result,
      items: result.items.map((row: any) => ({
        id: Number(row.id),
        runId: Number(row.run_id),
        accountId: Number(row.cloud_account_id),
        region: row.region,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        changeType: row.change_type,
        beforeHash: row.before_hash,
        afterHash: row.after_hash,
        summary: this.json(row.summary_json, {}),
        detectedAt: this.utcIso(row.detected_at),
      })),
    };
  }

  async diagnose(actor: AwsGovernanceActor, accountId: number) {
    const account = await this.requireAccountScope(actor, accountId);
    const region = account.defaultRegions[0];
    try {
      const clients = this.credentialFactory.createPlatformAuditClients(
        account,
        region,
      );
      const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
      return {
        ok: identity.Account === account.accountId,
        accountId: identity.Account || null,
        arn: identity.Arn || null,
        expectedAccountId: account.accountId,
        region,
        roleArn: account.platformAuditRoleArn,
        checkedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        ok: false,
        expectedAccountId: account.accountId,
        region,
        roleArn: account.platformAuditRoleArn,
        errorCode: String(error?.name || 'AWS_IDENTITY_ERROR'),
        errorMessage: String(
          error?.message || error || 'AWS identity check failed',
        ).slice(0, 500),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async startRun(
    actor: AwsGovernanceActor,
    accountId: number,
    mode: 'MANUAL' | 'SCHEDULED' = 'MANUAL',
  ) {
    const account = await this.requireAccountScope(actor, accountId);
    const active = await this.db.query<any[]>(
      `SELECT id,status FROM aws_inventory_runs WHERE cloud_account_id=? AND status IN ('PENDING','RUNNING') ORDER BY id DESC LIMIT 1`,
      [account.id],
    );
    if (active[0])
      return {
        runId: Number(active[0].id),
        status: active[0].status,
        joined: true,
      };
    const result: any = await this.db.query(
      `INSERT INTO aws_inventory_runs (cloud_account_id,mode,status,regions_json,collector_version,requested_by_user_id)
       VALUES (?,?,'PENDING',?,?,?)`,
      [
        account.id,
        mode,
        JSON.stringify(account.defaultRegions),
        COLLECTOR_VERSION,
        actor.userId || null,
      ],
    );
    const runId = Number(result.insertId);
    void this.executeRun(runId, account).catch((error) =>
      this.logger.error(
        `AWS inventory run ${runId} crashed: ${error?.message || error}`,
      ),
    );
    await this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName,
      environmentId: account.environmentId,
      method: 'POST',
      path: `/aws-governance/accounts/${account.id}/inventory-runs`,
      menuKey: 'menu:aws-governance',
      action: 'awsGovernance.inventory.start',
      actionName: '启动 AWS Inventory 同步',
      targetType: 'aws_cloud_account',
      targetId: account.accountId,
      requestSummary: {
        accountId: account.accountId,
        regions: account.defaultRegions,
        mode,
      },
      responseSummary: { runId },
      status: 'success',
      statusCode: 202,
    });
    return { runId, status: 'PENDING', joined: false };
  }

  private async executeRun(runId: number, account: AwsCloudAccount) {
    await this.db.query(
      `UPDATE aws_inventory_runs SET status='RUNNING',started_at=UTC_TIMESTAMP(3) WHERE id=? AND status='PENDING'`,
      [runId],
    );
    let collection: AwsInventoryCollection;
    try {
      collection = await this.collector.collect(
        account,
        account.defaultRegions,
      );
      await this.persistCollection(runId, account, collection);
      await this.detection
        .runForInventory(runId, account, collection)
        .catch((error) =>
          this.logger.error(
            `AWS detection for inventory run ${runId} failed: ${error?.message || error}`,
          ),
        );
    } catch (error: any) {
      await this.db.query(
        `UPDATE aws_inventory_runs SET status='FAILED',error_count=1,errors_json=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [
          JSON.stringify([
            {
              collector: 'orchestrator',
              region: 'global',
              code: String(error?.name || 'RUN_FAILED'),
              message: String(error?.message || error).slice(0, 500),
            },
          ]),
          runId,
        ],
      );
      throw error;
    }
  }

  private async persistCollection(
    runId: number,
    account: AwsCloudAccount,
    collection: AwsInventoryCollection,
  ) {
    const collectedAt = new Date().toISOString().slice(0, 23).replace('T', ' ');
    const resources = collection.resources;
    let changeCount = 0;
    await this.db.withTransaction(async (conn) => {
      const [currentRows] = await conn.execute<any[]>(
        `SELECT id,region,resource_type,resource_id,normalized_hash,normalized_json,missing_successful_runs,deleted_at
         FROM aws_resource_current WHERE cloud_account_id=?`,
        [account.id],
      );
      const current = new Map<string, any>(
        currentRows.map((row: any) => [
          this.resourceKey(row.region, row.resource_type, row.resource_id),
          row,
        ]),
      );
      const seen = new Set<string>();
      for (const resource of resources) {
        const key = this.resourceKey(
          resource.region,
          resource.resourceType,
          resource.resourceId,
        );
        seen.add(key);
        const previous = current.get(key);
        await conn.execute(
          `INSERT INTO aws_resource_snapshots
             (run_id,cloud_account_id,region,resource_type,resource_id,normalized_json,normalized_hash,collected_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            runId,
            account.id,
            resource.region,
            resource.resourceType,
            resource.resourceId,
            JSON.stringify(resource.normalized),
            resource.normalizedHash,
            collectedAt,
          ],
        );
        if (!previous) {
          await conn.execute(
            `INSERT INTO aws_resource_current
               (cloud_account_id,region,resource_type,resource_id,resource_arn,display_name,status,normalized_json,normalized_hash,first_seen_at,last_seen_at,last_run_id,missing_successful_runs,deleted_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,NULL)`,
            [
              account.id,
              resource.region,
              resource.resourceType,
              resource.resourceId,
              resource.resourceArn,
              resource.displayName,
              resource.status,
              JSON.stringify(resource.normalized),
              resource.normalizedHash,
              collectedAt,
              collectedAt,
              runId,
            ],
          );
          await this.insertChange(
            conn,
            runId,
            account.id,
            resource,
            'CREATED',
            null,
            resource.normalizedHash,
            { after: resource.normalized },
          );
          changeCount += 1;
        } else {
          const changed =
            previous.normalized_hash !== resource.normalizedHash ||
            previous.deleted_at;
          await conn.execute(
            `UPDATE aws_resource_current SET resource_arn=?,display_name=?,status=?,normalized_json=?,normalized_hash=?,last_seen_at=?,last_run_id=?,missing_successful_runs=0,deleted_at=NULL WHERE id=?`,
            [
              resource.resourceArn,
              resource.displayName,
              resource.status,
              JSON.stringify(resource.normalized),
              resource.normalizedHash,
              collectedAt,
              runId,
              previous.id,
            ],
          );
          if (changed) {
            await this.insertChange(
              conn,
              runId,
              account.id,
              resource,
              'UPDATED',
              previous.normalized_hash,
              resource.normalizedHash,
              {
                before: this.json(previous.normalized_json, {}),
                after: resource.normalized,
              },
            );
            changeCount += 1;
          }
        }
      }
      if (!collection.errors.length) {
        for (const previous of currentRows) {
          const key = this.resourceKey(
            previous.region,
            previous.resource_type,
            previous.resource_id,
          );
          if (seen.has(key) || previous.deleted_at) continue;
          const missingRuns = Number(previous.missing_successful_runs || 0) + 1;
          if (missingRuns >= 2) {
            await conn.execute(
              `UPDATE aws_resource_current SET missing_successful_runs=?,deleted_at=?,last_run_id=? WHERE id=?`,
              [missingRuns, collectedAt, runId, previous.id],
            );
            const resource: AwsInventoryResource = {
              region: previous.region,
              resourceType: previous.resource_type,
              resourceId: previous.resource_id,
              normalized: {},
              normalizedHash: previous.normalized_hash,
            };
            await this.insertChange(
              conn,
              runId,
              account.id,
              resource,
              'DELETED',
              previous.normalized_hash,
              null,
              { before: this.json(previous.normalized_json, {}) },
            );
            changeCount += 1;
          } else {
            await conn.execute(
              `UPDATE aws_resource_current SET missing_successful_runs=?,last_run_id=? WHERE id=?`,
              [missingRuns, runId, previous.id],
            );
          }
        }
      }
      const status = collection.errors.length
        ? resources.length
          ? 'PARTIAL'
          : 'FAILED'
        : 'SUCCEEDED';
      await conn.execute(
        `UPDATE aws_inventory_runs SET status=?,resource_count=?,change_count=?,error_count=?,errors_json=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [
          status,
          resources.length,
          changeCount,
          collection.errors.length,
          JSON.stringify(collection.errors),
          runId,
        ],
      );
    });
    const retentionDays = Math.max(
      7,
      Math.min(
        365,
        await this.siteConf.getNumber(
          'aws_governance.inventory.retention_days',
          90,
        ),
      ),
    );
    await this.db
      .query(
        `DELETE FROM aws_resource_snapshots WHERE collected_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY)`,
        [retentionDays],
      )
      .catch(() => undefined);
  }

  private insertChange(
    conn: any,
    runId: number,
    accountId: number,
    resource: AwsInventoryResource,
    type: string,
    beforeHash: string | null,
    afterHash: string | null,
    summary: unknown,
  ) {
    return conn.execute(
      `INSERT INTO aws_resource_changes
         (run_id,cloud_account_id,region,resource_type,resource_id,change_type,before_hash,after_hash,summary_json,detected_at)
       VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
      [
        runId,
        accountId,
        resource.region,
        resource.resourceType,
        resource.resourceId,
        type,
        beforeHash,
        afterHash,
        JSON.stringify(summary),
      ],
    );
  }

  @Interval(60_000)
  async scheduledCheck() {
    if (this.scheduledCheckRunning) return;
    this.scheduledCheckRunning = true;
    try {
      const enabled = await this.siteConf.getBoolean(
        'aws_governance.inventory.enabled',
        false,
      );
      if (!enabled) return;
      await this.db.withConnection(async (conn) => {
        const [lockRows] = await conn.query<any[]>(
          `SELECT GET_LOCK('dashboard:aws-governance:inventory',0) acquired`,
        );
        if (Number(lockRows[0]?.acquired || 0) !== 1) return;
        try {
          const intervalMinutes = Math.max(
            60,
            Math.min(
              1440,
              await this.siteConf.getNumber(
                'aws_governance.inventory.interval_minutes',
                360,
              ),
            ),
          );
          const accounts = await this.db.query<any[]>(
            `SELECT a.* FROM aws_cloud_accounts a
             WHERE a.enabled=1 AND NOT EXISTS (
               SELECT 1 FROM aws_inventory_runs r WHERE r.cloud_account_id=a.id
               AND (r.status IN ('PENDING','RUNNING') OR r.created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? MINUTE))
             ) ORDER BY a.id`,
            [intervalMinutes],
          );
          for (const row of accounts) {
            const account = this.accountFromRow(row);
            const result: any = await this.db.query(
              `INSERT INTO aws_inventory_runs (cloud_account_id,mode,status,regions_json,collector_version,requested_by_user_id)
               VALUES (?,'SCHEDULED','PENDING',?,?,NULL)`,
              [
                account.id,
                JSON.stringify(account.defaultRegions),
                COLLECTOR_VERSION,
              ],
            );
            await this.executeRun(Number(result.insertId), account);
          }
        } finally {
          await conn.query(
            `SELECT RELEASE_LOCK('dashboard:aws-governance:inventory')`,
          );
        }
      });
    } catch (error: any) {
      this.logger.warn(
        `Scheduled AWS inventory check failed: ${error?.message || error}`,
      );
    } finally {
      this.scheduledCheckRunning = false;
    }
  }

  private async requireAccountScope(
    actor: AwsGovernanceActor,
    accountId: number,
  ) {
    if (!Number.isInteger(accountId) || accountId <= 0)
      throw new BadRequestException('Invalid cloud account id');
    const rows = await this.db.query<any[]>(
      `SELECT DISTINCT a.* FROM aws_cloud_accounts a
       INNER JOIN aws_cloud_account_role_scopes s ON s.cloud_account_id=a.id
       INNER JOIN user_roles ur ON ur.role_id=s.role_id
       WHERE a.id=? AND ur.user_id=? LIMIT 1`,
      [accountId, actor.userId],
    );
    if (!rows[0])
      throw new ForbiddenException('No access to this AWS cloud account');
    return this.accountFromRow(rows[0]);
  }

  async scopedAccount(actor: AwsGovernanceActor, accountId: number) {
    return this.requireAccountScope(actor, accountId);
  }

  private accountFromRow(row: any): AwsCloudAccount {
    return {
      id: Number(row.id),
      environmentId: row.environment_id,
      accountId: row.account_id,
      displayName: row.display_name,
      partition: row.partition_name || 'aws',
      defaultRegions: this.json(row.default_regions_json, []).map(String),
      platformAuditRoleArn: row.platform_audit_role_arn,
      enabled: Number(row.enabled) === 1,
    };
  }

  private runResponse(row: any) {
    return {
      id: Number(row.id),
      accountId: Number(row.cloud_account_id),
      mode: row.mode,
      status: row.status,
      regions: this.json(row.regions_json, []),
      collectorVersion: row.collector_version,
      resourceCount: Number(row.resource_count || 0),
      changeCount: Number(row.change_count || 0),
      errorCount: Number(row.error_count || 0),
      errors: this.json(row.errors_json, []),
      startedAt: this.utcIso(row.started_at),
      finishedAt: this.utcIso(row.finished_at),
      createdAt: this.utcIso(row.created_at),
    };
  }

  private resourceResponse(row: any) {
    return {
      id: Number(row.id),
      accountId: Number(row.cloud_account_id),
      region: row.region,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      resourceArn: row.resource_arn,
      displayName: row.display_name,
      status: row.status,
      normalized: this.json(row.normalized_json, {}),
      normalizedHash: row.normalized_hash,
      firstSeenAt: this.utcIso(row.first_seen_at),
      lastSeenAt: this.utcIso(row.last_seen_at),
      deletedAt: this.utcIso(row.deleted_at),
    };
  }

  private resourceKey(
    region: string,
    resourceType: string,
    resourceId: string,
  ) {
    return `${region}\u0000${resourceType}\u0000${resourceId}`;
  }

  private json<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value !== 'string') return value as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private utcIso(value: unknown) {
    if (!value) return null;
    const raw = String(value).replace(' ', 'T');
    return /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`;
  }
}
