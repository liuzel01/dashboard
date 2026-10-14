import type { AlertmanagerPayload } from '../oncall/oncall.types';

export type AiOpsReplayCase = {
  key: string;
  name: string;
  environmentId: string;
  description: string;
  expectedClassification: string;
  payload: AlertmanagerPayload;
};

export const AIOPS_REPLAY_CASES: AiOpsReplayCase[] = [
  {
    key: 'kylin-backend-http-latency-high-20261013',
    name: 'Kylin backend HTTP 延迟历史案例',
    environmentId: 'mgbx',
    description: '验证低频慢 URI 与全服务故障的区分。',
    expectedClassification: 'LOW_TRAFFIC_SLOW_URI',
    payload: {
      version: '4',
      status: 'firing',
      receiver: 'dashboard-aiops-replay',
      commonLabels: {
        alertname: 'KylinBackendServiceHttpLatencyHigh',
        environment: 'mgbx',
        severity: 'warning',
      },
      commonAnnotations: {
        summary: 'Kylin backend service HTTP latency is high',
      },
      externalURL: 'https://prometheus.pre.mg56.net/alerts',
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'KylinBackendServiceHttpLatencyHigh',
            environment: 'mgbx',
            severity: 'warning',
            namespace: 'default',
            job: 'kylin-tenant-kylin-tenant-impl',
            service: 'kylin-tenant-kylin-tenant-impl',
          },
          annotations: {
            summary: 'Kylin backend service HTTP latency is high',
            description:
              'kylin-tenant-kylin-tenant-impl average non-actuator HTTP latency is above 9s for 5 minutes. Current value: 10.79s',
          },
          startsAt: '2026-10-13T03:50:43.873Z',
          endsAt: '0001-01-01T00:00:00Z',
          generatorURL: 'https://prometheus.pre.mg56.net/graph',
          fingerprint: 'fixture-kylin-latency-20261013',
        },
      ],
    },
  },
  {
    key: 'cpu-throttling-high-20261013',
    name: 'CPU throttling 历史案例',
    environmentId: 'mgbx',
    description: '验证资源影响证据不足时保持观察，不直接建议扩容。',
    expectedClassification: 'OBSERVE',
    payload: {
      version: '4',
      status: 'firing',
      receiver: 'dashboard-aiops-replay',
      commonLabels: {
        alertname: 'CPUThrottlingHigh',
        environment: 'mgbx',
        severity: 'info',
      },
      commonAnnotations: {
        summary: 'Processes experience elevated CPU throttling.',
      },
      externalURL: 'https://prometheus.pre.mg56.net/alerts',
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'CPUThrottlingHigh',
            environment: 'mgbx',
            severity: 'info',
            namespace: 'monitoring',
            pod: 'node-exporter-qn6kk',
            container: 'node-exporter',
            instance: '10.100.168.55:10250',
          },
          annotations: {
            summary: 'Processes experience elevated CPU throttling.',
            description:
              '28% throttling of CPU in namespace monitoring for container node-exporter',
          },
          startsAt: '2026-10-13T02:00:52.400Z',
          endsAt: '0001-01-01T00:00:00Z',
          generatorURL: 'https://prometheus.pre.mg56.net/graph',
          fingerprint: 'fixture-cpu-throttling-20261013',
        },
      ],
    },
  },
  {
    key: 'jvm-heap-high-synthetic-v1',
    name: 'JVM heap 高水位合成演练',
    environmentId: 'mgbx',
    description: '离线验证 JVM heap 证据不足、候选结论和非真实样本标记。',
    expectedClassification: 'INSUFFICIENT_EVIDENCE',
    payload: {
      version: '4',
      status: 'firing',
      receiver: 'dashboard-aiops-synthetic-replay',
      commonLabels: {
        alertname: 'JVMHeapHighSynthetic',
        environment: 'mgbx',
        severity: 'warning',
        exercise: 'synthetic',
      },
      commonAnnotations: {
        summary: 'Synthetic JVM heap pressure exercise',
      },
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'JVMHeapHighSynthetic',
            environment: 'mgbx',
            severity: 'warning',
            exercise: 'synthetic',
            namespace: 'default',
            job: 'aiops-jvm-synthetic-service',
            service: 'aiops-jvm-synthetic-service',
          },
          annotations: {
            summary: 'Synthetic JVM heap pressure exercise',
            description:
              'Synthetic fixture only; no production incident or heap dump exists.',
          },
          startsAt: '2026-10-14T00:00:00.000Z',
          endsAt: '0001-01-01T00:00:00Z',
          fingerprint: 'fixture-jvm-heap-synthetic-v1',
        },
      ],
    },
  },
];
