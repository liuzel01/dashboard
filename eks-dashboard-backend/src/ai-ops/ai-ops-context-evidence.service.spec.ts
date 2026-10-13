import { AiOpsContextEvidenceService } from './ai-ops-context-evidence.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

describe('AiOpsContextEvidenceService', () => {
  const context = {
    environmentId: 'mgbx',
    startedAt: '2026-10-13T03:50:43.873Z',
    namespace: 'default',
    service: 'kylin-tenant-kylin-tenant-impl',
    labels: { service: 'kylin-tenant-kylin-tenant-impl' },
    replay: true,
  };

  it('keeps current Kubernetes state explicitly separate from historical replay state', async () => {
    const kubernetes = {
      getAiOpsEvidenceSnapshot: jest.fn(() =>
        Promise.resolve({
          observedAt: '2026-10-13T09:00:00.000Z',
          namespace: 'default',
          workload: { kind: 'Deployment', readyReplicas: 2 },
          pods: [],
          events: [],
          previousLogs: [],
        }),
      ),
    };
    const db = { query: jest.fn(() => Promise.resolve([])) };
    const service = new AiOpsContextEvidenceService(
      kubernetes as any,
      db as any,
    );

    const result = await service.collect(context);

    expect(result.evidence[0]).toMatchObject({
      evidenceType: 'KUBERNETES_SNAPSHOT',
      sourceSystem: 'kubernetes',
      content: { temporalScope: 'CURRENT_AT_INVESTIGATION', replay: true },
    });
    expect(result.findings.join(' ')).toContain('不等同于历史告警发生时状态');
  });

  it('treats CI/CD records as optional context and never as proven causality', async () => {
    const kubernetes = {
      getAiOpsEvidenceSnapshot: jest.fn(() =>
        Promise.resolve({
          observedAt: '2026-10-13T04:00:00.000Z',
          namespace: 'default',
          workload: null,
          pods: [],
          events: [],
          previousLogs: [],
        }),
      ),
    };
    const db = {
      query: jest.fn(() =>
        Promise.resolve([
          {
            run_id: 'run-1',
            job_name: 'deploy-kylin-tenant-kylin-tenant-impl',
            status: 'SUCCESS',
            created_at: '2026-10-13 03:00:00',
            parameters_json: {},
          },
        ]),
      ),
    };
    const service = new AiOpsContextEvidenceService(
      kubernetes as any,
      db as any,
    );

    const result = await service.collect({ ...context, replay: false });
    const change = result.evidence.find((item) => item.sourceSystem === 'cicd');

    expect(change).toMatchObject({
      evidenceType: 'CHANGE_CONTEXT',
      content: { causality: 'UNPROVEN' },
    });
    expect(result.missingEvidence).not.toContain(
      expect.stringContaining('CI/CD'),
    );
  });

  it('returns a partial result when Kubernetes and CI/CD sources are unavailable', async () => {
    const kubernetes = {
      getAiOpsEvidenceSnapshot: jest.fn(() =>
        Promise.reject(new Error('unavailable')),
      ),
    };
    const db = {
      query: jest.fn(() => Promise.reject(new Error('missing table'))),
    };
    const service = new AiOpsContextEvidenceService(
      kubernetes as any,
      db as any,
    );

    const result = await service.collect(context);

    expect(result.evidence).toEqual([]);
    expect(result.missingEvidence).toHaveLength(1);
    expect(result.missingEvidence[0]).toContain('Kubernetes');
  });
});
