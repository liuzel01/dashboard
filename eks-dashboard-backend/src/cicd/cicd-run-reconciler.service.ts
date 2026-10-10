import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { CicdEventsGateway } from './cicd-events.gateway';
import { CicdRunsService } from './cicd-runs.service';

@Injectable()
export class CicdRunReconcilerService {
  private readonly logger = new Logger(CicdRunReconcilerService.name);
  private running = false;
  private readonly fingerprints = new Map<string, string>();

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly runs: CicdRunsService,
    private readonly events: CicdEventsGateway,
  ) {}

  @Interval(5_000)
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.withConnection(async (connection) => {
        const [lockRows] = await connection.query<any[]>(
          "SELECT GET_LOCK('dashboard:cicd-run-reconciler', 0) AS acquired",
        );
        if (Number(lockRows?.[0]?.acquired) !== 1) return;
        try {
          for (const runId of await this.runs.activeRunIds()) {
            await this.runs.refreshInternal(runId).catch((error) =>
              this.logger.warn(`CI/CD reconcile failed run=${runId}: ${error instanceof Error ? error.message : String(error)}`),
            );
          }
          for (const run of await this.runs.recentlyUpdatedRuns()) {
            const runId = String(run.run_id);
            const fingerprint = `${run.status}:${run.updated_at}:${run.build_number || ''}:${run.external_result_tag || ''}`;
            if (this.fingerprints.get(runId) === fingerprint) continue;
            this.fingerprints.set(runId, fingerprint);
            this.events.emitRunUpdated(run);
          }
          if (this.fingerprints.size > 500) this.fingerprints.clear();
        } finally {
          await connection.query("SELECT RELEASE_LOCK('dashboard:cicd-run-reconciler')");
        }
      });
    } catch (error) {
      this.logger.warn(`CI/CD reconciler unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
