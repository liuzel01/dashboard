import { BadRequestException } from '@nestjs/common';
import { AiOpsInvestigationService } from './ai-ops-investigation.service';

const actor = {
  userId: 1,
  username: 'admin',
  permissions: ['menu:ai-ops', 'aiops:log-investigate'],
  roles: ['admin'],
};

const request = {
  projectId: 'mgbx',
  sourceId: 'mgbx-loki-main',
  namespace: 'default',
  question: 'orders 服务为什么出现 connection refused？',
  serviceName: 'orders',
  rangeMinutes: 30,
  limit: 20,
};

const createService = () => {
  const aiOps = {
    completeLogInvestigationJson: jest
      .fn()
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          intent: '定位连接失败',
          namespace: 'default',
          serviceName: 'orders',
          queryTexts: ['connection refused'],
          rangeMinutes: 30,
          limit: 20,
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          summary: 'orders 服务出现连接拒绝。',
          findings: [{ text: '连接目标拒绝连接。', evidenceIds: ['ev-1'] }],
          evidenceIds: ['ev-1'],
          confidence: 'medium',
          insufficientEvidence: false,
        }),
      }),
  };
  const logs = {
    listSources: jest.fn().mockResolvedValue({
      environmentId: 'mgbx',
      items: [
        {
          projectId: 'mgbx',
          sourceId: 'mgbx-loki-main',
          allowedNamespaces: ['default'],
          allowedServices: [],
          maxRangeHours: 24,
          maxLines: 200,
        },
      ],
    }),
    search: jest.fn().mockResolvedValue({
      evidence: [
        {
          evidenceId: 'ev-1',
          timestamp: '2026-10-12T00:00:00.000Z',
          labels: { namespace: 'default', service_name: 'orders' },
          line: 'connection refused',
        },
      ],
      exploreUrl: 'https://grafana.example/explore',
    }),
  };
  const platformDb = {
    query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
  };
  return {
    service: new AiOpsInvestigationService(
      aiOps as any,
      logs as any,
      platformDb as any,
    ),
    aiOps,
    logs,
    platformDb,
  };
};

describe('AiOpsInvestigationService', () => {
  it('executes a validated plan and returns only cited evidence', async () => {
    const { service, logs, platformDb } = createService();
    const result = await service.investigate('mgbx', actor, request);

    expect(logs.search).toHaveBeenCalledWith(
      'mgbx',
      actor,
      expect.objectContaining({
        namespace: 'default',
        serviceName: 'orders',
        queryText: 'connection refused',
        limit: 20,
      }),
    );
    expect(result.answer.evidenceIds).toEqual(['ev-1']);
    expect(result.evidence).toHaveLength(1);
    expect(platformDb.query).toHaveBeenCalledWith(
      expect.stringContaining('aiops_log_investigation_audit'),
      expect.arrayContaining(['completed']),
    );
  });

  it('rejects an out-of-scope namespace before querying logs', async () => {
    const { service, aiOps, logs, platformDb } = createService();
    aiOps.completeLogInvestigationJson.mockReset().mockResolvedValue({
      provider: 'cliproxy',
      model: 'gpt-5.6-terra',
      text: JSON.stringify({
        intent: '跨环境扫描',
        namespace: 'kube-system',
        serviceName: 'orders',
        queryTexts: ['error'],
        rangeMinutes: 30,
        limit: 20,
      }),
    });

    await expect(service.investigate('mgbx', actor, request)).rejects.toThrow(
      BadRequestException,
    );
    expect(logs.search).not.toHaveBeenCalled();
    expect(platformDb.query).toHaveBeenCalledWith(
      expect.stringContaining('aiops_log_investigation_audit'),
      expect.arrayContaining(['rejected_or_failed']),
    );
  });

  it('returns deterministic insufficient evidence without asking the model to guess', async () => {
    const { service, aiOps, logs } = createService();
    logs.search.mockResolvedValue({ evidence: [], exploreUrl: '' });
    const result = await service.investigate('mgbx', actor, request);

    expect(aiOps.completeLogInvestigationJson).toHaveBeenCalledTimes(1);
    expect(result.answer.insufficientEvidence).toBe(true);
    expect(result.answer.evidenceIds).toEqual([]);
  });
});
