import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { HotlineService } from './hotline.service';

type NotificationRow = Record<string, any>;

@Injectable()
export class OncallNotificationService {
  private readonly logger = new Logger(OncallNotificationService.name);
  private running = false;

  constructor(private readonly db: PlatformDatabaseService, private readonly hotline: HotlineService) {}

  async enqueueFiringAlert(alertId: number, firedAt: string) {
    const idempotencyKey = `lark:oncall-alert:${alertId}:firing:${firedAt}`;
    await this.db.query(
      `INSERT INTO oncall_notification_records
       (alert_id, channel, status, idempotency_key, created_at)
       VALUES (?, 'lark-webhook', 'PENDING', ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE id=id`,
      [alertId, idempotencyKey],
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPendingNotifications() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.db.query<NotificationRow[]>(
        `SELECT n.id, n.alert_id, n.idempotency_key, a.alert_name, a.environment_id, a.namespace, a.severity, a.risk_level,
                a.status, a.first_fired_at, a.labels_json, a.annotations_json
         FROM oncall_notification_records n
         INNER JOIN oncall_alerts a ON a.id=n.alert_id
         WHERE n.channel='lark-webhook' AND n.status='PENDING'
         ORDER BY n.id ASC LIMIT 20`,
      );
      for (const notification of pending) await this.dispatchOne(notification);
    } finally {
      this.running = false;
    }
  }

  private async dispatchOne(notification: NotificationRow) {
    const claimed = await this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>('SELECT id, status FROM oncall_notification_records WHERE id=? LIMIT 1 FOR UPDATE', [notification.id]);
      if (!rows[0] || rows[0].status !== 'PENDING') return false;
      const [update] = await conn.execute<any>('UPDATE oncall_notification_records SET status=\'SENDING\' WHERE id=? AND status=\'PENDING\'', [notification.id]);
      return Number(update.affectedRows) === 1;
    });
    if (!claimed) return;

    const result = await this.hotline.sendGroupMessage(this.message(notification));
    if (result.status === 'SENT') {
      await this.finish(notification.id, 'SENT', undefined, result.messageId);
      return;
    }
    if (result.status === 'SKIPPED') {
      await this.finish(notification.id, 'SKIPPED', result.detail);
      return;
    }
    try {
      const webhookUrl = String(process.env.ONCALL_LARK_WEBHOOK_URL || '').trim();
      if (!webhookUrl) throw new Error(result.detail || 'Hotline App group message failed');
      const response = await axios.post(webhookUrl, {
        msg_type: 'text',
        content: { text: this.message(notification) },
      }, { timeout: 10_000, validateStatus: () => true });
      const code = Number(response.data?.code ?? response.data?.StatusCode ?? 0);
      if (response.status < 200 || response.status >= 300 || code !== 0) {
        throw new Error(`Lark webhook response HTTP ${response.status}, code ${Number.isFinite(code) ? code : 'unknown'}`);
      }
      await this.finish(notification.id, 'SENT', `Hotline App failed; delivered by legacy webhook: ${result.detail || 'unknown error'}`);
    } catch (error: any) {
      const message = String(error?.message || error).slice(0, 1000);
      this.logger.warn(`Oncall Lark notification ${notification.id} failed: ${message}`);
      await this.finish(notification.id, 'FAILED', message);
    }
  }

  private message(notification: NotificationRow) {
    const labels = this.parseJson(notification.labels_json);
    const annotations = this.parseJson(notification.annotations_json);
    const summary = String(annotations.summary || annotations.description || '').slice(0, 1000);
    const lines = [
      '【Oncall 告警】',
      `名称：${notification.alert_name}`,
      `环境：${notification.environment_id}`,
      notification.namespace ? `Namespace：${notification.namespace}` : '',
      notification.severity ? `Severity：${notification.severity}` : '',
      notification.risk_level ? `风险级别：${notification.risk_level}` : '',
      summary ? `摘要：${summary}` : '',
      labels.runbook_url ? `Runbook：${String(labels.runbook_url).slice(0, 500)}` : '',
      `告警 ID：${notification.alert_id}`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  private parseJson(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    try { return JSON.parse(String(value || '{}')) as Record<string, unknown>; } catch { return {}; }
  }

  private async finish(id: number, status: 'SENT' | 'SKIPPED' | 'FAILED', errorMessage?: string, providerMessageId?: string) {
    await this.db.query(
      `UPDATE oncall_notification_records SET status=?, error_message=?, provider_message_id=?, sent_at=IF(?='SENT', UTC_TIMESTAMP(), NULL) WHERE id=?`,
      [status, errorMessage || null, providerMessageId || null, status, id],
    );
  }
}
