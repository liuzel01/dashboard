import {
  buildEvidenceGraph,
  selectRepresentativeEvidence,
} from './ai-ops-evidence-correlation';

describe('AI Ops evidence correlation', () => {
  const evidence = [
    {
      evidenceId: 'ingress-1',
      jobId: 16,
      timestamp: '2026-10-16T01:00:00.000Z',
      labels: { service_name: 'ingress-nginx', namespace: 'ingress-nginx' },
      line: '{"clientip":"157.254.53.237","xff":"143.109.37.118","host":"www.icoin.vip","status":200}',
    },
    {
      evidenceId: 'user-1',
      jobId: 17,
      timestamp: '2026-10-16T01:01:00.000Z',
      labels: { service_name: 'kylin-user-center', namespace: 'default' },
      line: 'userId=80420234 tenant=12 email=demo@maxxspace.com phone=13800138001 ip=143.109.37.118',
    },
  ];

  it('keeps IP roles and creates evidence-backed generic relations', () => {
    const graph = buildEvidenceGraph(evidence);

    expect(graph.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ip',
          role: 'multiple',
          normalizedValue: '143.109.37.118',
          metadata: { roles: 'reported,xff' },
        }),
        expect.objectContaining({
          type: 'ip',
          role: 'peer',
          normalizedValue: '157.254.53.237',
        }),
        expect.objectContaining({
          type: 'user_id',
          normalizedValue: '80420234',
        }),
        expect.objectContaining({
          type: 'tenant_id',
          normalizedValue: '12',
        }),
      ]),
    );
    expect(graph.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'forwarded_via',
          evidenceIds: ['ingress-1'],
        }),
        expect.objectContaining({
          relation: 'belongs_to',
          evidenceIds: ['user-1'],
        }),
      ]),
    );
  });

  it('selects evidence across jobs and entity types', () => {
    const graph = buildEvidenceGraph(evidence);
    const selected = selectRepresentativeEvidence(
      evidence,
      graph.entities,
      graph.relations,
      10,
    );
    expect(selected.map((item) => item.evidenceId).sort()).toEqual([
      'ingress-1',
      'user-1',
    ]);
  });
});
