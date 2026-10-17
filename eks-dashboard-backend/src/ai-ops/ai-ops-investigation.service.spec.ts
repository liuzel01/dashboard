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
          done: true,
          reason: '现有证据足够',
          serviceName: 'orders',
          queryTexts: [],
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
    discoverLabels: jest.fn().mockResolvedValue(null),
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

  it('returns collected evidence when the AI summary times out', async () => {
    const { service, aiOps } = createService();
    aiOps.completeLogInvestigationJson
      .mockReset()
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
          done: true,
          reason: '现有证据足够',
          serviceName: 'orders',
          queryTexts: [],
        }),
      })
      .mockRejectedValueOnce(new Error('timeout of 20000ms exceeded'));

    const result = await service.investigate('mgbx', actor, request);

    expect(result.evidence).toHaveLength(1);
    expect(result.answer.insufficientEvidence).toBe(false);
    expect(result.answer.evidenceIds).toEqual(['ev-1']);
    expect(result.execution.summaryFallbackReason).toContain('timeout');
  });

  it('keeps the user fixed clue in every refinement query', async () => {
    const { service, aiOps, logs } = createService();
    aiOps.completeLogInvestigationJson
      .mockReset()
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          intent: '调查目标用户',
          namespace: 'default',
          serviceName: 'orders',
          queryTexts: ['80420234'],
          rangeMinutes: 30,
          limit: 100,
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          done: false,
          reason: '继续检查绑定操作',
          serviceName: 'orders',
          queryTexts: ['pre-binding-google'],
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          done: true,
          reason: '证据足够',
          serviceName: 'orders',
          queryTexts: [],
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          summary: '发现目标用户绑定操作。',
          findings: [{ text: '存在绑定操作。', evidenceIds: ['ev-2'] }],
          evidenceIds: ['ev-2'],
          confidence: 'medium',
          insufficientEvidence: false,
        }),
      });
    logs.search
      .mockResolvedValueOnce({
        evidence: [
          {
            evidenceId: 'ev-1',
            timestamp: '2026-10-12T00:00:00.000Z',
            labels: { service_name: 'orders' },
            line: 'user=80420234 action=pre-binding-google',
          },
        ],
        exploreUrl: '',
        statistics: { matchingLines: 10, sampledLines: 1, truncated: true },
      })
      .mockResolvedValueOnce({
        evidence: [
          {
            evidenceId: 'ev-2',
            timestamp: '2026-10-12T00:01:00.000Z',
            labels: { service_name: 'orders' },
            line: 'user=80420234 pre-binding-google',
          },
        ],
        exploreUrl: '',
        statistics: { matchingLines: 1, sampledLines: 1, truncated: false },
      });

    const result = await service.investigate('mgbx', actor, {
      ...request,
      queryText: '80420234',
      limit: 100,
    });

    expect(logs.search).toHaveBeenNthCalledWith(
      2,
      'mgbx',
      actor,
      expect.objectContaining({
        queryTexts: ['80420234', 'pre-binding-google'],
      }),
    );
    expect(result.queryStatistics[1]).toEqual(
      expect.objectContaining({
        queryTexts: ['80420234', 'pre-binding-google'],
        matchingLines: 1,
      }),
    );
  });

  it('accepts a user-selected namespace outside the legacy static suggestions', async () => {
    const { service, aiOps, logs, platformDb } = createService();
    aiOps.completeLogInvestigationJson
      .mockReset()
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          intent: '调查入口日志',
          namespace: 'ingress-nginx',
          serviceName: 'orders',
          queryTexts: ['error'],
          rangeMinutes: 30,
          limit: 20,
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          done: true,
          reason: '证据足够',
          serviceName: 'orders',
          queryTexts: [],
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          summary: '发现入口错误。',
          findings: [{ text: '入口日志包含错误。', evidenceIds: ['ev-1'] }],
          evidenceIds: ['ev-1'],
          confidence: 'medium',
          insufficientEvidence: false,
        }),
      });

    await service.investigate('mgbx', actor, {
      ...request,
      namespace: 'ingress-nginx',
    });

    expect(logs.search).toHaveBeenCalledWith(
      'mgbx',
      actor,
      expect.objectContaining({ namespace: 'ingress-nginx' }),
    );
    expect(platformDb.query).toHaveBeenCalled();
  });

  it('returns deterministic insufficient evidence without asking the model to guess', async () => {
    const { service, aiOps, logs } = createService();
    logs.search.mockResolvedValue({ evidence: [], exploreUrl: '' });
    const result = await service.investigate('mgbx', actor, request);

    expect(aiOps.completeLogInvestigationJson).toHaveBeenCalledTimes(1);
    expect(result.answer.insufficientEvidence).toBe(true);
    expect(result.answer.evidenceIds).toEqual([]);
  });

  it('preserves an explicit absolute investigation window', async () => {
    const { service, aiOps, logs } = createService();
    aiOps.completeLogInvestigationJson
      .mockReset()
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          intent: '调查历史连接失败',
          namespace: 'default',
          serviceName: 'orders',
          queryTexts: ['connection refused'],
          // The model is not authoritative for an explicit user time window.
          rangeMinutes: 15,
          limit: 20,
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          done: true,
          reason: '现有证据足够',
          serviceName: 'orders',
          queryTexts: [],
        }),
      })
      .mockResolvedValueOnce({
        provider: 'cliproxy',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          summary: '发现历史连接失败。',
          findings: [{ text: '连接失败。', evidenceIds: ['ev-1'] }],
          evidenceIds: ['ev-1'],
          confidence: 'medium',
          insufficientEvidence: false,
        }),
      });

    const result = await service.investigate('mgbx', actor, {
      ...request,
      timeMode: 'absolute',
      from: '2026-10-12T00:00:00.000Z',
      to: '2026-10-12T01:00:00.000Z',
      rangeMinutes: undefined,
    });

    expect(logs.search).toHaveBeenCalledWith(
      'mgbx',
      actor,
      expect.objectContaining({
        from: '2026-10-12T00:00:00.000Z',
        to: '2026-10-12T01:00:00.000Z',
      }),
    );
    expect(result.range).toEqual({
      mode: 'absolute',
      from: '2026-10-12T00:00:00.000Z',
      to: '2026-10-12T01:00:00.000Z',
    });
    expect(result.plan.rangeMinutes).toBe(60);
  });

  it('builds and persists a generic evidence-backed joint report', async () => {
    const { service, aiOps, platformDb } = createService();
    platformDb.query
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 16,
          actor_user_id: 1,
          status: 'COMPLETED',
          request_json: JSON.stringify({ question: '入口异常调查' }),
          result_json: JSON.stringify({
            evidence: [
              {
                evidenceId: 'ingress-1',
                timestamp: '2026-10-16T01:00:00.000Z',
                labels: { service_name: 'ingress-nginx' },
                line: 'clientip=157.254.53.237 xff=143.109.37.118 host=www.example.com',
              },
            ],
            answer: { summary: '入口异常。' },
            queryStatistics: [{ matchingLines: 42 }],
          }),
        },
        {
          id: 17,
          actor_user_id: 1,
          status: 'COMPLETED',
          request_json: JSON.stringify({ question: '用户活动调查' }),
          result_json: JSON.stringify({
            evidence: [
              {
                evidenceId: 'user-1',
                timestamp: '2026-10-16T01:01:00.000Z',
                labels: { service_name: 'users' },
                line: 'userId=80420234 tenant=12 source_ip=143.109.37.118 email=demo@example.com',
              },
            ],
            answer: { summary: '用户活动。' },
            queryStatistics: [{ matchingLines: 10 }],
          }),
        },
      ])
      .mockResolvedValueOnce({ insertId: 9 });
    aiOps.completeLogInvestigationJson.mockReset().mockResolvedValueOnce({
      provider: 'cliproxy',
      model: 'gpt-5.6-terra',
      text: JSON.stringify({
        reportType: 'security',
        title: '联合调查报告',
        summary: '两个任务存在共同来源 IP。',
        sections: [
          {
            key: 'association',
            title: '关联发现',
            findings: [
              {
                text: '来源 IP 在入口和用户日志中共同出现。',
                evidenceIds: ['ingress-1', 'user-1'],
              },
            ],
          },
        ],
        timeline: [],
        uncertainties: [],
        recommendations: ['继续核实。'],
        confidence: 'medium',
      }),
    });

    const result = await service.correlate('mgbx', actor, [16, 17]);

    expect(result.reportId).toBe(9);
    expect(result.report.summary).toContain('共同来源 IP');
    expect(aiOps.completeLogInvestigationJson).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
    expect(result.sharedEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ip',
          normalizedValue: '143.109.37.118',
          jobIds: [16, 17],
        }),
      ]),
    );
    expect(platformDb.query).toHaveBeenLastCalledWith(
      expect.stringContaining('aiops_log_correlation_reports'),
      expect.arrayContaining(['mgbx', 1, 'admin']),
    );
  });
});
