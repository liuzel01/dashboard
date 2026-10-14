import { AiOpsGroupCallbackService } from './ai-ops-group-callback.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const input = {
  investigationId: 7,
  sourceType: 'ALERTMANAGER_ALERT',
  sourceStatus: 'FIRING',
  alertName: 'CPUThrottlingHigh',
  environmentId: 'mgbx',
  classification: 'OBSERVE',
  confidence: 'LOW',
  summary: '需要继续观察。',
};

describe('AiOpsGroupCallbackService', () => {
  it('does not enqueue while the callback switch is disabled', async () => {
    const db = { query: jest.fn() };
    const siteConf = {
      getBoolean: jest.fn(() => Promise.resolve(false)),
    };
    const service = new AiOpsGroupCallbackService(
      db as any,
      siteConf as any,
      {} as any,
    );

    await expect(service.enqueue(input)).resolves.toEqual({
      status: 'DISABLED',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('never enqueues historical replays', async () => {
    const db = { query: jest.fn() };
    const service = new AiOpsGroupCallbackService(
      db as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.enqueue({ ...input, sourceType: 'HISTORICAL_REPLAY' }),
    ).resolves.toEqual({ status: 'SKIPPED_REPLAY' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('enqueues one bounded idempotent message with a detail link', async () => {
    const db = { query: jest.fn(() => Promise.resolve({ affectedRows: 1 })) };
    const siteConf = {
      getBoolean: jest.fn(() => Promise.resolve(true)),
      getNumber: jest.fn(() => Promise.resolve(300)),
      getString: jest.fn(() => Promise.resolve('https://dashboard.example/')),
    };
    const service = new AiOpsGroupCallbackService(
      db as any,
      siteConf as any,
      {} as any,
    );

    await expect(service.enqueue(input)).resolves.toEqual({
      status: 'PENDING',
    });
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('aiops:lark:7:firing');
    expect(String(params[2])).toContain('【AI 初步调查】');
    expect(String(params[2])).toContain(
      'https://dashboard.example/ai-ops/investigations/7',
    );
    expect(String(params[2]).length).toBeLessThanOrEqual(300);
  });

  it('keeps pending records untouched when disabled at dispatch time', async () => {
    const db = { query: jest.fn() };
    const siteConf = {
      getBoolean: jest.fn(() => Promise.resolve(false)),
    };
    const service = new AiOpsGroupCallbackService(
      db as any,
      siteConf as any,
      {} as any,
    );

    await service.dispatchPending();
    expect(db.query).not.toHaveBeenCalled();
  });
});
