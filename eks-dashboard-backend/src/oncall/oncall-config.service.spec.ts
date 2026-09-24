import { OncallConfigService } from './oncall-config.service';

describe('OncallConfigService', () => {
  it('reads Oncall values from the siteconf keys', async () => {
    const siteConf = {
      getString: jest.fn(async (key: string, fallback: string) => `${key}:${fallback}`),
      getBoolean: jest.fn(async (key: string, _fallback: boolean) => key.includes('hotline.enabled') || key.includes('urgent_phone_supported') || key.includes('escalation.enabled')),
      getNumber: jest.fn(async (key: string, fallback: number) => fallback + 1),
    };
    const service = new OncallConfigService(siteConf as any);

    await expect(service.getAlertmanagerBearerToken()).resolves.toBe('oncall.alertmanager.bearer_token:');
    await expect(service.getLarkWebhookUrl()).resolves.toBe('oncall.lark.webhook_url:');
    await expect(service.getLarkChatId()).resolves.toBe('oncall.lark.chat_id:');
    await expect(service.getDefaultEnvironment()).resolves.toBe('oncall.default_environment:mgbx');
    await expect(service.getAllowInsecureWebhook()).resolves.toBe(false);
    await expect(service.getHotlineAppId()).resolves.toBe('oncall.hotline.lark_app_id:');
    await expect(service.getHotlineAppSecret()).resolves.toBe('oncall.hotline.lark_app_secret:');
    await expect(service.getHotlineEnabled()).resolves.toBe(true);
    await expect(service.getUrgentPhoneSupported()).resolves.toBe(true);
    await expect(service.getEscalationEnabled()).resolves.toBe(true);
    await expect(service.getL1AckTimeoutMinutes()).resolves.toBe(11);
    await expect(service.getL2AckTimeoutMinutes()).resolves.toBe(6);
    await expect(service.getOwnerAckTimeoutMinutes()).resolves.toBe(6);
  });
});
