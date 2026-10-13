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
  const execute = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT id FROM aiops_investigations'))
      return [[...(existingId ? [{ id: existingId }] : [])], []];
    if (sql.includes('INSERT INTO aiops_investigations'))
      return [{ insertId: 7, affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  });
  const db = {
    withTransaction: jest.fn(async (fn: any) => fn({ execute })),
    query: jest.fn(),
  };
  const siteConf = {
    getString: jest.fn(async (key: string, fallback: string) => {
      if (key === 'aiops.alertmanager.bearer_token') return 'test-token';
      if (key === 'aiops.alertmanager.allowed_alerts')
        return 'KylinBackendServiceHttpLatencyHigh,CPUThrottlingHigh';
      if (key === 'aiops.alertmanager.default_environment') return 'mgbx';
      return fallback;
    }),
  };
  const service = new AiOpsAlertInvestigationService(
    db as any,
    siteConf as any,
    { get: jest.fn() } as any,
  );
  return { service, db, execute };
};

describe('AiOpsAlertInvestigationService', () => {
  it('rejects an invalid webhook token', async () => {
    const { service } = makeService();
    await expect(
      service.receiveAlertmanager('Bearer wrong', payload()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates a persisted generic investigation for an allowed alert', async () => {
    const { service, execute } = makeService();
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload(),
    );
    expect(result).toMatchObject({
      received: 1,
      accepted: 1,
      ignored: 0,
      created: 1,
      investigationIds: [7],
    });
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
  });

  it('updates the existing investigation for duplicate deliveries', async () => {
    const { service, execute } = makeService(7);
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload(),
    );
    expect(result).toMatchObject({
      accepted: 1,
      created: 0,
      updated: 1,
      investigationIds: [7],
    });
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE aiops_investigations'),
      ),
    ).toBe(true);
  });

  it('ignores alerts outside the explicit whitelist', async () => {
    const { service, db } = makeService();
    const result = await service.receiveAlertmanager(
      'Bearer test-token',
      payload('UnapprovedAlert'),
    );
    expect(result).toMatchObject({
      received: 1,
      accepted: 0,
      ignored: 1,
      created: 0,
    });
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
});
