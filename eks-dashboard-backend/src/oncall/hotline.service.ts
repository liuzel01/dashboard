import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type HotlineResult = { status: 'SENT' | 'SKIPPED' | 'FAILED'; detail?: string; messageId?: string };

/**
 * Lark's urgent-phone endpoint operates on a message produced by the Lark app.
 * Keeping it here prevents escalation rules from coupling to a vendor API.
 */
@Injectable()
export class HotlineService {
  private readonly logger = new Logger(HotlineService.name);

  async requestUrgentPhone(messageId: string, openIds: string[]): Promise<HotlineResult> {
    if (process.env.HOTLINE_ENABLED !== 'true') return { status: 'SKIPPED', detail: 'HOTLINE_ENABLED is not true' };
    if (!messageId || openIds.length === 0) return { status: 'SKIPPED', detail: 'messageId and recipient open_ids are required' };
    try {
      const token = await this.tenantToken();
      const response = await axios.post(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/urgent_phone`, {
        user_id_type: 'open_id', user_id_list: openIds,
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, validateStatus: () => true });
      const businessCode = response.data?.code;
      if (response.status < 200 || response.status >= 300 || (businessCode !== undefined && Number(businessCode) !== 0)) {
        throw new Error(`urgent_phone failed: HTTP ${response.status}, code ${String(businessCode ?? 'unknown')}`);
      }
      return { status: 'SENT' };
    } catch (error: any) {
      const detail = String(error?.message || error).slice(0, 1000);
      this.logger.warn(`Hotline urgent phone failed: ${detail}`);
      return { status: 'FAILED', detail };
    }
  }

  private async tenantToken(): Promise<string> {
    const appId = String(process.env.HOTLINE_LARK_APP_ID || '').trim();
    const appSecret = String(process.env.HOTLINE_LARK_APP_SECRET || '').trim();
    if (!appId || !appSecret) throw new Error('Hotline credentials are not configured');
    const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret }, { timeout: 10_000 });
    const token = String(response.data?.tenant_access_token || '');
    if (response.data?.code !== 0 || !token) throw new Error(`token request failed: ${String(response.data?.msg || response.status)}`);
    return token;
  }
  async resolveOpenIds(emails: string[]): Promise<string[]> {
    if (emails.length === 0) return [];
    const token = await this.tenantToken();
    const response = await axios.post('https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id', { emails }, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300 || Number(response.data?.code) !== 0) {
      throw new Error(`email lookup failed: HTTP ${response.status}, code ${String(response.data?.code ?? 'unknown')}`);
    }
    // batch_get_id labels the returned identity `user_id`; the requested user_id_type controls its value.
    return (response.data?.data?.user_list || []).map((item: any) => String(item.open_id || item.user_id || '')).filter(Boolean);
  }

  async sendGroupMessage(text: string): Promise<HotlineResult> {
    const chatId = String(process.env.ONCALL_LARK_CHAT_ID || '').trim();
    if (!chatId) return { status: 'SKIPPED', detail: 'ONCALL_LARK_CHAT_ID is not configured' };
    try {
      const token = await this.tenantToken();
      const response = await axios.post('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
        receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }),
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, validateStatus: () => true });
      const messageId = String(response.data?.data?.message_id || '');
      if (response.status < 200 || response.status >= 300 || Number(response.data?.code) !== 0 || !messageId) {
        throw new Error(`send message failed: HTTP ${response.status}, code ${String(response.data?.code ?? 'unknown')}`);
      }
      return { status: 'SENT', messageId };
    } catch (error: any) {
      const detail = String(error?.message || error).slice(0, 1000);
      this.logger.warn(`Hotline group message failed: ${detail}`);
      return { status: 'FAILED', detail };
    }
  }
}
