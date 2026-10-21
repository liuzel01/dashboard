import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import {
  AWS_DETECTION_RULES,
  findingFingerprint,
  findingStatusOnMatch,
  ruleChecksum,
  shouldAutoResolveFinding,
} from './aws-detection.rules';
import type {
  AwsCloudAccount,
  AwsGovernanceActor,
  AwsInventoryCollection,
} from './aws-governance.types';

const activeStatuses = ['OPEN', 'ACKNOWLEDGED', 'REMEDIATING', 'REOPENED'];

@Injectable()
export class AwsDetectionService {
  private expiryRunning = false;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
  ) {}

  async runForInventory(
    inventoryRunId: number,
    account: AwsCloudAccount,
    collection: AwsInventoryCollection,
  ) {
    if (
      !(await this.siteConf.getBoolean(
        'aws_governance.detection.enabled',
        true,
      ))
    )
      return;
    await this.syncRules();
    const versions = AWS_DETECTION_RULES.map((rule) => ({
      key: rule.key,
      version: rule.version,
      checksum: ruleChecksum(rule),
    }));
    const result: any = await this.db.query(
      `INSERT INTO aws_detection_runs (inventory_run_id,cloud_account_id,status,rule_version_set_json)
       VALUES (?,?,'RUNNING',?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [inventoryRunId, account.id, JSON.stringify(versions)],
    );
    const detectionRunId = Number(result.insertId);
    const acmExpiryDays = Math.max(
      1,
      Math.min(
        180,
        await this.siteConf.getNumber(
          'aws_governance.detection.acm_expiry_days',
          30,
        ),
      ),
    );
    const matches: Array<{
      fingerprint: string;
      rule: (typeof AWS_DETECTION_RULES)[number];
      resource: AwsInventoryCollection['resources'][number];
      summary: string;
      evidence: Record<string, unknown>;
    }> = [];
    const matched = new Set<string>();
    let opened = 0;
    let reopened = 0;
    let resolved = 0;
    try {
      for (const resource of collection.resources) {
        for (const rule of AWS_DETECTION_RULES) {
          if (!rule.resourceTypes.includes(resource.resourceType)) continue;
          const match = rule.evaluate(resource, { acmExpiryDays });
          if (!match) continue;
          const fingerprint = findingFingerprint(
            rule.key,
            account.accountId,
            resource,
          );
          matched.add(fingerprint);
          matches.push({ fingerprint, rule, resource, ...match });
        }
      }
      await this.db.withTransaction(async (conn) => {
        const [existingRows] = await conn.query<any[]>(
          `SELECT id,fingerprint,status,exempt_until FROM aws_findings WHERE cloud_account_id=? FOR UPDATE`,
          [account.id],
        );
        const existingByFingerprint = new Map(
          existingRows.map((row) => [String(row.fingerprint), row]),
        );
        opened = matches.filter(
          (match) => !existingByFingerprint.has(match.fingerprint),
        ).length;
        const reopenedRows = matches
          .map((match) => existingByFingerprint.get(match.fingerprint))
          .filter(
            (row) =>
              row &&
              findingStatusOnMatch(row.status, row.exempt_until) === 'REOPENED',
          );
        reopened = reopenedRows.length;

        for (let offset = 0; offset < matches.length; offset += 100) {
          const chunk = matches.slice(offset, offset + 100);
          const placeholders = chunk
            .map(
              () =>
                `(?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?)`,
            )
            .join(',');
          const params = chunk.flatMap(
            ({ fingerprint, rule, resource, summary, evidence }) => [
              fingerprint,
              rule.key,
              rule.version,
              account.id,
              account.environmentId,
              resource.region,
              resource.resourceType,
              resource.resourceId,
              resource.resourceArn || null,
              rule.severity,
              rule.title,
              summary,
              JSON.stringify(evidence),
              rule.remediationHint,
              detectionRunId,
            ],
          );
          await conn.execute(
            `INSERT INTO aws_findings
             (fingerprint,rule_key,rule_version,cloud_account_id,environment_id,region,resource_type,resource_id,resource_arn,severity,status,title,summary,evidence_json,remediation_hint,first_seen_at,last_seen_at,last_detection_run_id)
             VALUES ${placeholders}
             ON DUPLICATE KEY UPDATE
               rule_version=VALUES(rule_version),severity=VALUES(severity),
               status=IF(status='RESOLVED' OR (status='ACCEPTED_RISK' AND exempt_until IS NOT NULL AND exempt_until<=UTC_TIMESTAMP(3)),'REOPENED',status),
               title=VALUES(title),summary=VALUES(summary),evidence_json=VALUES(evidence_json),
               remediation_hint=VALUES(remediation_hint),last_seen_at=UTC_TIMESTAMP(3),
               last_detection_run_id=VALUES(last_detection_run_id),
               resolved_at=IF(status='REOPENED',NULL,resolved_at),
               exempt_until=IF(status='REOPENED',NULL,exempt_until)`,
            params,
          );
        }
        for (const row of reopenedRows) {
          const expired = row.status === 'ACCEPTED_RISK';
          await conn.execute(
            `INSERT INTO aws_finding_actions (finding_id,action,actor_user_id,note,before_status,after_status,metadata_json)
             VALUES (?,?,NULL,?,?,'REOPENED',?)`,
            [
              row.id,
              expired ? 'EXEMPTION_EXPIRED' : 'REOPEN',
              expired ? '风险接受已到期，检测仍命中' : '资源再次命中规则',
              row.status,
              JSON.stringify({ detectionRunId }),
            ],
          );
        }

        if (!collection.errors.length) {
          const toResolve = existingRows.filter((finding) =>
            shouldAutoResolveFinding(
              String(finding.status),
              matched.has(String(finding.fingerprint)),
              true,
            ),
          );
          resolved = toResolve.length;
          if (toResolve.length) {
            const ids = toResolve.map((row) => Number(row.id));
            await conn.execute(
              `UPDATE aws_findings SET status='RESOLVED',resolved_at=UTC_TIMESTAMP(3) WHERE id IN (${ids.map(() => '?').join(',')})`,
              ids,
            );
            const actionPlaceholders = toResolve
              .map(
                () =>
                  `(?, 'AUTO_RESOLVE', NULL, '规则不再命中', ?, 'RESOLVED', ?)`,
              )
              .join(',');
            await conn.execute(
              `INSERT INTO aws_finding_actions (finding_id,action,actor_user_id,note,before_status,after_status,metadata_json) VALUES ${actionPlaceholders}`,
              toResolve.flatMap((row) => [
                row.id,
                row.status,
                JSON.stringify({ detectionRunId }),
              ]),
            );
          }
        }
        await conn.execute(
          `UPDATE aws_detection_runs SET status='SUCCEEDED',matched_count=?,opened_count=?,reopened_count=?,resolved_count=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?`,
          [matched.size, opened, reopened, resolved, detectionRunId],
        );
      });
    } catch (error: any) {
      await this.db.query(
        `UPDATE aws_detection_runs SET status='FAILED',error_json=?,finished_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [
          JSON.stringify({
            code: error?.name || 'DETECTION_FAILED',
            message: String(error?.message || error).slice(0, 500),
          }),
          detectionRunId,
        ],
      );
      throw error;
    }
  }

  async summary(accountIds: number[]) {
    if (!accountIds.length) return { open: 0, bySeverity: [], trend: [] };
    const placeholders = accountIds.map(() => '?').join(',');
    const [countRows, severityRows, trendRows] = await Promise.all([
      this.db.query<any[]>(
        `SELECT COUNT(*) count FROM aws_findings WHERE cloud_account_id IN (${placeholders}) AND status IN ('OPEN','ACKNOWLEDGED','REMEDIATING','REOPENED')`,
        accountIds,
      ),
      this.db.query<any[]>(
        `SELECT severity,COUNT(*) count FROM aws_findings WHERE cloud_account_id IN (${placeholders}) AND status IN ('OPEN','ACKNOWLEDGED','REMEDIATING','REOPENED') GROUP BY severity`,
        accountIds,
      ),
      this.db.query<any[]>(
        `SELECT DATE(first_seen_at) day,COUNT(*) opened FROM aws_findings WHERE cloud_account_id IN (${placeholders}) AND first_seen_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 14 DAY) GROUP BY DATE(first_seen_at) ORDER BY day`,
        accountIds,
      ),
    ]);
    return {
      open: Number(countRows[0]?.count || 0),
      bySeverity: severityRows.map((row) => ({
        severity: row.severity,
        count: Number(row.count),
      })),
      trend: trendRows.map((row) => ({
        day: String(row.day).slice(0, 10),
        opened: Number(row.opened),
      })),
    };
  }

  async list(accountId: number, query: Record<string, string | undefined>) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const where = ['cloud_account_id=?'];
    const params: any[] = [accountId];
    if (query.status) {
      where.push('status=?');
      params.push(query.status);
    }
    if (query.severity) {
      where.push('severity=?');
      params.push(query.severity);
    }
    if (query.keyword) {
      where.push('(title LIKE ? OR resource_id LIKE ? OR summary LIKE ?)');
      const keyword = `%${query.keyword.slice(0, 100)}%`;
      params.push(keyword, keyword, keyword);
    }
    const whereSql = where.join(' AND ');
    const result = await this.db.paginate<any>({
      countSql: `SELECT COUNT(*) total FROM aws_findings WHERE ${whereSql}`,
      dataSql: `SELECT * FROM aws_findings WHERE ${whereSql} ORDER BY FIELD(severity,'CRITICAL','HIGH','MEDIUM','LOW'),last_seen_at DESC LIMIT ? OFFSET ?`,
      params,
      page,
      pageSize,
    });
    return {
      ...result,
      items: result.items.map((row: any) => this.response(row)),
    };
  }

  async exportCsv(
    accountId: number,
    query: Record<string, string | undefined>,
  ) {
    const where = ['cloud_account_id=?'];
    const params: any[] = [accountId];
    if (query.status) {
      where.push('status=?');
      params.push(query.status);
    }
    if (query.severity) {
      where.push('severity=?');
      params.push(query.severity);
    }
    if (query.keyword) {
      where.push('(title LIKE ? OR resource_id LIKE ? OR summary LIKE ?)');
      const keyword = `%${query.keyword.slice(0, 100)}%`;
      params.push(keyword, keyword, keyword);
    }
    const rows = await this.db.query<any[]>(
      `SELECT environment_id,region,severity,status,rule_key,title,resource_type,resource_id,summary,first_seen_at,last_seen_at,exempt_until
       FROM aws_findings WHERE ${where.join(' AND ')} ORDER BY FIELD(severity,'CRITICAL','HIGH','MEDIUM','LOW'),last_seen_at DESC LIMIT 5000`,
      params,
    );
    const columns = [
      'environment_id',
      'region',
      'severity',
      'status',
      'rule_key',
      'title',
      'resource_type',
      'resource_id',
      'summary',
      'first_seen_at',
      'last_seen_at',
      'exempt_until',
    ];
    const cell = (value: unknown) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    return `\uFEFF${[columns.join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\n')}`;
  }

  async detail(findingId: number, accountId: number) {
    const rows = await this.db.query<any[]>(
      `SELECT * FROM aws_findings WHERE id=? AND cloud_account_id=?`,
      [findingId, accountId],
    );
    if (!rows[0]) throw new NotFoundException('Finding not found');
    const actions = await this.db.query<any[]>(
      `SELECT id,action,actor_user_id,note,before_status,after_status,metadata_json,created_at FROM aws_finding_actions WHERE finding_id=? ORDER BY id DESC`,
      [findingId],
    );
    return {
      ...this.response(rows[0]),
      actions: actions.map((row) => ({
        ...row,
        metadata: this.json(row.metadata_json, {}),
        createdAt: this.iso(row.created_at),
      })),
    };
  }

  async transition(
    findingId: number,
    accountId: number,
    actor: AwsGovernanceActor,
    action: string,
    input: any,
  ) {
    const transitions: Record<string, { status: string; allowed: string[] }> = {
      acknowledge: { status: 'ACKNOWLEDGED', allowed: ['OPEN', 'REOPENED'] },
      'accept-risk': {
        status: 'ACCEPTED_RISK',
        allowed: ['OPEN', 'ACKNOWLEDGED', 'REOPENED'],
      },
      resolve: { status: 'RESOLVED', allowed: activeStatuses },
      reopen: {
        status: 'REOPENED',
        allowed: ['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'],
      },
      'false-positive': {
        status: 'FALSE_POSITIVE',
        allowed: ['OPEN', 'ACKNOWLEDGED', 'REOPENED'],
      },
    };
    const target = transitions[action];
    if (!target) throw new BadRequestException('Unsupported finding action');
    const note = String(input?.note || '').trim();
    if (!note) throw new BadRequestException('处置说明不能为空');
    const clientRequestId = String(input?.clientRequestId || '').trim();
    if (!clientRequestId)
      throw new BadRequestException('clientRequestId 不能为空');
    let exemptUntil: Date | null = null;
    if (action === 'accept-risk') {
      exemptUntil = new Date(String(input?.exemptUntil || ''));
      if (
        !Number.isFinite(exemptUntil.getTime()) ||
        exemptUntil.getTime() <= Date.now()
      )
        throw new BadRequestException('风险接受到期时间必须晚于当前时间');
    }
    const resultId = await this.db.withTransaction(async (conn) => {
      const [duplicate] = await conn.query<any[]>(
        `SELECT finding_id FROM aws_finding_actions WHERE client_request_id=?`,
        [clientRequestId],
      );
      if (duplicate[0]) return Number(duplicate[0].finding_id);
      const [rows] = await conn.query<any[]>(
        `SELECT * FROM aws_findings WHERE id=? AND cloud_account_id=? FOR UPDATE`,
        [findingId, accountId],
      );
      const finding = rows[0];
      if (!finding) throw new NotFoundException('Finding not found');
      if (!target.allowed.includes(String(finding.status)))
        throw new BadRequestException(
          `当前状态 ${finding.status} 不允许执行 ${action}`,
        );
      await conn.execute(
        `UPDATE aws_findings SET status=?,resolved_at=?,exempt_until=? WHERE id=?`,
        [
          target.status,
          target.status === 'RESOLVED' ? new Date() : null,
          exemptUntil,
          findingId,
        ],
      );
      await conn.execute(
        `INSERT INTO aws_finding_actions (finding_id,action,actor_user_id,note,before_status,after_status,client_request_id,metadata_json) VALUES (?,?,?,?,?,?,?,?)`,
        [
          findingId,
          action.replace('-', '_').toUpperCase(),
          actor.userId,
          note,
          finding.status,
          target.status,
          clientRequestId,
          JSON.stringify({ exemptUntil: exemptUntil?.toISOString() || null }),
        ],
      );
      return findingId;
    });
    return this.detail(resultId, accountId);
  }

  @Interval(60_000)
  async expireExemptions() {
    if (this.expiryRunning) return;
    this.expiryRunning = true;
    try {
      await this.db.withTransaction(async (conn) => {
        const [rows] = await conn.query<any[]>(
          `SELECT id FROM aws_findings WHERE status='ACCEPTED_RISK' AND exempt_until<=UTC_TIMESTAMP(3) FOR UPDATE`,
        );
        for (const row of rows) {
          await conn.execute(
            `UPDATE aws_findings SET status='REOPENED',exempt_until=NULL,resolved_at=NULL WHERE id=?`,
            [row.id],
          );
          await conn.execute(
            `INSERT INTO aws_finding_actions (finding_id,action,actor_user_id,note,before_status,after_status) VALUES (?,'EXEMPTION_EXPIRED',NULL,'风险接受已到期','ACCEPTED_RISK','REOPENED')`,
            [row.id],
          );
        }
      });
    } finally {
      this.expiryRunning = false;
    }
  }

  private async syncRules() {
    for (const rule of AWS_DETECTION_RULES) {
      await this.db.query(
        `INSERT INTO aws_detection_rules (rule_key,version,title,severity,enabled,resource_types_json,condition_json,remediation_hint,checksum)
         VALUES (?,?,?,?,1,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),severity=VALUES(severity),resource_types_json=VALUES(resource_types_json),condition_json=VALUES(condition_json),remediation_hint=VALUES(remediation_hint),checksum=VALUES(checksum),updated_at=UTC_TIMESTAMP(3)`,
        [
          rule.key,
          rule.version,
          rule.title,
          rule.severity,
          JSON.stringify(rule.resourceTypes),
          JSON.stringify(rule.condition),
          rule.remediationHint,
          ruleChecksum(rule),
        ],
      );
    }
  }

  private response(row: any) {
    return {
      id: Number(row.id),
      fingerprint: row.fingerprint,
      ruleKey: row.rule_key,
      ruleVersion: Number(row.rule_version),
      accountId: Number(row.cloud_account_id),
      environmentId: row.environment_id,
      region: row.region,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      resourceArn: row.resource_arn,
      severity: row.severity,
      status: row.status,
      title: row.title,
      summary: row.summary,
      evidence: this.json(row.evidence_json, {}),
      remediationHint: row.remediation_hint,
      firstSeenAt: this.iso(row.first_seen_at),
      lastSeenAt: this.iso(row.last_seen_at),
      resolvedAt: this.iso(row.resolved_at),
      exemptUntil: this.iso(row.exempt_until),
    };
  }
  private json<T>(value: unknown, fallback: T): T {
    if (!value) return fallback;
    if (typeof value !== 'string') return value as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  private iso(value: unknown) {
    if (!value) return null;
    const raw = String(value).replace(' ', 'T');
    return /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`;
  }
}
