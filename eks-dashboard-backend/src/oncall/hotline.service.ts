import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type HotlineResult = { status: 'SENT' | 'SKIPPED' | 'FAILED'; detail?: string };

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
    const appId = String(process.env.HOTLINE_LARK_APP_ID || '').trim();
    const appSecret = String(process.env.HOTLINE_LARK_APP_SECRET || '').trim();
    if (!appId || !appSecret) return { status: 'SKIPPED', detail: 'Hotline credentials are not configured' };
    try {
      const tokenResponse = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret }, { timeout: 10_000 });
      const token = String(tokenResponse.data?.tenant_access_token || '');
      if (tokenResponse.data?.code !== 0 || !token) throw new Error(`token request failed: ${String(tokenResponse.data?.msg || tokenResponse.status)}`);
      const response = await axios.post(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/urgent_phone`, {
        user_id_type: 'open_id', user_id_list: openIds,
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, validateStatus: () => true });
      if (response.status < 200 || response.status >= 300 || Number(response.data?.code) !== 0) throw new Error(`urgent_phone failed: HTTP ${response.status}, code ${String(response.data?.code ?? 'unknown')}`);
      return { status: 'SENT' };
    } catch (error: any) {
      const detail = String(error?.message || error).slice(0, 1000);
      this.logger.warn(`Hotline urgent phone failed: ${detail}`);
      return { status: 'FAILED', detail };
    }
  }
}
