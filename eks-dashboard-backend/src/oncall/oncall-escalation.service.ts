import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { HotlineService } from './hotline.service';
import { OncallConfigService } from './oncall-config.service';

type AlertRow = { id: number; first_fired_at: string; environment_id: string; status: string };
type EscalationRow = { id: number; alert_id: number; level: string; status: string };
const LEVELS = ['L1', 'L2', 'OWNER'] as const;
type EscalationLevel = typeof LEVELS[number];

/** Durable timeout scheduler and idempotent Hotline dispatcher. Disabled unless explicitly enabled. */
@Injectable()
export class OncallEscalationService {
  private running = false;
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly hotline: HotlineService,
    private readonly config: OncallConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    if (this.running || !(await this.config.getEscalationEnabled())) return;
    this.running = true;
    try { await this.createDueRecords(); await this.dispatchDueRecords(); } finally { this.running = false; }
  }

  private async createDueRecords() {
    const [l1Raw, l2Raw, ownerRaw] = await Promise.all([
      this.config.getL1AckTimeoutMinutes(),
      this.config.getL2AckTimeoutMinutes(),
      this.config.getOwnerAckTimeoutMinutes(),
    ]);
    const l1 = this.positiveInt(l1Raw, 10);
    const l2 = this.positiveInt(l2Raw, 5);
    const owner = this.positiveInt(ownerRaw, 5);
    const alerts = await this.db.query<AlertRow[]>(`SELECT id, first_fired_at, environment_id, status FROM oncall_alerts WHERE status='FIRING' ORDER BY first_fired_at ASC LIMIT 100`);
    for (const alert of alerts) {
      const times: Record<EscalationLevel, number> = { L1: l1, L2: l1 + l2, OWNER: l1 + l2 + owner };
      for (const level of LEVELS) {
        await this.db.query(
          `INSERT INTO oncall_escalation_records
           (alert_id, level, status, idempotency_key, scheduled_at, created_at, updated_at)
           SELECT ?, ?, 'PENDING', ?, DATE_ADD(?, INTERVAL ? MINUTE), UTC_TIMESTAMP(), UTC_TIMESTAMP()
           FROM DUAL WHERE UTC_TIMESTAMP() >= DATE_ADD(?, INTERVAL ? MINUTE)
           ON DUPLICATE KEY UPDATE id=id`,
          [alert.id, level, `oncall:${alert.id}:${level}:${alert.first_fired_at}`, alert.first_fired_at, times[level], alert.first_fired_at, times[level]],
        );
      }
    }
  }

  private async dispatchDueRecords() {
    const records = await this.db.query<EscalationRow[]>(`SELECT id, alert_id, level, status FROM oncall_escalation_records WHERE status='PENDING' AND scheduled_at <= UTC_TIMESTAMP() ORDER BY id ASC LIMIT 50`);
    for (const record of records) await this.dispatchOne(record);
  }

  private async dispatchOne(record: EscalationRow) {
    const claimed = await this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>(`SELECT e.id, e.alert_id, e.level, e.status, a.status AS alert_status FROM oncall_escalation_records e INNER JOIN oncall_alerts a ON a.id=e.alert_id WHERE e.id=? FOR UPDATE`, [record.id]);
      const current = rows[0];
      if (!current || current.status !== 'PENDING') return false;
      if (current.alert_status !== 'FIRING') {
        await conn.execute(`UPDATE oncall_escalation_records SET status='CANCELLED', updated_at=UTC_TIMESTAMP(), executed_at=UTC_TIMESTAMP(), error_message=? WHERE id=?`, ['alert is no longer firing', record.id]);
        return false;
      }
      await conn.execute(`UPDATE oncall_escalation_records SET status='SENDING', attempt_count=attempt_count+1, updated_at=UTC_TIMESTAMP() WHERE id=? AND status='PENDING'`, [record.id]);
      return true;
    });
    if (!claimed) return;
    try {
      const messageRows = await this.db.query<Array<{ provider_message_id: string | null }>>(`SELECT provider_message_id FROM oncall_notification_records WHERE alert_id=? AND channel='lark-webhook' AND status='SENT' AND provider_message_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [record.alert_id]);
      const messageId = messageRows[0]?.provider_message_id;
      if (!messageId) return this.finish(record.id, 'FAILED', 'No Hotline App message_id is available');
      const bindings = await this.db.query<Array<{ email: string }>>(`SELECT email FROM oncall_identity_bindings WHERE environment_id=(SELECT environment_id FROM oncall_alerts WHERE id=?) AND level=? AND enabled=1 AND (active_from IS NULL OR active_from<=UTC_TIMESTAMP()) AND (active_until IS NULL OR active_until>=UTC_TIMESTAMP()) ORDER BY id`, [record.alert_id, record.level]);
      const emails = bindings.map((binding) => String(binding.email || '').trim()).filter(Boolean);
      if (!emails.length) return this.finish(record.id, 'SKIPPED', `No active ${record.level} email binding`);
      const openIds = await this.hotline.resolveOpenIds(emails);
      if (!openIds.length) return this.finish(record.id, 'FAILED', `No Hotline App identity resolved for ${record.level}`);
      const result = await this.hotline.requestUrgentPhone(messageId, openIds);
      return this.finish(record.id, result.status === 'SENT' ? 'SENT' : result.status, result.detail);
    } catch (error: any) { return this.finish(record.id, 'FAILED', String(error?.message || error).slice(0, 1000)); }
  }

  private async finish(id: number, status: 'SENT' | 'SKIPPED' | 'UNSUPPORTED' | 'FAILED', errorMessage?: string) {
    await this.db.query(`UPDATE oncall_escalation_records SET status=?, error_message=?, executed_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP() WHERE id=?`, [status, errorMessage || null, id]);
  }

  private positiveInt(value: string | number | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 1440 ? parsed : fallback;
  }
}
