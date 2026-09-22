import { UnauthorizedException } from '@nestjs/common';
import { OncallService } from './oncall.service';

const payload = (status: 'firing' | 'resolved' = 'firing') => ({
  status,
  receiver: 'dashboard-oncall',
  commonLabels: { environment: 'mgbx', severity: 'critical' },
  alerts: [{
    status,
    fingerprint: 'am-fingerprint-001',
    startsAt: '2026-09-22T00:00:00Z',
    endsAt: status === 'resolved' ? '2026-09-22T00:05:00Z' : '0001-01-01T00:00:00Z',
    labels: { alertname: 'DashboardOncallTest', namespace: 'monitoring', risk_level: 'high' },
    annotations: { summary: 'test alert' },
  }],
});

const makeService = (existing: any = null) => {
  const execute = jest.fn()
    .mockResolvedValueOnce([existing ? [existing] : [], []])
    .mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }, []])
    .mockResolvedValue([{ affectedRows: 1 }, []]);
  const db = {
    withTransaction: jest.fn(async (callback: any) => callback({ execute })),
    query: jest.fn(),
  };
  const service = new OncallService({} as any, {} as any, db as any, { record: jest.fn() } as any);
  return { service, db, execute };
};

describe('OncallService Alertmanager webhook', () => {
  const previousToken = process.env.ONCALL_ALERTMANAGER_BEARER_TOKEN;
  const previousInsecure = process.env.ONCALL_ALLOW_INSECURE_WEBHOOK;

  afterEach(() => {
    process.env.ONCALL_ALERTMANAGER_BEARER_TOKEN = previousToken;
    process.env.ONCALL_ALLOW_INSECURE_WEBHOOK = previousInsecure;
  });

  it('fails closed when a webhook token is not configured', () => {
    delete process.env.ONCALL_ALERTMANAGER_BEARER_TOKEN;
    delete process.env.ONCALL_ALLOW_INSECURE_WEBHOOK;
    const { service } = makeService();
    expect(() => service.assertWebhookAuthorization('Bearer anything')).toThrow(UnauthorizedException);
  });

  it('accepts only the configured Bearer token', () => {
    process.env.ONCALL_ALERTMANAGER_BEARER_TOKEN = 'test-token';
    const { service } = makeService();
    expect(() => service.assertWebhookAuthorization('Bearer test-token')).not.toThrow();
    expect(() => service.assertWebhookAuthorization('Bearer wrong-token')).toThrow(UnauthorizedException);
  });

  it('creates one firing alert and records a firing event', async () => {
    const { service, execute } = makeService();
    const result = await service.receiveAlertmanagerWebhook(payload(), {});
    expect(result).toMatchObject({ received: 1, created: 1, updated: 0, resolved: 0, duplicateEvents: 0, alertIds: [42] });
    expect(execute.mock.calls[1][0]).toContain('INSERT INTO oncall_alerts');
    expect(execute.mock.calls[2][0]).toContain('INSERT INTO oncall_alert_events');
    expect(execute.mock.calls[2][1][1]).toBe('FIRING');
  });

  it('records duplicate firing events without creating a second alert', async () => {
    const existing = { id: 9, status: 'FIRING' };
    const { service, execute } = makeService(existing);
    const result = await service.receiveAlertmanagerWebhook(payload(), {});
    expect(result).toMatchObject({ created: 0, updated: 0, duplicateEvents: 1, alertIds: [9] });
    expect(execute.mock.calls[1][0]).toContain('UPDATE oncall_alerts');
    expect(execute.mock.calls[2][1][1]).toBe('DUPLICATE');
  });

  it('transitions a firing alert to resolved and records the source event', async () => {
    const existing = { id: 9, status: 'FIRING' };
    const { service, execute } = makeService(existing);
    const result = await service.receiveAlertmanagerWebhook(payload('resolved'), {});
    expect(result).toMatchObject({ created: 0, updated: 1, resolved: 1, duplicateEvents: 0, alertIds: [9] });
    expect(execute.mock.calls[2][1][1]).toBe('RESOLVED');
  });
});
