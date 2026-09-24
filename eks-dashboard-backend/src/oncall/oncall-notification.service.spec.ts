import axios from 'axios';
import { OncallNotificationService } from './oncall-notification.service';

describe('OncallNotificationService', () => {
  const previousWebhook = process.env.ONCALL_LARK_WEBHOOK_URL;

  afterEach(() => {
    if (previousWebhook === undefined) delete process.env.ONCALL_LARK_WEBHOOK_URL;
    else process.env.ONCALL_LARK_WEBHOOK_URL = previousWebhook;
    jest.restoreAllMocks();
  });

  it('falls back to the configured webhook when Hotline App is skipped', async () => {
    process.env.ONCALL_LARK_WEBHOOK_URL = 'https://example.test/lark-webhook';
    const query = jest.fn().mockResolvedValue([]);
    const db = {
      query,
      withTransaction: jest.fn(async (callback: any) => callback({
        execute: jest.fn()
          .mockResolvedValueOnce([[{ id: 1, status: 'PENDING' }], []])
          .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
      })),
    };
    const hotline = { sendGroupMessage: jest.fn().mockResolvedValue({ status: 'SKIPPED', detail: 'ONCALL_LARK_CHAT_ID is not configured' }) };
    jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { code: 0 } } as any);
    const service = new OncallNotificationService(db as any, hotline as any);

    await (service as any).dispatchOne({
      id: 1,
      alert_id: 9,
      alert_name: 'TestAlert',
      environment_id: 'mgbx',
      namespace: 'monitoring',
      severity: 'critical',
      risk_level: 'high',
      labels_json: '{}',
      annotations_json: '{"summary":"test"}',
    });

    expect(axios.post).toHaveBeenCalledWith(
      process.env.ONCALL_LARK_WEBHOOK_URL,
      expect.objectContaining({ msg_type: 'text' }),
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE oncall_notification_records SET status=?'),
      ['SENT', expect.stringContaining('Hotline App failed'), null, 'SENT', 1],
    );
  });
});
