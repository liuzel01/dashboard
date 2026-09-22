import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlatformDatabaseService } from '../access-control/platform-database.service';

type AlertRow = { id: number; first_fired_at: string; environment_id: string };

/** Persists escalation deadlines; delivery is deliberately disabled until roster and app-message wiring are configured. */
@Injectable()
export class OncallEscalationService {
  private running = false;
  constructor(private readonly db: PlatformDatabaseService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduleOverdueAcknowledgements() {
    if (this.running || process.env.ONCALL_ESCALATION_ENABLED !== 'true') return;
    this.running = true;
    try {
      const minutes = this.positiveInt(process.env.ONCALL_L1_ACK_TIMEOUT_MINUTES, 10);
      const alerts = await this.db.query<AlertRow[]>(
        `SELECT id, first_fired_at, environment_id FROM oncall_alerts
         WHERE status='FIRING' AND first_fired_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
         ORDER BY first_fired_at ASC LIMIT 100`, [minutes],
      );
      for (const alert of alerts) {
        const key = `oncall:${alert.id}:L1:${alert.first_fired_at}`;
        await this.db.query(
          `INSERT INTO oncall_escalation_records
           (alert_id, level, status, idempotency_key, scheduled_at, created_at, updated_at)
           VALUES (?, 'L1', 'PENDING_CONFIGURATION', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE id=id`, [alert.id, key],
        );
      }
    } finally { this.running = false; }
  }

  private positiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 1440 ? parsed : fallback;
  }
}
