import { HotlineService } from './hotline.service';
import axios from 'axios';

describe('HotlineService', () => {
  const previous = process.env.HOTLINE_ENABLED;
  const previousSupport = process.env.HOTLINE_URGENT_PHONE_SUPPORTED;
  afterEach(() => {
    if (previous === undefined) delete process.env.HOTLINE_ENABLED; else process.env.HOTLINE_ENABLED = previous;
    if (previousSupport === undefined) delete process.env.HOTLINE_URGENT_PHONE_SUPPORTED; else process.env.HOTLINE_URGENT_PHONE_SUPPORTED = previousSupport;
  });

  const service = () => new HotlineService({
    getUrgentPhoneSupported: jest.fn(async () => process.env.HOTLINE_URGENT_PHONE_SUPPORTED === 'true'),
    getHotlineEnabled: jest.fn(async () => process.env.HOTLINE_ENABLED === 'true'),
    getHotlineAppId: jest.fn(async () => process.env.HOTLINE_LARK_APP_ID || ''),
    getHotlineAppSecret: jest.fn(async () => process.env.HOTLINE_LARK_APP_SECRET || ''),
    getLarkChatId: jest.fn(async () => process.env.ONCALL_LARK_CHAT_ID || ''),
  } as any);

  it('is fail-closed when outbound hotline is not explicitly enabled', async () => {
    process.env.HOTLINE_URGENT_PHONE_SUPPORTED = 'true';
    process.env.HOTLINE_ENABLED = 'false';
    await expect(service().requestUrgentPhone('message-id', ['ou_test']))
      .resolves.toEqual({ status: 'SKIPPED', detail: 'HOTLINE_ENABLED is not true' });
  });

  it('records the documented Lark capability limitation without calling its API', async () => {
    process.env.HOTLINE_URGENT_PHONE_SUPPORTED = 'false';
    const post = jest.spyOn(axios, 'post');
    await expect(service().requestUrgentPhone('message-id', ['ou_test']))
      .resolves.toEqual({ status: 'UNSUPPORTED', detail: 'Lark tenant does not support application urgent-phone oncall' });
    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });

  it('uses the Hotline App open_id when resolving an email', async () => {
    process.env.HOTLINE_LARK_APP_ID = 'app';
    process.env.HOTLINE_LARK_APP_SECRET = 'secret';
    const post = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'token' } } as any)
      .mockResolvedValueOnce({ status: 200, data: { code: 0, data: { user_list: [{ user_id: 'ou_app_specific' }] } } } as any);
    await expect(service().resolveOpenIds(['person@example.com'])).resolves.toEqual(['ou_app_specific']);
    expect(post.mock.calls[1][0]).toContain('user_id_type=open_id');
    post.mockRestore();
  });

  it('accepts a successful empty response from the urgent-phone endpoint', async () => {
    process.env.HOTLINE_URGENT_PHONE_SUPPORTED = 'true';
    process.env.HOTLINE_ENABLED = 'true';
    process.env.HOTLINE_LARK_APP_ID = 'app';
    process.env.HOTLINE_LARK_APP_SECRET = 'secret';
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { code: 0, tenant_access_token: 'token' } } as any);
    const patch = jest.spyOn(axios, 'patch')
    patch.mockResolvedValueOnce({ status: 200, data: '' } as any);
    await expect(service().requestUrgentPhone('message', ['ou_app_specific'])).resolves.toEqual({ status: 'SENT' });
    post.mockRestore();
    patch.mockRestore();
  });
});
