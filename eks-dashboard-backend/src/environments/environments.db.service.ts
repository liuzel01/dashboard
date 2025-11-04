import { Injectable, Logger } from '@nestjs/common';
import { CentralDatabaseService } from '../site-monitor/central-database.service';

@Injectable()
export class EnvironmentsDbService {
  private readonly logger = new Logger(EnvironmentsDbService.name);
  private _availableChecked = false;
  private _available = false;

  constructor(private readonly db: CentralDatabaseService) {}

  private async ensureAvailable() {
    if (this._availableChecked) return this._available;
    this._availableChecked = true;
    try {
      await this.db.query('SELECT 1 FROM environments_meta LIMIT 1');
      this._available = true;
    } catch (e) {
      this.logger.warn('environments_meta not found in DB, fallback to JSON file.');
      this._available = false;
    }
    return this._available;
  }

  async isAvailable() {
    return this.ensureAvailable();
  }

  async getEnvironments(): Promise<{ id: string; name: string }[]> {
    if (!(await this.ensureAvailable())) return [];
    const rows = await this.db.query<{ environment_id: string; name: string }[]>(
      'SELECT environment_id, name FROM environments_meta ORDER BY environment_id',
    );
    return rows.map((r) => ({ id: r.environment_id, name: r.name }));
  }

  async getTenantsForEnvironment(environmentId: string): Promise<{ id: number; name: string }[]> {
    if (!(await this.ensureAvailable())) return [];
    const rows = await this.db.query<{ tenant_id: number; name: string }[]>(
      'SELECT tenant_id, name FROM tenants WHERE environment_id = ? ORDER BY tenant_id',
      [environmentId],
    );
    return rows.map((r) => ({ id: r.tenant_id, name: r.name }));
  }
}

