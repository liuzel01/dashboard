import axios from 'axios';
import { AiOpsPrometheusEvidenceService } from './ai-ops-prometheus-evidence.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method */

jest.mock('axios');

const response = (
  samples: Array<{ metric?: Record<string, string>; value: [number, string] }>,
) => ({ data: { status: 'success', data: { result: samples } } });

describe('AiOpsPrometheusEvidenceService', () => {
  const siteConf = {
    getString: jest.fn(async (_key: string, fallback: string) => fallback),
  };
  const service = new AiOpsPrometheusEvidenceService(siteConf as any);
  const get = axios.get as jest.MockedFunction<typeof axios.get>;

  beforeEach(() => get.mockReset());

  it('classifies a low-frequency slow URI without calling it a service-wide failure', async () => {
    get.mockImplementation(async (_url, config) => {
      const query = String(config?.params?.query || '');
      if (query.includes('topk(10'))
        return response([
          {
            metric: { uri: '/tenant/admin/channel/position/listLogs/excel' },
            value: [1, '146.4'],
          },
        ]) as any;
      if (query.includes('sum by (uri)'))
        return response([
          {
            metric: { uri: '/tenant/admin/channel/position/listLogs/excel' },
            value: [1, '0.0069'],
          },
        ]) as any;
      if (query.includes('_sum'))
        return response([{ value: [1, '10.79'] }]) as any;
      return response([{ value: [1, '0.22'] }]) as any;
    });

    const result = await service.collect({
      environmentId: 'mgbx',
      alertName: 'KylinBackendServiceHttpLatencyHigh',
      startedAt: '2026-10-13T03:50:43.873Z',
      labels: { job: 'kylin-tenant-kylin-tenant-impl' },
    });

    expect(result.classification).toBe('LOW_TRAFFIC_SLOW_URI');
    expect(result.findings.join(' ')).toContain('0.0069');
    expect(result.evidence).toHaveLength(4);
  });

  it('keeps CPU throttling in observe when impact evidence is incomplete', async () => {
    get.mockImplementation(async (_url, config) => {
      const query = String(config?.params?.query || '');
      if (query.includes('throttled_periods'))
        return response([{ value: [1, '0.28'] }]) as any;
      if (query.includes('usage_seconds'))
        return response([{ value: [1, '0.1'] }]) as any;
      return response([]) as any;
    });

    const result = await service.collect({
      environmentId: 'mgbx',
      alertName: 'CPUThrottlingHigh',
      startedAt: '2026-10-13T02:00:52.400Z',
      labels: {
        namespace: 'monitoring',
        pod: 'node-exporter-qn6kk',
        container: 'node-exporter',
      },
    });

    expect(result.classification).toBe('OBSERVE');
    expect(result.insufficientEvidence).toBe(false);
    expect(result.findings.join(' ')).toContain('证据不完整');
  });

  it('confirms the OOM signal without claiming a specific memory leak cause', async () => {
    get.mockImplementation(async (_url, config) => {
      const query = String(config?.params?.query || '');
      if (query.includes('last_terminated_reason'))
        return response([{ value: [1, '1'] }]) as any;
      if (query.includes('working_set'))
        return response([{ value: [1, '900'] }]) as any;
      if (query.includes('resource_limits'))
        return response([{ value: [1, '1000'] }]) as any;
      return response([{ value: [1, '2'] }]) as any;
    });

    const result = await service.collect({
      environmentId: 'mgbx',
      alertName: 'PodOOMKilled',
      startedAt: '2026-10-14T00:00:00.000Z',
      labels: { namespace: 'default', pod: 'app-1', container: 'app' },
    });

    expect(result.playbookKey).toBe('POD_OOM');
    expect(result.classification).toBe('OOM_CONFIRMED');
    expect(result.findings.join(' ')).toContain('不能区分 JVM heap');
    const queries = get.mock.calls.map((call) =>
      String((call[1] as { params?: { query?: string } })?.params?.query || ''),
    );
    expect(queries.filter((query) => query.includes('kube_pod_'))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exported_namespace="default"'),
        expect.stringContaining('exported_pod="app-1"'),
        expect.stringContaining('exported_container="app"'),
      ]),
    );
    expect(
      queries.find((query) => query.includes('container_memory_working_set')),
    ).toContain('namespace="default"');
  });

  it('keeps the synthetic JVM exercise out of confirmed-root-cause claims', async () => {
    get.mockResolvedValue(response([]) as any);

    const result = await service.collect({
      environmentId: 'mgbx',
      alertName: 'JVMHeapHighSynthetic',
      startedAt: '2026-10-14T00:00:00.000Z',
      labels: { job: 'synthetic-service' },
    });

    expect(result.playbookKey).toBe('JVM_HEAP_HIGH_SYNTHETIC');
    expect(result.insufficientEvidence).toBe(true);
    expect(result.findings.join(' ')).toContain('不计入真实告警准确率');
  });

  it('correlates HTTP error rate while keeping change causality unproven', async () => {
    get.mockImplementation(async (_url, config) => {
      const query = String(config?.params?.query || '');
      if (query.includes('status=~'))
        return response([
          { value: [1, query.includes('topk') ? '0.2' : '0.08'] },
        ]) as any;
      return response([{ value: [1, '12'] }]) as any;
    });

    const result = await service.collect({
      environmentId: 'mgbx',
      alertName: 'HTTPErrorRateHigh',
      startedAt: '2026-10-14T00:00:00.000Z',
      labels: { namespace: 'default', service: 'api' },
    });

    expect(result.playbookKey).toBe('HTTP_ERROR_RATE_HIGH');
    expect(result.classification).toBe('ERROR_RATE_CONFIRMED');
    expect(result.findings.join(' ')).toContain('不能直接证明因果关系');
  });
});
