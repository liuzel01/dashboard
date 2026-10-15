import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { BytebaseEventsGateway } from './bytebase-events.gateway';
import { BytebaseService } from './bytebase.service';

@Injectable()
export class BytebaseReconcilerService {
  private readonly logger = new Logger(BytebaseReconcilerService.name);
  private running = false;
  private readonly fingerprints = new Map<string, string>();

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly bytebase: BytebaseService,
    private readonly events: BytebaseEventsGateway,
  ) {}

  @Interval(5_000)
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.withConnection(async (connection) => {
        const [locks] = await connection.query<any[]>(
          "SELECT GET_LOCK('dashboard:bytebase-reconciler', 0) AS acquired",
        );
        if (Number(locks?.[0]?.acquired) !== 1) return;
        try {
          const rows = await this.db.query<any[]>(
            `SELECT request_id FROM bytebase_requests
             WHERE status IN ('RELEASE_CONFIRMED','ROLLOUT_RUNNING','CANCEL_REQUESTED','UNKNOWN')
             ORDER BY updated_at ASC LIMIT 100`,
          );
          for (const row of rows) {
            await this.bytebase
              .reconcileRequest(String(row.request_id))
              .catch((error) =>
                this.logger.warn(
                  `Bytebase reconcile failed request=${row.request_id}: ${error instanceof Error ? error.message : String(error)}`,
                ),
              );
          }
          await this.emitRecentUpdates();
        } finally {
          await connection.query(
            "SELECT RELEASE_LOCK('dashboard:bytebase-reconciler')",
          );
        }
      });
    } catch (error) {
      this.logger.warn(
        `Bytebase reconciler unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async emitRecentUpdates() {
    const rows = await this.db.query<any[]>(
      `SELECT request_id,environment_id,title,status,actor_user_id,actor_username,updated_at
       FROM bytebase_requests WHERE updated_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 20 SECOND)`,
    );
    for (const row of rows) {
      const fingerprint = `${row.status}:${new Date(row.updated_at).getTime()}`;
      if (this.fingerprints.get(row.request_id) === fingerprint) continue;
      this.fingerprints.set(row.request_id, fingerprint);
      this.events.emitRequestUpdated(row);
    }
    if (this.fingerprints.size > 500) this.fingerprints.clear();
  }
}
