import { UnauthorizedException } from '@nestjs/common';
import { AiOpsAlertInvestigationService } from './ai-ops-alert-investigation.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

const payload = (alertname = 'KylinBackendServiceHttpLatencyHigh') => ({
  status: 'firing',
  commonLabels: { environment: 'mgbx', severity: 'warning' },
  alerts: [
    {
      status: 'firing',
      fingerprint: 'fp-001',
      startsAt: '2026-10-13T03:50:43.873Z',
      labels: { alertname, service: 'kylin-tenant-kylin-tenant-impl' },
      annotations: { summary: 'latency high' },
    },
  ],
});

const makeService = (existingId?: number) => {
  let queuedPayload = '';
  let queueClaimed = false;
  let queueInserted = false;
  const execute = jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT IGNORE INTO aiops_alert_event_queue')) {
      queuedPayload = typeof params?.[4] === 'string' ? params[4] : '';
      const affectedRows = queueInserted ? 0 : 1;
      queueInserted = true;
      return [{ insertId: 11, affectedRows }, []];
    }
    if (
      sql.includes('FROM aiops_alert_event_queue') &&
      sql.includes('event_key=?')
    )
      return [[{ id: 11, status: 'PENDING', investigation_id: null }], []];
    if (sql.includes("status='PENDING'")) {
      if (queueClaimed || !queuedPayload) return [[], []];
      queueClaimed = true;
      return [[{ id: 11, payload_json: queuedPayload, attempt_count: 0 }], []];
    }
    if (sql.includes('SELECT id FROM aiops_investigations'))
      return [[...(existingId ? [{ id: existingId }] : [])], []];
    if (sql.includes('INSERT INTO aiops_investigations'))
      return [{ insertId: 7, affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  });
  const db = {
    withTransaction: jest.fn(async (fn: any) => fn({ execute })),
    query: jest.fn(async (sql: string) =>
      sql.includes('COUNT(*) AS total FROM aiops_alert_event_queue')
        ? [{ total: 0 }]
        : [],
    ),
  };
  const siteConf = {
    getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
    getString: jest.fn(async (key: string, fallback: string) => {
      if (key === 'aiops.alertmanager.bearer_token') return 'test-token';
      if (key === 'aiops.alertmanager.excluded_alerts')
        return 'Watchdog,InfoInhibitor,DashboardAiOpsSmokeTest';
      if (key === 'aiops.alertmanager.default_environment') return 'mgbx';
      return fallback;
    }),
  };
  const prometheus = {
    supports: jest.fn((alertName: string) =>
      [
        'KylinBackendServiceHttpLatencyHigh',
        'CPUThrottlingHigh',
        'PodOOMKilled',
      ].includes(alertName),
    ),
    collect: jest.fn(async () => ({
      playbookKey: 'KYLIN_BACKEND_HTTP_LATENCY_HIGH',
      playbookVersion: 'latency-v1',
      classification: 'LOW_TRAFFIC_SLOW_URI',
      confidence: 'MEDIUM',
      insufficientEvidence: false,
      findings: ['low traffic'],
      recommendations: ['inspect logs'],
      missingEvidence: ['release'],
      evidence: [],
    })),
  };
  const contextEvidence = {
    collect: jest.fn(async () => ({
      evidence: [
        {
          evidenceId: 'loki-query-test',
          evidenceType: 'LOG',
          sourceSystem: 'grafana-loki',
          observedAt: '2026-10-13T03:50:43.873Z',
          title: 'Loki query',
          content: { hitCount: 0 },
          sourceUrl: '',
        },
      ],
      findings: [],
      missingEvidence: ['kubernetes'],
      timeline: [],
    })),
  };
  const groupCallback = {
    enqueue: jest.fn(async () => ({ status: 'DISABLED' })),
  };
  const service = new AiOpsAlertInvestigationService(
    db as any,
    siteConf as any,
    { get: jest.fn() } as any,
    prometheus as any,
    contextEvidence as any,
    groupCallback as any,
  );
  return { service, db, execute, prometheus, contextEvidence, groupCallback };
};

describe('AiOpsAlertInvestigationService', () => {
  const actor = {
    userId: 1,
    username: 'operator',
    permissions: ['menu:ai-ops'],
  };

  it('rejects an invalid webhook token', async () => {
    const { service } = makeService();
    await expect(
      service.receiveAlertmanager('Bearer wrong', payload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates a persisted investigation with deep evidence for a specialized alert', async () => {
    const { service, execute } = makeService();
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload(),
    );
    expect(result).toMatchObject({
      received: 1,
      accepted: 1,
      ignored: 0,
      queued: 1,
      eventIds: [11],
    });
    await service.processQueuedAlerts();
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO aiops_investigations'),
      ),
    ).toBe(true);
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO aiops_investigation_evidence'),
      ),
    ).toBe(true);
    const reportJson = execute.mock.calls
      .flatMap((call) => (Array.isArray(call[1]) ? call[1] : []))
      .find(
        (value) =>
          typeof value === 'string' && value.includes('"missingEvidence"'),
      );
    const report = JSON.parse(String(reportJson)) as {
      missingEvidence: string[];
    };
    expect(report.missingEvidence).not.toEqual(
      expect.arrayContaining(['关联日志', 'release']),
    );
  });

  it('deduplicates the same Alertmanager delivery before investigation work', async () => {
    const { service, prometheus } = makeService();
    const first = await service.receiveAlertmanager(
      'Bearer test-token',
      payload(),
    );
    const second = await service.receiveAlertmanager(
      'Bearer test-token',
      payload(),
    );

    expect(first).toMatchObject({ queued: 1, duplicate: 0 });
    expect(second).toMatchObject({ queued: 0, duplicate: 1 });
    expect(prometheus.collect).not.toHaveBeenCalled();
  });

  it('updates the existing investigation for duplicate deliveries', async () => {
    const { service, execute } = makeService(7);
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload(),
    );
    await service.processQueuedAlerts();
    expect(result).toMatchObject({
      accepted: 1,
      queued: 1,
      eventIds: [11],
    });
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE aiops_investigations'),
      ),
    ).toBe(true);
  });

  it('resolves the existing specialized investigation without matching a playbook version', async () => {
    const { service, execute } = makeService(7);
    const resolved = payload('PodOOMKilled');
    resolved.status = 'resolved';
    resolved.alerts[0].status = 'resolved';
    (
      resolved.alerts[0] as (typeof resolved.alerts)[0] & { endsAt: string }
    ).endsAt = '2026-10-14T04:00:00.000Z';

    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      resolved,
    );
    await service.processQueuedAlerts();

    expect(result).toMatchObject({ queued: 1 });
    const select = execute.mock.calls.find(([sql]) =>
      String(sql).includes('SELECT id FROM aiops_investigations'),
    );
    expect(String(select?.[0])).not.toContain('playbook_version=?');
    expect(select?.[1]).toHaveLength(4);
  });

  it('accepts an alert without a specialized playbook as a lightweight report', async () => {
    const { service, prometheus, contextEvidence, groupCallback } =
      makeService();
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload('PreviouslyUnknownAlert'),
    );
    expect(result).toMatchObject({
      received: 1,
      accepted: 1,
      ignored: 0,
      queued: 1,
    });
    await service.processQueuedAlerts();
    expect(prometheus.collect).not.toHaveBeenCalled();
    expect(contextEvidence.collect).not.toHaveBeenCalled();
    expect(groupCallback.enqueue).not.toHaveBeenCalled();
  });

  it('ignores alerts in the explicit exclusion list', async () => {
    const { service, db } = makeService();
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload('Watchdog'),
    );
    expect(result).toMatchObject({
      received: 1,
      accepted: 0,
      ignored: 1,
      queued: 0,
    });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('ignores alerts that explicitly disable AIOps', async () => {
    const { service, db } = makeService();
    const disabled = payload('PodOOMKilled');
    disabled.alerts[0].labels = {
      ...disabled.alerts[0].labels,
      aiops_enabled: 'false',
    };
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      disabled,
    );
    expect(result).toMatchObject({ accepted: 0, ignored: 1, queued: 0 });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects oversized webhook payloads before persistence', async () => {
    const { service, db } = makeService();
    const oversized = payload();
    oversized.alerts[0].annotations.summary = 'x'.repeat(300_000);
    await expect(
      service.receiveAlertmanager('Bearer test-token', oversized),
    ).rejects.toThrow('payload exceeds');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('lists only replay cases belonging to the current environment', () => {
    const { service } = makeService();
    const cases = service.listReplayCases('mgbx', actor).items;
    expect(cases).toHaveLength(4);
    expect(cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'jvm-heap-high-synthetic-v1' }),
        expect.objectContaining({ key: 'http-error-rate-synthetic-v1' }),
      ]),
    );
    expect(service.listReplayCases('hashex', actor).items).toHaveLength(0);
  });

  it('reports evidence coverage, feedback, and partial steps separately', async () => {
    const { service, db } = makeService();
    db.query
      .mockResolvedValueOnce([{ total: 3, synthetic_count: 1 }])
      .mockResolvedValueOnce([
        { source_system: 'prometheus', investigation_count: 3 },
      ])
      .mockResolvedValueOnce([{ rating: 'EFFECTIVE', count: 1 }])
      .mockResolvedValueOnce([
        { step_key: 'context.collect', status: 'PARTIAL', count: 1 },
      ])
      .mockResolvedValueOnce([{ status: 'FAILED', count: 1 }]);

    const result = await service.qualitySummary('mgbx', actor);

    expect(result.overview).toMatchObject({ total: 3, synthetic_count: 1 });
    expect(result.evidenceCoverage).toHaveLength(1);
    expect(result.partialOrFailedSteps).toHaveLength(1);
    expect(result.queue).toEqual([{ status: 'FAILED', count: 1 }]);
    expect(result.note).toContain('Synthetic exercises');
  });

  it('replays a fixed historical case without requiring the webhook token', async () => {
    const { service, execute } = makeService();
    const result = await service.replay(
      'mgbx',
      actor,
      'kylin-backend-http-latency-high-20261013',
    );
    expect(result).toMatchObject({ investigationId: 7, created: true });
    const select = execute.mock.calls.find(([sql]) =>
      String(sql).includes('SELECT id FROM aiops_investigations'),
    );
    expect(select?.[1]).toContain('HISTORICAL_REPLAY');
    expect(
      execute.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes('INSERT INTO aiops_investigation_steps') &&
          Array.isArray(params) &&
          params.includes('historical.replay'),
      ),
    ).toBe(true);
  });
});
