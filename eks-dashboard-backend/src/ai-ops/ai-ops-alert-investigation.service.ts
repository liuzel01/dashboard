import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
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
import { AiOpsAlertAgentService } from './ai-ops-alert-agent.service';
import { AiOpsAlertNoiseControlService } from './ai-ops-alert-noise-control.service';

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
  private readonly logger = new Logger(AiOpsAlertInvestigationService.name);
  private queueRunning = false;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
    private readonly config: ConfigService,
    private readonly prometheus: AiOpsPrometheusEvidenceService,
    private readonly contextEvidence: AiOpsContextEvidenceService,
    private readonly groupCallback: AiOpsGroupCallbackService,
    private readonly alertAgent: AiOpsAlertAgentService,
    private readonly noiseControl: AiOpsAlertNoiseControlService,
  ) {}

  async receiveAlertmanager(
    authorization: string | undefined,
    payload: AlertmanagerPayload,
  ) {
    await this.assertWebhookAuthorization(authorization);
    const alerts = this.validatePayload(payload);
    const excluded = await this.excludedAlertNames();
    const result = {
      received: alerts.length,
      accepted: 0,
      ignored: 0,
      queued: 0,
      duplicate: 0,
      eventIds: [] as number[],
    };
    const [{ total }] = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM aiops_alert_event_queue WHERE status IN ('PENDING','RUNNING')`,
    );
    const maxPending = await this.siteConf.getNumber(
      'aiops.alertmanager.queue.max_pending',
      1000,
    );
    if (Number(total || 0) + alerts.length > maxPending)
      throw new ServiceUnavailableException(
        'AIOps alert queue capacity exceeded; retry later',
      );
    for (const alert of alerts) {
      const labels = {
        ...(payload.commonLabels || {}),
        ...(alert.labels || {}),
      };
      const alertName = this.text(labels.alertname, 255) || 'UnknownAlert';
      if (
        excluded.includes(alertName) ||
        this.text(labels.aiops_enabled, 16).toLowerCase() === 'false'
      ) {
        result.ignored += 1;
        continue;
      }
      const environmentId = await this.environmentId(labels);
      if (await this.noiseControl.suppresses(environmentId, labels)) {
        result.ignored += 1;
        continue;
      }
      const outcome = await this.enqueueAlert(
        payload,
        alert,
        labels,
        alertName,
      );
      result.accepted += 1;
      result.queued += outcome.created ? 1 : 0;
      result.duplicate += outcome.created ? 0 : 1;
      result.eventIds.push(outcome.id);
    }
    return result;
  }

  @Interval(2_000)
  async processQueuedAlerts() {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      const job = await this.claimQueuedAlert();
      if (!job) return;
      try {
        const payload = this.alertmanagerPayload(job.payload_json);
        const alert = payload.alerts?.[0];
        if (!alert) throw new Error('Queued payload has no alert');
        const labels = {
          ...(payload.commonLabels || {}),
          ...(alert.labels || {}),
        };
        const alertName = this.text(labels.alertname, 255) || 'UnknownAlert';
        const outcome = await this.persistAlert(
          payload,
          alert,
          labels,
          alertName,
          'ALERTMANAGER_ALERT',
        );
        await this.db.query(
          `UPDATE aiops_alert_event_queue SET status='COMPLETED', investigation_id=?, completed_at=UTC_TIMESTAMP(),
           error_code=NULL, error_summary=NULL, updated_at=UTC_TIMESTAMP() WHERE id=?`,
          [outcome.id, job.id],
        );
      } catch (error) {
        const maxAttempts = await this.siteConf.getNumber(
          'aiops.alertmanager.queue.max_attempts',
          3,
        );
        const retry = job.attempt_count < maxAttempts;
        const failure = this.stableFailure(error);
        await this.db.query(
          `UPDATE aiops_alert_event_queue SET status=?, available_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
           completed_at=IF(?='FAILED', UTC_TIMESTAMP(), NULL), error_code=?, error_summary=?, updated_at=UTC_TIMESTAMP() WHERE id=?`,
          [
            retry ? 'PENDING' : 'FAILED',
            Math.min(300, 10 * 2 ** Math.max(0, job.attempt_count - 1)),
            retry ? 'PENDING' : 'FAILED',
            failure.code,
            failure.summary,
            job.id,
          ],
        );
        this.logger.warn(
          `AIOps alert event ${job.id} ${retry ? 'will retry' : 'failed'}: ${failure.code}`,
        );
      }
    } finally {
      this.queueRunning = false;
    }
  }

  private async enqueueAlert(
    payload: AlertmanagerPayload,
    alert: AlertmanagerAlert,
    labels: Record<string, unknown>,
    alertName: string,
  ) {
    const environmentId = await this.environmentId(labels);
    const sourceStatus =
      this.text(alert.status || payload.status, 32).toLowerCase() === 'resolved'
        ? 'RESOLVED'
        : 'FIRING';
    const eventKey = this.hash(
      `${environmentId}:${this.text(alert.fingerprint, 255) || this.hash(labels)}:${sourceStatus}:${this.text(alert.startsAt, 128)}:${this.text(alert.endsAt, 128)}`,
    );
    const singlePayload = { ...payload, alerts: [alert] };
    return this.db.withTransaction(async (conn) => {
      const [insert] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT IGNORE INTO aiops_alert_event_queue
         (event_key, environment_id, alert_name, source_status, payload_json, status, attempt_count, available_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [
          eventKey,
          environmentId,
          alertName,
          sourceStatus,
          JSON.stringify(singlePayload),
        ],
      );
      const [rows] = await conn.execute<
        Array<
          mysql.RowDataPacket & {
            id: number;
            status: string;
            investigation_id: number | null;
          }
        >
      >(
        'SELECT id, status, investigation_id FROM aiops_alert_event_queue WHERE event_key=? LIMIT 1',
        [eventKey],
      );
      const row = rows[0];
      return {
        id: Number(row.id),
        created: Number(insert.affectedRows || 0) > 0,
      };
    });
  }

  private async claimQueuedAlert() {
    return this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<
        Array<
          mysql.RowDataPacket & {
            id: number;
            payload_json: unknown;
            attempt_count: number;
          }
        >
      >(
        `SELECT id, payload_json, attempt_count FROM aiops_alert_event_queue
         WHERE (status='PENDING' AND available_at<=UTC_TIMESTAMP())
            OR (status='RUNNING' AND started_at<DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))
         ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const row = rows[0];
      if (!row) return null;
      await conn.execute(
        `UPDATE aiops_alert_event_queue SET status='RUNNING', attempt_count=attempt_count+1,
         started_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP() WHERE id=?`,
        [row.id],
      );
      return { ...row, attempt_count: Number(row.attempt_count) + 1 };
    });
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
    const [steps, evidence, feedback, attempts] = await Promise.all([
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
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT id, status, attempt_count, error_code, error_summary, created_at, started_at, completed_at
         FROM aiops_alert_event_queue WHERE investigation_id=? ORDER BY id DESC`,
        [id],
      ),
    ]);
    return { ...rows[0], steps, evidence, feedback, attempts };
  }

  async retry(environmentId: string, actor: ActorContext, id: number) {
    this.assertMenu(actor);
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM aiops_investigations WHERE id=? AND environment_id=? LIMIT 1',
      [id, environmentId],
    );
    if (!rows[0]) throw new NotFoundException('AI investigation not found');
    const events = await this.db.query<Array<{ payload_json: unknown }>>(
      `SELECT payload_json FROM aiops_alert_event_queue
       WHERE investigation_id=? AND source_status='FIRING' ORDER BY id DESC LIMIT 1`,
      [id],
    );
    if (!events[0])
      throw new BadRequestException(
        'This investigation has no retryable Alertmanager event',
      );
    const eventKey = this.hash(
      `manual-retry:${id}:${Date.now()}:${actor.username}`,
    );
    const result = await this.db.query<mysql.ResultSetHeader>(
      `INSERT INTO aiops_alert_event_queue
       (event_key, environment_id, alert_name, source_status, payload_json, status, attempt_count, available_at, investigation_id, created_at, updated_at)
       SELECT ?, environment_id, alert_name, source_status, ?, 'PENDING', 0, UTC_TIMESTAMP(), id, UTC_TIMESTAMP(), UTC_TIMESTAMP()
       FROM aiops_investigations WHERE id=?`,
      [eventKey, this.jsonParameter(events[0].payload_json), id],
    );
    return { queued: true, eventId: Number(result.insertId || 0) };
  }

  async qualitySummary(environmentId: string, actor: ActorContext) {
    this.assertMenu(actor);
    const [overview, sources, feedback, failures, queue] = await Promise.all([
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
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT status, COUNT(*) count FROM aiops_alert_event_queue
         WHERE environment_id=? GROUP BY status ORDER BY status`,
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
      queue,
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
        'NOISE_CANDIDATE',
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
    const environmentId = await this.environmentId(labels);
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
    const hasSpecializedPlaybook = this.prometheus.supports(alertName);
    const shouldCollect = !resolved && hasSpecializedPlaybook;
    const specialized = shouldCollect
      ? await this.prometheus.collect({
          environmentId,
          alertName,
          startedAt: new Date(`${startedAt.replace(' ', 'T')}Z`).toISOString(),
          labels,
        })
      : null;
    const contextual = shouldCollect
      ? await this.contextEvidence.collect({
          environmentId,
          startedAt: new Date(`${startedAt.replace(' ', 'T')}Z`).toISOString(),
          namespace,
          service,
          labels,
          replay: sourceType === 'HISTORICAL_REPLAY',
        })
      : { evidence: [], findings: [], missingEvidence: [], timeline: [] };
    const playbookKey = specialized?.playbookKey || 'GENERIC_PROMETHEUS_ALERT';
    const playbookVersion = specialized?.playbookVersion || 'generic-v1';
    const classification = resolved
      ? 'RESOLVED'
      : specialized?.classification ||
        (severity === 'info' ? 'OBSERVE' : 'NEEDS_INVESTIGATION');
    let summary = resolved
      ? `${alertName} 已恢复；保留历史证据供回看。`
      : `${alertName} 已进入通用告警调查。${description ? ` ${description}` : ''}`.slice(
          0,
          2000,
        );
    const contextSources = new Set(
      contextual.evidence.map((item) => item.sourceSystem),
    );
    const specializedMissing = (
      specialized?.missingEvidence || ['Prometheus 源指标趋势', '日志证据']
    ).filter((item) => {
      if (/发布|CI\/CD|release/i.test(item)) return false;
      if (/日志/i.test(item) && contextSources.has('grafana-loki'))
        return false;
      if (
        /Kubernetes|Pod\/Node/i.test(item) &&
        contextSources.has('kubernetes')
      )
        return false;
      return true;
    });
    const report: Record<string, unknown> = {
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
      missingEvidence: [...specializedMissing, ...contextual.missingEvidence],
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
        hasSpecializedPlaybook
          ? '进入调查详情核对原始指标与关联证据。'
          : '当前告警已完成轻量接入；如需自动深度取证，请补充专项 Playbook。',
      ],
    };
    const baselineConfidence = specialized?.confidence || 'LOW';
    const baselineInsufficientEvidence =
      specialized?.insufficientEvidence !== false;
    const agent = shouldCollect
      ? await this.alertAgent.analyze({
          environmentId,
          alertName,
          baselineConfidence,
          baselineInsufficientEvidence,
          report,
          evidence: [...(specialized?.evidence || []), ...contextual.evidence],
        })
      : ({ status: 'DISABLED' } as const);
    if (agent.status === 'COMPLETED') {
      report.agentAnalysis = {
        provider: agent.provider,
        model: agent.model,
        summary: agent.summary,
        findings: agent.findings,
        evidenceIds: agent.evidenceIds,
        confidence: agent.confidence,
        insufficientEvidence: agent.insufficientEvidence,
        generatedAt: new Date().toISOString(),
      };
      summary = agent.summary;
    } else if (agent.status === 'FAILED') {
      report.agentAnalysis = {
        status: 'FAILED',
        errorSummary: agent.errorSummary,
        fallback: 'DETERMINISTIC_REPORT',
      };
    }
    report.latestAgentAttempt = {
      status: agent.status,
      attemptedAt: new Date().toISOString(),
      ...(agent.status === 'FAILED'
        ? { errorSummary: agent.errorSummary }
        : {}),
    };
    let finalConfidence =
      agent.status === 'COMPLETED' ? agent.confidence : baselineConfidence;
    let finalInsufficientEvidence =
      agent.status === 'COMPLETED'
        ? agent.insufficientEvidence
        : baselineInsufficientEvidence;

    const outcome = await this.db.withTransaction(async (conn) => {
      const existingSql = resolved
        ? `SELECT id, summary, confidence, insufficient_evidence, report_json FROM aiops_investigations WHERE environment_id=? AND source_type=?
           AND source_fingerprint=? AND source_started_at=? ORDER BY id DESC LIMIT 1 FOR UPDATE`
        : `SELECT id, summary, confidence, insufficient_evidence, report_json FROM aiops_investigations WHERE environment_id=? AND source_type=?
           AND source_fingerprint=? AND source_started_at=? AND playbook_version=? LIMIT 1 FOR UPDATE`;
      const existingParams = resolved
        ? [environmentId, sourceType, fingerprint, startedAt]
        : [environmentId, sourceType, fingerprint, startedAt, playbookVersion];
      const [existing] = await conn.execute<
        Array<
          mysql.RowDataPacket & {
            id: number;
            summary: string | null;
            confidence: string | null;
            insufficient_evidence: number;
            report_json: unknown;
          }
        >
      >(existingSql, existingParams);
      let id = Number(existing[0]?.id || 0);
      const created = !id;
      if (!created && !resolved && agent.status !== 'COMPLETED') {
        const previousReport = this.jsonObject(existing[0].report_json);
        const previousAgent = this.jsonObject(previousReport.agentAnalysis);
        if (this.hasSuccessfulAgentAnalysis(previousAgent)) {
          report.agentAnalysis = previousAgent;
          report.previousAgentAnalysisPreserved = true;
          summary = this.text(existing[0].summary, 2000) || summary;
          finalConfidence = this.confidence(existing[0].confidence);
          finalInsufficientEvidence =
            Number(existing[0].insufficient_evidence) !== 0;
        }
      }
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
            finalConfidence,
            finalInsufficientEvidence ? 1 : 0,
            JSON.stringify(report),
            resolved ? this.mysqlDate(alert.endsAt) : null,
          ],
        );
        id = Number(insert.insertId);
      } else {
        if (resolved) {
          await conn.execute(
            `UPDATE aiops_investigations SET source_status='RESOLVED',
             resolved_at=COALESCE(?, UTC_TIMESTAMP()), updated_at=UTC_TIMESTAMP() WHERE id=?`,
            [this.mysqlDate(alert.endsAt), id],
          );
        } else {
          await conn.execute(
            `UPDATE aiops_investigations SET source_status=?, summary=?, classification=?, confidence=?, insufficient_evidence=?,
             report_json=?, updated_at=UTC_TIMESTAMP() WHERE id=?`,
            [
              sourceStatus,
              summary,
              classification,
              finalConfidence,
              finalInsufficientEvidence ? 1 : 0,
              JSON.stringify(report),
              id,
            ],
          );
        }
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
           (investigation_id, step_key, tool_name, status, result_count, summary, error_summary, started_at, completed_at, created_at)
           VALUES (?, 'prometheus.collect', 'prometheus', ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE status=VALUES(status), result_count=VALUES(result_count), summary=VALUES(summary),
             error_summary=VALUES(error_summary), completed_at=UTC_TIMESTAMP()`,
          [
            id,
            specialized.collectionErrors?.length
              ? specialized.evidence.length
                ? 'PARTIAL'
                : 'FAILED'
              : 'COMPLETED',
            specialized.evidence.length,
            specialized.evidence.length
              ? `已保存 ${specialized.evidence.length} 组指标证据`
              : '未取得 Prometheus 指标证据',
            specialized.collectionErrors?.length
              ? specialized.collectionErrors
                  .map((item) => `${item.code}: ${item.summary}`)
                  .join('；')
                  .slice(0, 1000)
              : null,
          ],
        );
      }
      if (shouldCollect) {
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
      if (agent.status !== 'DISABLED') {
        await conn.execute(
          `INSERT INTO aiops_investigation_steps
           (investigation_id, step_key, tool_name, status, result_count, summary, error_summary, started_at, completed_at, created_at)
           VALUES (?, 'agent.analyze', 'cliproxy-evidence-agent', ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE status=VALUES(status), result_count=VALUES(result_count), summary=VALUES(summary),
             error_summary=VALUES(error_summary), completed_at=UTC_TIMESTAMP()`,
          [
            id,
            agent.status,
            agent.status === 'COMPLETED' ? agent.evidenceIds.length : 0,
            agent.status === 'COMPLETED'
              ? `AI Agent 已基于 ${agent.evidenceIds.length} 条引用证据生成受控结论`
              : 'AI Agent 分析失败，已回退确定性报告',
            agent.status === 'FAILED' ? agent.errorSummary : null,
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
    if (hasSpecializedPlaybook) {
      await this.groupCallback.enqueue({
        investigationId: outcome.id,
        sourceType,
        sourceStatus,
        alertName,
        environmentId,
        classification,
        confidence: finalConfidence,
        summary,
      });
    }
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

  private async excludedAlertNames() {
    const raw = await this.siteConf.getString(
      'aiops.alertmanager.excluded_alerts',
      'Watchdog,InfoInhibitor,DashboardAiOpsSmokeTest',
    );
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async environmentId(labels: Record<string, unknown>) {
    return (
      this.text(labels.environment || labels.env, 64) ||
      (
        await this.siteConf.getString(
          'aiops.alertmanager.default_environment',
          'mgbx',
        )
      ).trim() ||
      'mgbx'
    );
  }

  private stableFailure(error: unknown) {
    const candidate = error as {
      code?: string;
      message?: string;
      response?: { status?: number };
    };
    const status = Number(candidate?.response?.status || 0);
    const rawCode = String(candidate?.code || '').toUpperCase();
    const code = status
      ? `HTTP_${status}`
      : rawCode === 'ECONNABORTED' || rawCode === 'ETIMEDOUT'
        ? 'TIMEOUT'
        : rawCode === 'ENOTFOUND'
          ? 'DNS_ERROR'
          : rawCode.startsWith('CERT_') || rawCode.includes('TLS')
            ? 'TLS_ERROR'
            : 'INVESTIGATION_FAILED';
    const message = this.text(candidate?.message || 'Investigation failed', 500)
      .replace(/https?:\/\/[^\s]+/gi, '[url]')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]');
    return { code, summary: message };
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
  private alertmanagerPayload(value: unknown): AlertmanagerPayload {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Queued payload is not a JSON object');
    return parsed as AlertmanagerPayload;
  }
  private jsonParameter(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value ?? null);
  }
  private jsonObject(value: unknown): Record<string, unknown> {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  private hasSuccessfulAgentAnalysis(value: Record<string, unknown>) {
    return Boolean(
      this.text(value.summary, 2000) &&
        this.text(value.provider, 128) &&
        this.text(value.model, 128),
    );
  }
  private confidence(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
    const normalized = this.text(value, 16).toUpperCase();
    return normalized === 'HIGH' || normalized === 'MEDIUM'
      ? normalized
      : 'LOW';
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
