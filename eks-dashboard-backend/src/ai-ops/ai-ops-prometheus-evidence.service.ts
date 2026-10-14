import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { SiteConfService } from '../site-conf/site-conf.service';

export type PrometheusEvidence = {
  evidenceId: string;
  evidenceType: 'METRIC';
  sourceSystem: 'prometheus';
  observedAt: string;
  title: string;
  content: Record<string, unknown>;
  sourceUrl: string;
};

export type AlertPlaybookResult = {
  playbookKey: string;
  playbookVersion: string;
  classification: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  insufficientEvidence: boolean;
  findings: string[];
  recommendations: string[];
  missingEvidence: string[];
  evidence: PrometheusEvidence[];
};

type AlertContext = {
  environmentId: string;
  alertName: string;
  startedAt: string;
  labels: Record<string, unknown>;
};

type QueryDefinition = { key: string; title: string; promql: string };
type PrometheusSample = {
  metric: Record<string, string>;
  value: [string | number, string];
};
type PrometheusResponse = {
  status?: string;
  data?: { result?: PrometheusSample[] };
};

@Injectable()
export class AiOpsPrometheusEvidenceService {
  constructor(private readonly siteConf: SiteConfService) {}

  async collect(context: AlertContext): Promise<AlertPlaybookResult> {
    const playbook = this.playbook(context);
    if (!playbook) return this.genericResult();
    const baseUrl = (
      await this.siteConf.getString(
        `aiops.prometheus.environments.${context.environmentId}.base_url`,
        context.environmentId === 'mgbx'
          ? 'https://prometheus.pre.mg56.net'
          : '',
      )
    ).replace(/\/+$/, '');
    const enabled =
      (
        await this.siteConf.getString(
          `aiops.prometheus.environments.${context.environmentId}.enabled`,
          context.environmentId === 'mgbx' ? 'true' : 'false',
        )
      ).toLowerCase() === 'true';
    if (!enabled || !baseUrl) {
      return {
        ...playbook.empty,
        missingEvidence: ['Prometheus 数据源未启用或未配置'],
      };
    }
    const timeoutMs = this.clamp(
      Number(
        await this.siteConf.getString(
          `aiops.prometheus.environments.${context.environmentId}.timeout_ms`,
          '8000',
        ),
      ),
      1000,
      20000,
    );
    const at = Math.floor(new Date(context.startedAt).getTime() / 1000) + 300;
    const settled = await Promise.allSettled(
      playbook.queries.map(async (query) => {
        const response = await axios.get<PrometheusResponse>(
          `${baseUrl}/api/v1/query`,
          {
            params: { query: query.promql, time: at },
            timeout: timeoutMs,
            maxContentLength: 1024 * 1024,
          },
        );
        if (response.data?.status !== 'success') {
          throw new Error('Prometheus returned a non-success response');
        }
        const samples: PrometheusSample[] = (
          Array.isArray(response.data?.data?.result)
            ? response.data.data.result
            : []
        ).slice(0, 100);
        return this.evidence(context, query, samples, baseUrl, at);
      }),
    );
    const evidence = settled.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
    const failed = settled.filter((item) => item.status === 'rejected').length;
    return playbook.analyze(evidence, failed);
  }

  private playbook(context: AlertContext): {
    queries: QueryDefinition[];
    empty: AlertPlaybookResult;
    analyze: (
      evidence: PrometheusEvidence[],
      failed: number,
    ) => AlertPlaybookResult;
  } | null {
    if (context.alertName === 'KylinBackendServiceHttpLatencyHigh') {
      const job = this.matcher(context.labels.job || context.labels.service);
      const base = `{job=${job},namespace="default",uri!~"/actuator.*"}`;
      const queries = [
        {
          key: 'service-latency',
          title: '服务 5 分钟平均延迟',
          promql: `sum(rate(http_server_requests_seconds_sum${base}[5m])) / sum(rate(http_server_requests_seconds_count${base}[5m]))`,
        },
        {
          key: 'request-rate',
          title: '服务请求速率',
          promql: `sum(rate(http_server_requests_seconds_count${base}[5m]))`,
        },
        {
          key: 'slow-uri',
          title: 'URI 延迟与请求速率 Top 10',
          promql: `topk(10, (sum by (uri) (rate(http_server_requests_seconds_sum${base}[5m])) / sum by (uri) (rate(http_server_requests_seconds_count${base}[5m]))))`,
        },
        {
          key: 'uri-request-rate',
          title: 'URI 请求速率',
          promql: `sum by (uri) (rate(http_server_requests_seconds_count${base}[5m]))`,
        },
      ];
      const empty = this.empty('KYLIN_BACKEND_HTTP_LATENCY_HIGH', 'latency-v1');
      return {
        queries,
        empty,
        analyze: (evidence, failed) => {
          const latency = this.single(evidence, 'service-latency');
          const rate = this.single(evidence, 'request-rate');
          const slow = this.maxSample(evidence, 'slow-uri');
          const slowUriRate = slow
            ? this.sampleForMetric(
                evidence,
                'uri-request-rate',
                'uri',
                String(slow.metric.uri || ''),
              )
            : null;
          const lowTraffic = slowUriRate !== null && slowUriRate < 0.1;
          const findings = [
            latency === null
              ? '告警时间点未取得服务平均延迟样本。'
              : `告警时间点服务 5 分钟平均延迟约 ${latency.toFixed(2)} 秒。`,
            rate === null
              ? '告警时间点未取得请求速率样本。'
              : `告警时间点请求速率约 ${rate.toFixed(4)} 次/秒。`,
          ];
          if (slow)
            findings.push(
              `最慢 URI 为 ${String(slow.metric.uri || 'unknown')}，平均延迟约 ${slow.value.toFixed(2)} 秒。`,
            );
          if (slowUriRate !== null)
            findings.push(
              `该慢 URI 请求速率约 ${slowUriRate.toFixed(4)} 次/秒。`,
            );
          if (lowTraffic)
            findings.push(
              '当前证据符合低流量慢请求特征，不能外推为全服务普遍故障。',
            );
          return {
            playbookKey: empty.playbookKey,
            playbookVersion: empty.playbookVersion,
            classification: lowTraffic
              ? 'LOW_TRAFFIC_SLOW_URI'
              : 'NEEDS_INVESTIGATION',
            confidence: this.populatedCount(evidence) >= 3 ? 'MEDIUM' : 'LOW',
            insufficientEvidence: this.populatedCount(evidence) < 2,
            findings,
            recommendations: [
              '优先核对慢 URI 对应日志、下游耗时和同时间窗口发布记录。',
              '在请求量很低时避免仅依据均值执行扩容或回滚。',
            ],
            missingEvidence: this.missing(failed, [
              'Kubernetes 状态',
              '发布记录',
              '关联日志',
            ]),
            evidence,
          };
        },
      };
    }
    if (context.alertName === 'CPUThrottlingHigh') {
      const namespace = this.literal(context.labels.namespace);
      const pod = this.literal(context.labels.pod);
      const container = this.literal(context.labels.container);
      const selector = `{namespace="${namespace}",pod="${pod}",container="${container}"}`;
      const queries = [
        {
          key: 'throttling-ratio',
          title: 'CPU throttling 比例',
          promql: `sum(increase(container_cpu_cfs_throttled_periods_total${selector}[5m])) / sum(increase(container_cpu_cfs_periods_total${selector}[5m]))`,
        },
        {
          key: 'cpu-usage',
          title: 'CPU 使用核数',
          promql: `sum(rate(container_cpu_usage_seconds_total${selector}[5m]))`,
        },
        {
          key: 'cpu-limit',
          title: 'CPU limit 核数',
          promql: `max(kube_pod_container_resource_limits${selector.slice(0, -1)},resource="cpu"})`,
        },
        {
          key: 'restarts',
          title: '容器重启次数',
          promql: `max(kube_pod_container_status_restarts_total${selector})`,
        },
      ];
      const empty = this.empty('CPU_THROTTLING_HIGH', 'cpu-throttling-v1');
      return {
        queries,
        empty,
        analyze: (evidence, failed) => {
          const throttling = this.single(evidence, 'throttling-ratio');
          const usage = this.single(evidence, 'cpu-usage');
          const limit = this.single(evidence, 'cpu-limit');
          const restarts = this.single(evidence, 'restarts');
          const lowImpact =
            throttling !== null &&
            throttling >= 0.25 &&
            usage !== null &&
            limit !== null &&
            limit > 0 &&
            usage / limit < 0.5 &&
            (restarts === null || restarts === 0);
          return {
            playbookKey: empty.playbookKey,
            playbookVersion: empty.playbookVersion,
            classification: lowImpact ? 'NOISE_CANDIDATE' : 'OBSERVE',
            confidence: this.populatedCount(evidence) >= 3 ? 'MEDIUM' : 'LOW',
            insufficientEvidence: this.populatedCount(evidence) < 2,
            findings: [
              throttling === null
                ? '告警时间点未取得 throttling 样本。'
                : `告警时间点 CPU throttling 约 ${(throttling * 100).toFixed(1)}%。`,
              usage === null || limit === null
                ? 'CPU usage/limit 证据不完整。'
                : `CPU usage 约 ${usage.toFixed(3)} 核，limit 约 ${limit.toFixed(3)} 核。`,
              lowImpact
                ? '当前资源与重启证据未显示明显业务影响，标记为噪声候选，仍需观察。'
                : '当前证据不足以将告警判定为噪声，保持观察。',
            ],
            recommendations: [
              '核对同 Pod 副本、节点状态和业务错误率后再决定是否调整 limit。',
              '不要仅凭 throttling 比例自动扩容或重启。',
            ],
            missingEvidence: this.missing(failed, [
              'Pod/Node 当前状态',
              '同副本对比',
              '业务影响',
            ]),
            evidence,
          };
        },
      };
    }
    if (
      ['PodOOM', 'PodOOMKilled', 'ContainerOOMKilled'].includes(
        context.alertName,
      )
    ) {
      const namespace = this.literal(context.labels.namespace);
      const pod = this.literal(context.labels.pod);
      const container = this.literal(context.labels.container);
      const selector = `{namespace="${namespace}",pod="${pod}",container="${container}"}`;
      const queries = [
        {
          key: 'oom-reason',
          title: '容器 OOMKilled 状态',
          promql: `max(kube_pod_container_status_last_terminated_reason${selector},reason="OOMKilled"})`,
        },
        {
          key: 'memory-working-set',
          title: '容器内存工作集',
          promql: `max(container_memory_working_set_bytes${selector})`,
        },
        {
          key: 'memory-limit',
          title: '容器内存 limit',
          promql: `max(kube_pod_container_resource_limits${selector.slice(0, -1)},resource="memory"})`,
        },
        {
          key: 'restarts',
          title: '容器重启次数',
          promql: `max(kube_pod_container_status_restarts_total${selector})`,
        },
      ];
      const empty = this.empty('POD_OOM', 'pod-oom-v1');
      return {
        queries,
        empty,
        analyze: (evidence, failed) => {
          const oom = this.single(evidence, 'oom-reason');
          const workingSet = this.single(evidence, 'memory-working-set');
          const limit = this.single(evidence, 'memory-limit');
          const utilization =
            workingSet !== null && limit !== null && limit > 0
              ? workingSet / limit
              : null;
          return {
            playbookKey: empty.playbookKey,
            playbookVersion: empty.playbookVersion,
            classification:
              oom === 1 ? 'OOM_CONFIRMED' : 'OOM_NEEDS_CORRELATION',
            confidence: oom === 1 && utilization !== null ? 'MEDIUM' : 'LOW',
            insufficientEvidence: oom === null,
            findings: [
              oom === 1
                ? 'Kubernetes 指标确认容器最近一次终止原因为 OOMKilled。'
                : '尚未从指标确认 OOMKilled 终止原因。',
              utilization === null
                ? '内存工作集或 limit 证据不完整。'
                : `告警窗口内存工作集约占 limit 的 ${(utilization * 100).toFixed(1)}%。`,
              '仅凭容器 OOM 不能区分 JVM heap、native memory、sidecar 或节点压力。',
            ],
            recommendations: [
              '核对 previous log、Pod Event、容器 limit、节点压力及同服务其他 Pod。',
              '没有 heap dump 或 JVM 指标时，不要声称已定位具体泄漏对象。',
            ],
            missingEvidence: this.missing(failed, [
              'previous log 与 Pod Event',
              'JVM heap/native memory 拆分',
              '同服务 Pod 对比',
            ]),
            evidence,
          };
        },
      };
    }
    if (
      ['HTTPErrorRateHigh', 'KylinBackendServiceHttpErrorRateHigh'].includes(
        context.alertName,
      )
    ) {
      const job = this.matcher(context.labels.job || context.labels.service);
      const base = `{job=${job},namespace="${this.literal(context.labels.namespace) || 'default'}"}`;
      const queries = [
        {
          key: 'error-rate',
          title: 'HTTP 5xx 错误率',
          promql: `sum(rate(http_server_requests_seconds_count${base.slice(0, -1)},status=~"5.."}[5m])) / sum(rate(http_server_requests_seconds_count${base}[5m]))`,
        },
        {
          key: 'request-rate',
          title: 'HTTP 请求速率',
          promql: `sum(rate(http_server_requests_seconds_count${base}[5m]))`,
        },
        {
          key: 'status-top',
          title: 'HTTP 错误状态分布',
          promql: `topk(10, sum by (status,uri) (rate(http_server_requests_seconds_count${base.slice(0, -1)},status=~"5.."}[5m])))`,
        },
      ];
      const empty = this.empty('HTTP_ERROR_RATE_HIGH', 'http-error-rate-v1');
      return {
        queries,
        empty,
        analyze: (evidence, failed) => {
          const errorRate = this.single(evidence, 'error-rate');
          const requestRate = this.single(evidence, 'request-rate');
          return {
            playbookKey: empty.playbookKey,
            playbookVersion: empty.playbookVersion,
            classification:
              errorRate !== null && errorRate > 0
                ? 'ERROR_RATE_CONFIRMED'
                : 'NEEDS_INVESTIGATION',
            confidence: this.populatedCount(evidence) >= 2 ? 'MEDIUM' : 'LOW',
            insufficientEvidence: errorRate === null || requestRate === null,
            findings: [
              errorRate === null
                ? '未取得 HTTP 5xx 错误率。'
                : `告警窗口 HTTP 5xx 错误率约 ${(errorRate * 100).toFixed(2)}%。`,
              requestRate === null
                ? '未取得请求速率。'
                : `告警窗口请求速率约 ${requestRate.toFixed(3)} 次/秒。`,
              '时间接近的发布或依赖异常只作为候选因素，不能直接证明因果关系。',
            ],
            recommendations: [
              '关联错误 URI、日志错误模式、下游依赖健康和同时间窗口变更记录。',
            ],
            missingEvidence: this.missing(failed, [
              '错误日志模式',
              '下游依赖与 Trace',
              '同服务实例对比',
            ]),
            evidence,
          };
        },
      };
    }
    if (context.alertName === 'JVMHeapHighSynthetic') {
      const job = this.matcher(context.labels.job || context.labels.service);
      const base = `{job=${job}}`;
      const queries = [
        {
          key: 'heap-used',
          title: 'JVM heap used',
          promql: `max(jvm_memory_used_bytes${base.slice(0, -1)},area="heap"})`,
        },
        {
          key: 'heap-max',
          title: 'JVM heap max',
          promql: `max(jvm_memory_max_bytes${base.slice(0, -1)},area="heap"})`,
        },
        {
          key: 'gc-pause',
          title: 'GC pause rate',
          promql: `sum(rate(jvm_gc_pause_seconds_sum${base}[5m]))`,
        },
        {
          key: 'pod-memory',
          title: 'Pod memory working set',
          promql: `sum(container_memory_working_set_bytes${base})`,
        },
      ];
      const empty = this.empty(
        'JVM_HEAP_HIGH_SYNTHETIC',
        'jvm-heap-synthetic-v1',
      );
      return {
        queries,
        empty,
        analyze: (evidence, failed) => {
          const used = this.single(evidence, 'heap-used');
          const max = this.single(evidence, 'heap-max');
          const ratio =
            used !== null && max !== null && max > 0 ? used / max : null;
          return {
            playbookKey: empty.playbookKey,
            playbookVersion: empty.playbookVersion,
            classification:
              ratio !== null && ratio >= 0.9
                ? 'HEAP_PRESSURE_CANDIDATE'
                : 'INSUFFICIENT_EVIDENCE',
            confidence: ratio !== null ? 'LOW' : 'LOW',
            insufficientEvidence: true,
            findings: [
              '这是合成演练，不计入真实告警准确率或 MTTR。',
              ratio === null
                ? '未取得完整 heap used/max 证据。'
                : `单点 heap 使用率约 ${(ratio * 100).toFixed(1)}%，仍不足以证明内存泄漏。`,
            ],
            recommendations: [
              '补充时间趋势、Full GC 后回落情况、Pod limit、previous log 和 heap dump 后再判断。',
            ],
            missingEvidence: this.missing(failed, [
              'heap/Old Gen 时间趋势',
              'Full GC 后回落情况',
              'heap dump 或对象分配证据',
            ]),
            evidence,
          };
        },
      };
    }
    return null;
  }

  private evidence(
    context: AlertContext,
    query: QueryDefinition,
    samples: PrometheusSample[],
    baseUrl: string,
    at: number,
  ): PrometheusEvidence {
    return {
      evidenceId: `metric-${createHash('sha256').update(`${context.environmentId}:${context.alertName}:${context.startedAt}:${query.key}`).digest('hex').slice(0, 16)}`,
      evidenceType: 'METRIC',
      sourceSystem: 'prometheus',
      observedAt: new Date(at * 1000).toISOString(),
      title: query.title,
      content: {
        queryKey: query.key,
        query: query.promql,
        samples: samples.map((sample) => ({
          metric: this.safeMetric(sample?.metric),
          value: [
            String(sample?.value?.[0] || ''),
            String(sample?.value?.[1] || ''),
          ],
        })),
      },
      sourceUrl: `${baseUrl}/graph?g0.expr=${encodeURIComponent(query.promql)}&g0.tab=1`,
    };
  }

  private empty(key: string, version: string): AlertPlaybookResult {
    return {
      playbookKey: key,
      playbookVersion: version,
      classification: 'INSUFFICIENT_EVIDENCE',
      confidence: 'LOW',
      insufficientEvidence: true,
      findings: [],
      recommendations: ['补齐监控证据后重新调查。'],
      missingEvidence: [],
      evidence: [],
    };
  }
  private genericResult() {
    return this.empty('GENERIC_PROMETHEUS_ALERT', 'generic-v1');
  }
  private missing(failed: number, items: string[]) {
    return failed ? [`${failed} 个 Prometheus 查询失败`, ...items] : items;
  }
  private matcher(value: unknown) {
    const text = this.literal(value);
    return text ? `"${text}"` : `~".+"`;
  }
  private literal(value: unknown) {
    const scalar =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? String(value)
        : '';
    return scalar.replace(/[\\"\n\r]/g, '').slice(0, 200);
  }
  private safeMetric(value: unknown) {
    const input =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 20)
        .map(([key, item]) => [this.literal(key), this.literal(item)]),
    );
  }
  private samples(
    evidence: PrometheusEvidence[],
    key: string,
  ): PrometheusSample[] {
    const found = evidence.find((item) => item.content.queryKey === key);
    return Array.isArray(found?.content.samples)
      ? (found.content.samples as PrometheusSample[])
      : [];
  }
  private single(evidence: PrometheusEvidence[], key: string) {
    const value = Number(this.samples(evidence, key)[0]?.value?.[1]);
    return Number.isFinite(value) ? value : null;
  }
  private sampleForMetric(
    evidence: PrometheusEvidence[],
    key: string,
    label: string,
    expected: string,
  ) {
    const sample = this.samples(evidence, key).find(
      (item) => item.metric[label] === expected,
    );
    const value = Number(sample?.value?.[1]);
    return Number.isFinite(value) ? value : null;
  }
  private populatedCount(evidence: PrometheusEvidence[]) {
    return evidence.filter(
      (item) =>
        Array.isArray(item.content.samples) && item.content.samples.length > 0,
    ).length;
  }
  private maxSample(evidence: PrometheusEvidence[], key: string) {
    return (
      this.samples(evidence, key)
        .map((sample) => ({
          metric: sample.metric || {},
          value: Number(sample.value?.[1]),
        }))
        .filter((sample) => Number.isFinite(sample.value))
        .sort((a, b) => b.value - a.value)[0] || null
    );
  }
  private clamp(value: number, min: number, max: number) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  }
}
