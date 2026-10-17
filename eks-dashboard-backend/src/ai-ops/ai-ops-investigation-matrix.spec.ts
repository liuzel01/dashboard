import { buildInvestigationEvidenceMatrix } from './ai-ops-investigation-matrix';

describe('AI Ops investigation evidence matrix', () => {
  it('creates deterministic entities, request dimensions, and coverage', () => {
    const result = buildInvestigationEvidenceMatrix(
      [
        {
          evidenceId: 'ev-1',
          jobId: 16,
          timestamp: '2026-10-16T01:00:00.000Z',
          labels: { service_name: 'ingress-nginx' },
          line: 'xff=143.109.37.118 host=www.icoin.vip request_uri=/admin/login status=401 request_id=req-123456 asi_uuid=session-123456 email=demo@example.com',
        },
      ],
      [
        {
          serviceName: 'ingress-nginx',
          queryTexts: ['143.109.37.118'],
          matchingLines: 4905,
          sampledLines: 100,
          truncated: true,
          samplingStrategy: 'time-sliced',
          timeSlices: 4,
        },
      ],
      [{ key: 'auth', label: '登录', matchingLines: 432 }],
    );

    expect(result.coverage).toEqual(
      expect.objectContaining({
        evidenceCount: 1,
        largestMeasuredQuery: 4905,
        truncatedQueries: 1,
        timeSlicedQueries: 1,
      }),
    );
    expect(result.entities.email).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'demo@example.com' }),
      ]),
    );
    expect(result.requests).toEqual(
      expect.objectContaining({
        hosts: ['www.icoin.vip'],
        paths: ['/admin/login'],
        statusCodes: ['401'],
        requestIds: ['req-123456'],
        sessionIds: ['session-123456'],
      }),
    );
    expect(result.outcomeSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'http_4xx', evidenceCount: 1 }),
      ]),
    );
  });
});
