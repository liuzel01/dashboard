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
});
