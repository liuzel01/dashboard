import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type * as mysql from 'mysql2/promise';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import type {
  AlertmanagerAlert,
  AlertmanagerPayload,
} from '../oncall/oncall.types';
import { AiOpsPrometheusEvidenceService } from './ai-ops-prometheus-evidence.service';
import { AIOPS_REPLAY_CASES } from './ai-ops-replay.fixtures';
import { AiOpsContextEvidenceService } from './ai-ops-context-evidence.service';
import { AiOpsGroupCallbackService } from './ai-ops-group-callback.service';

type ActorContext = {
  userId: number | null;
  username: string;
  permissions: string[];
};

const MAX_ALERTS = 50;
const MAX_LABELS = 64;
const MAX_PAYLOAD_BYTES = 256 * 1024;
@Injectable()
export class AiOpsAlertInvestigationService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
    private readonly config: ConfigService,
    private readonly prometheus: AiOpsPrometheusEvidenceService,
    private readonly contextEvidence: AiOpsContextEvidenceService,
    private readonly groupCallback: AiOpsGroupCallbackService,
  ) {}

  async receiveAlertmanager(
    authorization: string | undefined,
    payload: AlertmanagerPayload,
  ) {
    await this.assertWebhookAuthorization(authorization);
    const alerts = this.validatePayload(payload);
    const allowed = await this.allowedAlertNames();
    const result = {
      received: alerts.length,
      accepted: 0,
      ignored: 0,
      created: 0,
      updated: 0,
      investigationIds: [] as number[],
    };
    for (const alert of alerts) {
      const labels = {
        ...(payload.commonLabels || {}),
        ...(alert.labels || {}),
      };
      const alertName = this.text(labels.alertname, 255) || 'UnknownAlert';
      if (!allowed.includes('*') && !allowed.includes(alertName)) {
        result.ignored += 1;
        continue;
      }
      const outcome = await this.persistAlert(
        payload,
        alert,
        labels,
        alertName,
        'ALERTMANAGER_ALERT',
      );
      result.accepted += 1;
      result.created += outcome.created ? 1 : 0;
      result.updated += outcome.created ? 0 : 1;
      result.investigationIds.push(outcome.id);
    }
    return result;
  }

  listReplayCases(environmentId: string, actor: ActorContext) {
    this.assertMenu(actor);
    return {
      items: AIOPS_REPLAY_CASES.filter(
        (item) => item.environmentId === environmentId,
      ).map((item) => ({
        key: item.key,
        name: item.name,
        environmentId: item.environmentId,
        description: item.description,
        expectedClassification: item.expectedClassification,
      })),
    };
  }

  async replay(environmentId: string, actor: ActorContext, caseKey: string) {
    this.assertMenu(actor);
    const replayCase = AIOPS_REPLAY_CASES.find(
      (item) => item.key === caseKey && item.environmentId === environmentId,
    );
    if (!replayCase)
      throw new NotFoundException(
        'Historical replay case not found for current environment',
      );
    const alert = replayCase.payload.alerts?.[0];
    if (!alert)
      throw new BadRequestException('Historical replay case has no alert');
    const labels = {
      ...(replayCase.payload.commonLabels || {}),
      ...(alert.labels || {}),
    };
    const alertName = this.text(labels.alertname, 255) || 'UnknownAlert';
    const outcome = await this.persistAlert(
      replayCase.payload,
      alert,
      labels,
      alertName,
      'HISTORICAL_REPLAY',
    );
    return {
      caseKey: replayCase.key,
      investigationId: outcome.id,
      created: outcome.created,
    };
  }

  async list(
    environmentId: string,
    actor: ActorContext,
    query: {
      status?: string;
      keyword?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    this.assertMenu(actor);
    const page = this.positiveInteger(query.page, 1, 1_000_000);
    const pageSize = this.positiveInteger(query.pageSize, 20, 100);
    const clauses = ['environment_id = ?'];
    const params: unknown[] = [environmentId];
    if (query.status) {
      clauses.push('status = ?');
      params.push(this.text(query.status, 32).toUpperCase());
    }
    if (query.keyword) {
      const like = `%${this.text(query.keyword, 128)}%`;
      clauses.push(
        '(alert_name LIKE ? OR service_name LIKE ? OR namespace LIKE ? OR summary LIKE ?)',
      );
      params.push(like, like, like, like);
    }
    const where = clauses.join(' AND ');
    const total = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM aiops_investigations WHERE ${where}`,
      params as any[],
    );
    const items = await this.db.query<any[]>(
      `SELECT id, environment_id, source_type, source_status, alert_name, severity, namespace, service_name,
              status, playbook_key, summary, classification, confidence, insufficient_evidence,
              source_started_at, completed_at, resolved_at, created_at, updated_at
       FROM aiops_investigations WHERE ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params as any[],
    );
    return { items, total: Number(total[0]?.total || 0), page, pageSize };
  }

  async get(environmentId: string, actor: ActorContext, id: number) {
    this.assertMenu(actor);
    const rows = await this.db.query<Array<Record<string, unknown>>>(
      'SELECT * FROM aiops_investigations WHERE id=? AND environment_id=? LIMIT 1',
      [id, environmentId],
    );
    if (!rows[0]) throw new NotFoundException('AI investigation not found');
    const [steps, evidence, feedback] = await Promise.all([
      this.db.query<Array<Record<string, unknown>>>(
        'SELECT * FROM aiops_investigation_steps WHERE investigation_id=? ORDER BY id',
        [id],
      ),
      this.db.query<Array<Record<string, unknown>>>(
        'SELECT * FROM aiops_investigation_evidence WHERE investigation_id=? ORDER BY id',
        [id],
      ),
      this.db.query<Array<Record<string, unknown>>>(
        'SELECT id, actor_username, rating, comment, created_at FROM aiops_investigation_feedback WHERE investigation_id=? ORDER BY id DESC',
        [id],
      ),
    ]);
    return { ...rows[0], steps, evidence, feedback };
  }

  async qualitySummary(environmentId: string, actor: ActorContext) {
    this.assertMenu(actor);
    const [overview, sources, feedback, failures] = await Promise.all([
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT COUNT(*) total,
                SUM(status='COMPLETED') completed,
                SUM(insufficient_evidence=1) insufficient_evidence,
                SUM(source_type='HISTORICAL_REPLAY') replay_count,
                SUM(alert_name='JVMHeapHighSynthetic') synthetic_count
           FROM aiops_investigations WHERE environment_id=?`,
        [environmentId],
      ),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT e.source_system, COUNT(DISTINCT e.investigation_id) investigation_count, COUNT(*) evidence_count
           FROM aiops_investigation_evidence e
           INNER JOIN aiops_investigations i ON i.id=e.investigation_id
          WHERE i.environment_id=? GROUP BY e.source_system ORDER BY e.source_system`,
        [environmentId],
      ),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT f.rating, COUNT(*) count
           FROM aiops_investigation_feedback f
           INNER JOIN aiops_investigations i ON i.id=f.investigation_id
          WHERE i.environment_id=? GROUP BY f.rating ORDER BY f.rating`,
        [environmentId],
      ),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT s.step_key, s.status, COUNT(*) count
           FROM aiops_investigation_steps s
           INNER JOIN aiops_investigations i ON i.id=s.investigation_id
          WHERE i.environment_id=? AND s.status IN ('PARTIAL','FAILED')
          GROUP BY s.step_key, s.status ORDER BY s.step_key, s.status`,
        [environmentId],
      ),
    ]);
    return {
      environmentId,
      generatedAt: new Date().toISOString(),
      overview: overview[0] || {},
      evidenceCoverage: sources,
      feedback,
      partialOrFailedSteps: failures,
      note: 'Synthetic exercises are reported separately and must not be counted as real alert accuracy or MTTR.',
    };
  }

  async addFeedback(
    environmentId: string,
    actor: ActorContext,
    id: number,
    ratingRaw: string,
    commentRaw?: string,
  ) {
    this.assertMenu(actor);
    await this.get(environmentId, actor, id);
    const rating = this.text(ratingRaw, 32).toUpperCase();
    if (
      ![
        'EFFECTIVE',
        'PARTIAL',
        'INEFFECTIVE',
        'INSUFFICIENT_EVIDENCE',
      ].includes(rating)
    ) {
      throw new BadRequestException('Invalid feedback rating');
    }
    await this.db.query(
      'INSERT INTO aiops_investigation_feedback (investigation_id, actor_user_id, actor_username, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
      [
        id,
        actor.userId,
        actor.username,
        rating,
        this.text(commentRaw, 1000) || null,
      ],
    );
    return { ok: true };
  }

  private async persistAlert(
    payload: AlertmanagerPayload,
    alert: AlertmanagerAlert,
    labels: Record<string, unknown>,
    alertName: string,
    sourceType: 'ALERTMANAGER_ALERT' | 'HISTORICAL_REPLAY',
  ) {
    const annotations = {
      ...(payload.commonAnnotations || {}),
      ...(alert.annotations || {}),
    };
    const environmentId =
      this.text(labels.environment || labels.env, 64) ||
      (
        await this.siteConf.getString(
          'aiops.alertmanager.default_environment',
          'mgbx',
        )
      ).trim() ||
      'mgbx';
    const fingerprint = this.text(alert.fingerprint, 255) || this.hash(labels);
    const startedAt =
      this.mysqlDate(alert.startsAt) ||
      this.mysqlDate(new Date().toISOString())!;
    const resolved =
      this.text(alert.status || payload.status, 32).toLowerCase() ===
      'resolved';
    const sourceStatus = resolved ? 'RESOLVED' : 'FIRING';
    const severity = this.text(labels.severity, 32) || null;
    const namespace = this.text(labels.namespace, 255) || null;
    const service = this.text(labels.service || labels.job, 255) || null;
    const resource =
      this.text(labels.pod || labels.container || labels.instance, 255) || null;
    const description = this.text(
      annotations.description || annotations.summary,
      1000,
    );
    const specialized = resolved
      ? null
      : await this.prometheus.collect({
          environmentId,
          alertName,
          startedAt: new Date(`${startedAt.replace(' ', 'T')}Z`).toISOString(),
          labels,
        });
    const contextual = resolved
      ? { evidence: [], findings: [], missingEvidence: [], timeline: [] }
      : await this.contextEvidence.collect({
          environmentId,
          startedAt: new Date(`${startedAt.replace(' ', 'T')}Z`).toISOString(),
          namespace,
          service,
          labels,
          replay: sourceType === 'HISTORICAL_REPLAY',
        });
    const playbookKey = specialized?.playbookKey || 'GENERIC_PROMETHEUS_ALERT';
    const playbookVersion = specialized?.playbookVersion || 'generic-v1';
    const classification = resolved
      ? 'RESOLVED'
      : specialized?.classification ||
        (severity === 'info' ? 'OBSERVE' : 'NEEDS_INVESTIGATION');
    const summary = resolved
      ? `${alertName} 已恢复；保留历史证据供回看。`
      : `${alertName} 已进入通用告警调查。${description ? ` ${description}` : ''}`.slice(
          0,
          2000,
        );
    const report = {
      kind: 'generic-alert-report',
      replay: sourceType === 'HISTORICAL_REPLAY',
      facts: {
        alertName,
        severity,
        environmentId,
        namespace,
        service,
        resource,
        sourceStatus,
        startedAt,
      },
      findings: [
        ...(specialized?.findings || [
          '已接收 Alertmanager 结构化事件并完成去重。',
          '当前仅依据告警元数据生成通用报告，尚未证明根因。',
        ]),
        ...contextual.findings,
      ],
      evidenceIds: [
        ...(specialized?.evidence.map((item) => item.evidenceId) || []),
        ...contextual.evidence.map((item) => item.evidenceId),
      ],
      missingEvidence: [
        ...(specialized?.missingEvidence || [
          'Prometheus 源指标趋势',
          '日志证据',
        ]),
        ...contextual.missingEvidence,
      ],
      timeline: [
        {
          observedAt: new Date(`${startedAt.replace(' ', 'T')}Z`).toISOString(),
          source: sourceType,
          title: `${sourceStatus} ${alertName}`,
        },
        ...(specialized?.evidence.map((item) => ({
          observedAt: item.observedAt,
          source: item.sourceSystem,
          title: item.title,
          evidenceId: item.evidenceId,
        })) || []),
        ...contextual.timeline,
      ].sort(
        (left, right) =>
          Date.parse(left.observedAt) - Date.parse(right.observedAt),
      ),
      recommendations: specialized?.recommendations || [
        '进入调查详情核对原始指标与关联证据。',
      ],
    };

    const outcome = await this.db.withTransaction(async (conn) => {
      const [existing] = await conn.execute<
        Array<mysql.RowDataPacket & { id: number }>
      >(
        `SELECT id FROM aiops_investigations WHERE environment_id=? AND source_type=?
         AND source_fingerprint=? AND source_started_at=? AND playbook_version=? LIMIT 1 FOR UPDATE`,
        [environmentId, sourceType, fingerprint, startedAt, playbookVersion],
      );
      let id = Number(existing[0]?.id || 0);
      const created = !id;
      if (created) {
        const [insert] = await conn.execute<mysql.ResultSetHeader>(
          `INSERT INTO aiops_investigations
           (environment_id, source_type, source_fingerprint, source_started_at, source_status, alert_name, severity,
            namespace, service_name, resource_name, status, playbook_key, playbook_version, summary, classification,
            confidence, insufficient_evidence, report_json, started_at, completed_at, resolved_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?,
                   ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
          [
            environmentId,
            sourceType,
            fingerprint,
            startedAt,
            sourceStatus,
            alertName,
            severity,
            namespace,
            service,
            resource,
            playbookKey,
            playbookVersion,
            summary,
            classification,
            specialized?.confidence || 'LOW',
            specialized?.insufficientEvidence === false ? 0 : 1,
            JSON.stringify(report),
            resolved ? this.mysqlDate(alert.endsAt) : null,
          ],
        );
        id = Number(insert.insertId);
      } else {
        await conn.execute(
          `UPDATE aiops_investigations SET source_status=?, summary=?, classification=?, confidence=?, insufficient_evidence=?, report_json=?,
           resolved_at=IF(?='RESOLVED', COALESCE(?, UTC_TIMESTAMP()), resolved_at), updated_at=UTC_TIMESTAMP() WHERE id=?`,
          [
            sourceStatus,
            summary,
            classification,
            specialized?.confidence || 'LOW',
            specialized?.insufficientEvidence === false ? 0 : 1,
            JSON.stringify(report),
            sourceStatus,
            this.mysqlDate(alert.endsAt),
            id,
          ],
        );
      }
      await conn.execute(
        `INSERT INTO aiops_investigation_steps
         (investigation_id, step_key, tool_name, status, result_count, summary, started_at, completed_at, created_at)
         VALUES (?, ?, ?, 'COMPLETED', 1, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE status='COMPLETED', result_count=result_count+1, summary=VALUES(summary), completed_at=UTC_TIMESTAMP()`,
        [
          id,
          sourceType === 'HISTORICAL_REPLAY'
            ? 'historical.replay'
            : 'alertmanager.ingest',
          sourceType === 'HISTORICAL_REPLAY'
            ? 'fixture-replay'
            : 'alertmanager',
          `${sourceStatus} ${alertName}`,
        ],
      );
      for (const item of [
        ...(specialized?.evidence || []),
        ...contextual.evidence,
      ]) {
        await conn.execute(
          `INSERT INTO aiops_investigation_evidence
           (investigation_id, evidence_id, evidence_type, source_system, observed_at, title, content_json, source_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE content_json=VALUES(content_json), observed_at=VALUES(observed_at), source_url=VALUES(source_url)`,
          [
            id,
            item.evidenceId,
            item.evidenceType,
            item.sourceSystem,
            this.mysqlDate(item.observedAt),
            item.title,
            JSON.stringify(item.content),
            item.sourceUrl,
          ],
        );
      }
      if (specialized) {
        await conn.execute(
          `INSERT INTO aiops_investigation_steps
           (investigation_id, step_key, tool_name, status, result_count, summary, started_at, completed_at, created_at)
           VALUES (?, 'prometheus.collect', 'prometheus', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE status=VALUES(status), result_count=VALUES(result_count), summary=VALUES(summary), completed_at=UTC_TIMESTAMP()`,
          [
            id,
            specialized.evidence.length ? 'COMPLETED' : 'PARTIAL',
            specialized.evidence.length,
            specialized.evidence.length
              ? `已保存 ${specialized.evidence.length} 组指标证据`
              : '未取得 Prometheus 指标证据',
          ],
        );
      }
      if (!resolved) {
        const evidenceBySource = contextual.evidence.reduce<
          Record<string, number>
        >((counts, item) => {
          counts[item.sourceSystem] = (counts[item.sourceSystem] || 0) + 1;
          return counts;
        }, {});
        const sourceSummary = Object.entries(evidenceBySource)
          .map(([source, count]) => `${source}=${count}`)
          .join(', ');
        await conn.execute(
          `INSERT INTO aiops_investigation_steps
           (investigation_id, step_key, tool_name, status, result_count, summary, started_at, completed_at, created_at)
           VALUES (?, 'context.collect', 'kubernetes+loki+cicd', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE status=VALUES(status), result_count=VALUES(result_count), summary=VALUES(summary), completed_at=UTC_TIMESTAMP()`,
          [
            id,
            contextual.evidence.length ? 'COMPLETED' : 'PARTIAL',
            contextual.evidence.length,
            contextual.evidence.length
              ? `已保存 ${contextual.evidence.length} 组上下文证据（${sourceSummary}）`
              : `未取得上下文证据；${contextual.missingEvidence.join('；')}`.slice(
                  0,
                  1000,
                ),
          ],
        );
      }
      const evidenceId = `alert-${this.hash(`${fingerprint}:${sourceStatus}:${alert.endsAt || alert.startsAt || ''}`).slice(0, 16)}`;
      await conn.execute(
        `INSERT INTO aiops_investigation_evidence
         (investigation_id, evidence_id, evidence_type, source_system, observed_at, title, content_json, source_url, created_at)
         VALUES (?, ?, 'ALERT_EVENT', ?, ?, ?, ?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE content_json=VALUES(content_json), observed_at=VALUES(observed_at)`,
        [
          id,
          evidenceId,
          sourceType === 'HISTORICAL_REPLAY'
            ? 'fixture-replay'
            : 'alertmanager',
          resolved ? this.mysqlDate(alert.endsAt) : startedAt,
          `${sourceType === 'HISTORICAL_REPLAY' ? 'REPLAY' : sourceStatus} ${alertName}`,
          JSON.stringify({
            labels: this.limitObject(labels),
            annotations: this.limitObject(annotations),
            status: sourceStatus,
            replay: sourceType === 'HISTORICAL_REPLAY',
          }),
          this.safeUrl(alert.generatorURL || payload.externalURL),
        ],
      );
      return { id, created };
    });
    await this.groupCallback.enqueue({
      investigationId: outcome.id,
      sourceType,
      sourceStatus,
      alertName,
      environmentId,
      classification,
      confidence: specialized?.confidence || 'LOW',
      summary,
    });
    return outcome;
  }

  private validatePayload(payload: AlertmanagerPayload): AlertmanagerAlert[] {
    if (
      Buffer.byteLength(JSON.stringify(payload || {}), 'utf8') >
      MAX_PAYLOAD_BYTES
    )
      throw new BadRequestException(
        `Alertmanager payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
      );
    if (
      !payload ||
      !Array.isArray(payload.alerts) ||
      payload.alerts.length === 0
    )
      throw new BadRequestException('Alertmanager payload must include alerts');
    if (payload.alerts.length > MAX_ALERTS)
      throw new BadRequestException(
        `Alertmanager payload exceeds ${MAX_ALERTS} alerts`,
      );
    for (const alert of payload.alerts) {
      if (
        Object.keys({
          ...(payload.commonLabels || {}),
          ...(alert.labels || {}),
        }).length > MAX_LABELS
      )
        throw new BadRequestException(`Alert labels exceed ${MAX_LABELS} keys`);
    }
    return payload.alerts;
  }

  private async assertWebhookAuthorization(value?: string) {
    const expected = (
      await this.siteConf.getString(
        'aiops.alertmanager.bearer_token',
        this.config.get<string>('AIOPS_ALERTMANAGER_BEARER_TOKEN') || '',
      )
    ).trim();
    if (!expected)
      throw new UnauthorizedException(
        'AIOps Alertmanager webhook token is not configured',
      );
    const supplied = String(value || '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new UnauthorizedException('Invalid AIOps Alertmanager token');
  }

  private async allowedAlertNames() {
    const raw = await this.siteConf.getString(
      'aiops.alertmanager.allowed_alerts',
      'KylinBackendServiceHttpLatencyHigh,CPUThrottlingHigh',
    );
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private assertMenu(actor: ActorContext) {
    if (!actor.permissions.includes('menu:ai-ops'))
      throw new ForbiddenException('Missing permissions: menu:ai-ops');
  }

  private positiveInteger(value: unknown, fallback: number, max: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 1) return fallback;
    return Math.min(max, Math.floor(numeric));
  }

  private text(value: unknown, max: number) {
    const raw =
      value === null || value === undefined
        ? ''
        : typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value) || '';
    return Array.from(raw)
      .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
      .join('')
      .trim()
      .slice(0, max);
  }
  private hash(value: unknown) {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value ?? {}) || '';
    return createHash('sha256').update(serialized).digest('hex');
  }
  private mysqlDate(value: unknown): string | null {
    const date = new Date(this.text(value, 128));
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 19).replace('T', ' ');
  }
  private limitObject(value: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_LABELS)
        .map(([key, item]) => [this.text(key, 128), this.text(item, 1000)]),
    );
  }
  private safeUrl(value: unknown) {
    const text = this.text(value, 1024);
    return /^https?:\/\//i.test(text) ? text : null;
  }
}
