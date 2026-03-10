import { Injectable, Logger } from '@nestjs/common';
import { CentralDatabaseService } from '../site-monitor/central-database.service';

@Injectable()
export class EnvironmentsDbService {
  private readonly logger = new Logger(EnvironmentsDbService.name);
  private _availableChecked = false;
  private _available = false;
  private _configChecked = false;
  private _configAvailable = false;

  constructor(private readonly db: CentralDatabaseService) {}

  private parseJson(value: any) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'object') return value;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

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

  private async ensureConfigAvailable() {
    if (this._configChecked) return this._configAvailable;
    this._configChecked = true;
    try {
      await this.db.query('SELECT 1 FROM environments_config LIMIT 1');
      this._configAvailable = true;
    } catch (e) {
      this.logger.warn('environments_config not found in DB, fallback to JSON file.');
      this._configAvailable = false;
    }
    return this._configAvailable;
  }

  async isAvailable() {
    return this.ensureAvailable();
  }

  async isConfigAvailable() {
    return this.ensureConfigAvailable();
  }

  async getEnvironments(): Promise<{ id: string; name: string }[]> {
    if (!(await this.ensureAvailable())) return [];
    const rows = await this.db.query<{ environment_id: string; name: string }[]>(
      'SELECT environment_id, name FROM environments_meta ORDER BY environment_id',
    );
    return rows.map((r) => ({ id: r.environment_id, name: r.name }));
  }

  async getEnvironmentConfigs(): Promise<any[]> {
    if (!(await this.ensureConfigAvailable())) return [];
    const rows = await this.db.query<any[]>(
      `SELECT environment_id, name, aws_access_key_id, aws_secret_access_key, aws_profile, aws_region,
              kube_context, database_json, redis_json, jump_server_json, tenants_json, platforms_json, alerts_json
       FROM environments_config
       ORDER BY environment_id`,
    );
    return rows.map((row) => ({
      id: row.environment_id,
      name: row.name,
      aws_access_key_id: row.aws_access_key_id || undefined,
      aws_secret_access_key: row.aws_secret_access_key || undefined,
      aws_profile: row.aws_profile || undefined,
      aws_region: row.aws_region,
      kubeContext: row.kube_context || undefined,
      database: this.parseJson(row.database_json),
      redis: this.parseJson(row.redis_json),
      jumpServer: this.parseJson(row.jump_server_json),
      tenants: this.parseJson(row.tenants_json),
      platforms: this.parseJson(row.platforms_json),
      alerts: this.parseJson(row.alerts_json),
    }));
  }

  async getEnvironmentConfigById(environmentId: string): Promise<any | null> {
    if (!(await this.ensureConfigAvailable())) return null;
    const rows = await this.db.query<any[]>(
      `SELECT environment_id, name, aws_access_key_id, aws_secret_access_key, aws_profile, aws_region,
              kube_context, database_json, redis_json, jump_server_json, tenants_json, platforms_json, alerts_json
       FROM environments_config
       WHERE environment_id = ?
       LIMIT 1`,
      [environmentId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.environment_id,
      name: row.name,
      aws_access_key_id: row.aws_access_key_id || undefined,
      aws_secret_access_key: row.aws_secret_access_key || undefined,
      aws_profile: row.aws_profile || undefined,
      aws_region: row.aws_region,
      kubeContext: row.kube_context || undefined,
      database: this.parseJson(row.database_json),
      redis: this.parseJson(row.redis_json),
      jumpServer: this.parseJson(row.jump_server_json),
      tenants: this.parseJson(row.tenants_json),
      platforms: this.parseJson(row.platforms_json),
      alerts: this.parseJson(row.alerts_json),
    };
  }

  async upsertEnvironmentConfig(env: {
    id: string;
    name: string;
    aws_access_key_id?: string;
    aws_secret_access_key?: string;
    aws_profile?: string;
    aws_region?: string;
    kubeContext?: string;
    database?: any;
    redis?: any;
    jumpServer?: any;
    tenants?: any;
    platforms?: any;
    alerts?: any;
  }) {
    if (!(await this.ensureConfigAvailable())) {
      throw new Error('environments_config not available');
    }
    await this.db.query(
      `INSERT INTO environments_config
        (environment_id, name, aws_access_key_id, aws_secret_access_key, aws_profile, aws_region, kube_context,
         database_json, redis_json, jump_server_json, tenants_json, platforms_json, alerts_json, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        aws_access_key_id = VALUES(aws_access_key_id),
        aws_secret_access_key = VALUES(aws_secret_access_key),
        aws_profile = VALUES(aws_profile),
        aws_region = VALUES(aws_region),
        kube_context = VALUES(kube_context),
        database_json = VALUES(database_json),
        redis_json = VALUES(redis_json),
        jump_server_json = VALUES(jump_server_json),
        tenants_json = VALUES(tenants_json),
        platforms_json = VALUES(platforms_json),
        alerts_json = VALUES(alerts_json),
        updated_at = UTC_TIMESTAMP()`,
      [
        env.id,
        env.name,
        env.aws_access_key_id || null,
        env.aws_secret_access_key || null,
        env.aws_profile || null,
        env.aws_region || null,
        env.kubeContext || null,
        env.database ? JSON.stringify(env.database) : null,
        env.redis ? JSON.stringify(env.redis) : null,
        env.jumpServer ? JSON.stringify(env.jumpServer) : null,
        env.tenants ? JSON.stringify(env.tenants) : null,
        env.platforms ? JSON.stringify(env.platforms) : null,
        env.alerts ? JSON.stringify(env.alerts) : null,
      ],
    );
  }

  async upsertEnvironmentMeta(environmentId: string, name: string) {
    if (!(await this.ensureAvailable())) return;
    await this.db.query(
      `INSERT INTO environments_meta (environment_id, name, created_at, updated_at)
       VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP()`,
      [environmentId, name],
    );
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
