import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { KubernetesService } from '../kubernetes/kubernetes.service';

export type ContextEvidence = {
  evidenceId: string;
  evidenceType:
    | 'KUBERNETES_SNAPSHOT'
    | 'KUBERNETES_EVENT'
    | 'LOG'
    | 'CHANGE_CONTEXT';
  sourceSystem: 'kubernetes' | 'kubernetes-previous-log' | 'cicd';
  observedAt: string;
  title: string;
  content: Record<string, unknown>;
  sourceUrl: string;
};

export type ContextEvidenceResult = {
  evidence: ContextEvidence[];
  findings: string[];
  missingEvidence: string[];
  timeline: Array<{
    observedAt: string;
    source: string;
    title: string;
    evidenceId?: string;
  }>;
};

type AlertContext = {
  environmentId: string;
  startedAt: string;
  namespace: string | null;
  service: string | null;
  labels: Record<string, unknown>;
  replay: boolean;
};

@Injectable()
export class AiOpsContextEvidenceService {
  constructor(
    private readonly kubernetes: KubernetesService,
    private readonly db: PlatformDatabaseService,
  ) {}

  async collect(context: AlertContext): Promise<ContextEvidenceResult> {
    const evidence: ContextEvidence[] = [];
    const findings: string[] = [];
    const missingEvidence: string[] = [];
    const pod = this.text(context.labels.pod);
    const container = this.text(context.labels.container);
    const workload = pod
      ? ''
      : this.text(context.service || context.labels.job);

    if (pod || workload) {
      try {
        const snapshot = await this.withTimeout(
          this.kubernetes.getAiOpsEvidenceSnapshot(context.environmentId, {
            namespace: context.namespace || 'default',
            pod: pod || undefined,
            container: container || undefined,
            workload: workload || undefined,
          }),
          10_000,
        );
        const snapshotId = this.id(
          'k8s-snapshot',
          `${context.environmentId}:${context.namespace || 'default'}:${pod || workload}`,
        );
        evidence.push({
          evidenceId: snapshotId,
          evidenceType: 'KUBERNETES_SNAPSHOT',
          sourceSystem: 'kubernetes',
          observedAt: snapshot.observedAt,
          title: `Kubernetes 当前快照 ${context.namespace || 'default'}/${pod || workload}`,
          content: {
            ...snapshot,
            temporalScope: 'CURRENT_AT_INVESTIGATION',
            replay: context.replay,
          },
          sourceUrl: '',
        });
        for (const event of snapshot.events) {
          const observedAt = event.observedAt || snapshot.observedAt;
          evidence.push({
            evidenceId: this.id(
              'k8s-event',
              `${event.object}:${event.reason}:${observedAt}`,
            ),
            evidenceType: 'KUBERNETES_EVENT',
            sourceSystem: 'kubernetes',
            observedAt,
            title: `Kubernetes Event ${event.reason || event.type || 'Unknown'}`,
            content: { ...event, temporalScope: 'EVENT_RECORDED_AT' },
            sourceUrl: '',
          });
        }
        for (const log of snapshot.previousLogs) {
          evidence.push({
            evidenceId: this.id(
              'previous-log',
              `${context.environmentId}:${log.pod}:${log.container}`,
            ),
            evidenceType: 'LOG',
            sourceSystem: 'kubernetes-previous-log',
            observedAt: snapshot.observedAt,
            title: `Previous log ${log.pod}/${log.container}`,
            content: {
              pod: log.pod,
              container: log.container,
              text: this.redact(log.text),
              temporalScope: 'PREVIOUS_CONTAINER_INSTANCE',
            },
            sourceUrl: '',
          });
        }
        findings.push(
          context.replay
            ? '已采集调查时的 Kubernetes 当前快照；该快照不等同于历史告警发生时状态。'
            : '已采集 Kubernetes 当前状态、关联 Event，并在容器发生重启时尝试读取 previous log。',
        );
      } catch {
        missingEvidence.push(
          'Kubernetes 当前状态、Event 与 previous log（数据源不可用或目标无法映射）',
        );
      }
    } else {
      missingEvidence.push(
        'Kubernetes 目标映射（告警缺少 pod、service 或 job 标签）',
      );
    }

    if (context.service) {
      try {
        const rows = await this.db.query<Array<Record<string, unknown>>>(
          `SELECT run_id, action_type, job_name, status, build_number, build_url, parameters_json,
                  started_at, finished_at, created_at
             FROM cicd_runs
            WHERE environment_id=? AND created_at BETWEEN DATE_SUB(?, INTERVAL 24 HOUR) AND DATE_ADD(?, INTERVAL 2 HOUR)
            ORDER BY created_at DESC LIMIT 50`,
          [
            context.environmentId,
            this.mysqlDate(context.startedAt),
            this.mysqlDate(context.startedAt),
          ],
        );
        const matched = rows
          .filter((row) =>
            `${this.scalar(row.job_name)} ${JSON.stringify(row.parameters_json || '')}`
              .toLowerCase()
              .includes(context.service!.toLowerCase()),
          )
          .slice(0, 10);
        for (const row of matched) {
          const observedAt =
            this.iso(row.started_at || row.created_at) || context.startedAt;
          evidence.push({
            evidenceId: this.id(
              'cicd-run',
              this.scalar(row.run_id) || observedAt,
            ),
            evidenceType: 'CHANGE_CONTEXT',
            sourceSystem: 'cicd',
            observedAt,
            title:
              `CI/CD ${this.scalar(row.job_name) || 'run'} ${this.scalar(row.status)}`.trim(),
            content: {
              ...row,
              temporalScope: 'ALERT_WINDOW_CHANGE_CONTEXT',
              causality: 'UNPROVEN',
            },
            sourceUrl: this.safeUrl(row.build_url),
          });
        }
        if (matched.length)
          findings.push(
            `告警前后窗口内找到 ${matched.length} 条可映射 CI/CD 记录；仅作为变更上下文，不代表因果关系。`,
          );
      } catch {
        // CI/CD is optional context. Missing tables or mappings must not make
        // an otherwise useful investigation insufficient.
      }
    }

    return {
      evidence,
      findings,
      missingEvidence,
      timeline: evidence
        .map((item) => ({
          observedAt: item.observedAt,
          source: item.sourceSystem,
          title: item.title,
          evidenceId: item.evidenceId,
        }))
        .sort(
          (left, right) =>
            Date.parse(left.observedAt) - Date.parse(right.observedAt),
        ),
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Kubernetes evidence timeout')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private id(prefix: string, value: string) {
    return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 255) : '';
  }

  private mysqlDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toISOString().slice(0, 19).replace('T', ' ');
  }

  private iso(value: unknown) {
    if (!value) return '';
    const raw = this.scalar(value);
    if (!raw) return '';
    const date = new Date(
      raw.replace(' ', 'T') + (raw.includes('Z') ? '' : 'Z'),
    );
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  private safeUrl(value: unknown) {
    const raw = this.text(value);
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  private redact(value: string) {
    return value
      .slice(0, 64 * 1024)
      .replace(
        /(authorization|token|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi,
        '$1=[REDACTED]',
      )
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  }

  private scalar(value: unknown) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }
}
