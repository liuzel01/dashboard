import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CentralDatabaseService } from '../site-monitor/central-database.service';
import { SITE_CONF_DEFAULTS, SITE_CONF_DEFAULTS_BY_KEY, SiteConfValueType } from './site-conf.defaults';

type SiteConfRow = {
  id: number;
  conf_key: string;
  conf_value: string | null;
  value_type: SiteConfValueType;
  category: string | null;
  description: string | null;
  is_sensitive: number;
  is_runtime_editable: number;
  default_value: string | null;
  validation_json: string | null;
  created_at: string;
  updated_at: string;
};

type SiteConfItem = {
  id: number;
  confKey: string;
  confValue: string;
  valueType: SiteConfValueType;
  category?: string;
  description?: string;
  isSensitive: boolean;
  isRuntimeEditable: boolean;
  defaultValue?: string;
  validationJson?: string;
  createdAt?: string;
  updatedAt?: string;
};

@Injectable()
export class SiteConfService implements OnModuleInit {
  private readonly logger = new Logger(SiteConfService.name);
  private readonly cacheTtlMs = Number(process.env.SITECONF_CACHE_TTL_MS || 30_000);
  private cache = new Map<string, SiteConfItem>();
  private cacheLoadedAt = 0;
  private available = false;

  constructor(private readonly db: CentralDatabaseService) {}

  async onModuleInit() {
    await this.ensureTableAndDefaults().catch((e) => {
      this.available = false;
      this.logger.warn(`dashboard_site_conf init failed: ${e?.message || e}. Falling back to env/defaults.`);
    });
  }

  async list(query: { page: number; size: number; keyword?: string; category?: string }) {
    await this.ensureTableAndDefaults();
    const where: string[] = [];
    const params: any[] = [];
    if (query.keyword?.trim()) {
      where.push('(conf_key LIKE ? OR description LIKE ?)');
      const like = `%${query.keyword.trim()}%`;
      params.push(like, like);
    }
    if (query.category?.trim()) {
      where.push('category = ?');
      params.push(query.category.trim());
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRows = await this.db.query<{ total: number }[]>(`SELECT COUNT(*) AS total FROM dashboard_site_conf ${whereSql}`, params);
    const total = Number(countRows?.[0]?.total || 0);
    const offset = (query.page - 1) * query.size;
    const rows = await this.db.query<SiteConfRow[]>(
      `SELECT * FROM dashboard_site_conf ${whereSql} ORDER BY category, conf_key LIMIT ? OFFSET ?`,
      [...params, query.size, offset],
    );
    return { page: query.page, size: query.size, total, list: rows.map((row) => this.mapRow(row)) };
  }

  async categories() {
    await this.ensureTableAndDefaults();
    const rows = await this.db.query<{ category: string }[]>(
      'SELECT DISTINCT category FROM dashboard_site_conf WHERE category IS NOT NULL AND category <> "" ORDER BY category',
    );
    return rows.map((r) => r.category);
  }

  async upsert(input: {
    confKey: string;
    confValue: string;
    valueType: SiteConfValueType;
    category?: string;
    description?: string;
    isSensitive?: boolean;
    isRuntimeEditable?: boolean;
    defaultValue?: string;
    validationJson?: string;
  }) {
    await this.ensureTableAndDefaults();
    const confKey = input.confKey.trim();
    if (!confKey) throw new BadRequestException('confKey is required');
    this.validateValue(input.confValue, input.valueType, input.validationJson);
    if (input.validationJson?.trim()) {
      try { JSON.parse(input.validationJson); } catch { throw new BadRequestException('validationJson must be valid JSON'); }
    }
    await this.db.query(
      `INSERT INTO dashboard_site_conf
        (conf_key, conf_value, value_type, category, description, is_sensitive, is_runtime_editable, default_value, validation_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
        conf_value = VALUES(conf_value),
        value_type = VALUES(value_type),
        category = VALUES(category),
        description = VALUES(description),
        is_sensitive = VALUES(is_sensitive),
        is_runtime_editable = VALUES(is_runtime_editable),
        default_value = VALUES(default_value),
        validation_json = VALUES(validation_json),
        updated_at = UTC_TIMESTAMP()`,
      [
        confKey,
        input.confValue,
        input.valueType,
        input.category || null,
        input.description || null,
        input.isSensitive ? 1 : 0,
        input.isRuntimeEditable === false ? 0 : 1,
        input.defaultValue ?? null,
        input.validationJson || null,
      ],
    );
    await this.refreshCache();
    return { ok: true };
  }

  async remove(confKey: string) {
    const normalizedKey = decodeURIComponent(confKey).trim();
    if (!normalizedKey) throw new BadRequestException('confKey is required');

    await this.ensureTableAndDefaults();
    const result = await this.db.query<any>(
      'DELETE FROM dashboard_site_conf WHERE conf_key = ?',
      [normalizedKey],
    );
    const affectedRows = Number(result?.affectedRows || 0);
    this.cache.delete(normalizedKey);
    return { ok: true, deleted: affectedRows, confKey: normalizedKey };
  }

  async getString(key: string, defaultValue = ''): Promise<string> {
    const raw = await this.getRaw(key, defaultValue);
    return raw === undefined || raw === null ? defaultValue : String(raw);
  }

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const raw = await this.getRaw(key, String(defaultValue));
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const raw = String(await this.getRaw(key, String(defaultValue))).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(raw)) return false;
    return defaultValue;
  }

  async getJson<T>(key: string, defaultValue: T): Promise<T> {
    const raw = await this.getRaw(key, JSON.stringify(defaultValue));
    if (raw === undefined || raw === null || String(raw).trim() === '') return defaultValue;
    try { return JSON.parse(String(raw)) as T; } catch { return defaultValue; }
  }

  /**
   * Values exposed to unauthenticated browser bootstrap requests must stay on
   * this explicit whitelist. Never return list() output from a public route.
   */
  async getPublicRuntimeConfig() {
    return {
      socketUrl: this.normalizePublicHttpUrl(await this.getString('frontend.logs.socket_url', '')),
    };
  }

  private async getRaw(key: string, explicitDefault?: string): Promise<string | undefined> {
    const item = await this.getCachedItem(key);
    if (item?.confValue !== undefined && item.confValue !== null && item.confValue !== '') return item.confValue;
    const def = SITE_CONF_DEFAULTS_BY_KEY.get(key);
    if (def?.envKey && process.env[def.envKey] !== undefined) return process.env[def.envKey];
    if (explicitDefault !== undefined) return explicitDefault;
    return def?.defaultValue;
  }

  private async getCachedItem(key: string) {
    if (!this.available) {
      const def = SITE_CONF_DEFAULTS_BY_KEY.get(key);
      return def ? this.defaultToItem(def) : undefined;
    }
    if (Date.now() - this.cacheLoadedAt > this.cacheTtlMs) {
      await this.refreshCache().catch((e) => this.logger.warn(`refresh siteconf cache failed: ${e?.message || e}`));
    }
    return this.cache.get(key);
  }

  private async refreshCache() {
    if (!this.available) return;
    const rows = await this.db.query<SiteConfRow[]>('SELECT * FROM dashboard_site_conf');
    this.cache = new Map(rows.map((row) => {
      const item = this.mapRow(row);
      return [item.confKey, item];
    }));
    this.cacheLoadedAt = Date.now();
  }

  private async ensureTableAndDefaults() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS dashboard_site_conf (
      id BIGINT NOT NULL AUTO_INCREMENT,
      conf_key VARCHAR(128) NOT NULL,
      conf_value TEXT NULL,
      value_type VARCHAR(32) NOT NULL DEFAULT 'string',
      category VARCHAR(64) NULL,
      description VARCHAR(512) NULL,
      is_sensitive TINYINT(1) NOT NULL DEFAULT 0,
      is_runtime_editable TINYINT(1) NOT NULL DEFAULT 1,
      default_value TEXT NULL,
      validation_json JSON NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_dashboard_site_conf_key (conf_key),
      KEY idx_dashboard_site_conf_category (category)
    )`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS dashboard_site_conf_meta (
      meta_key VARCHAR(128) NOT NULL,
      meta_value VARCHAR(255) NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (meta_key)
    )`);
    this.available = true;

    // Defaults are seed data, not undeletable records. The old implementation reinserted
    // every default on each list/read request, making a successful DELETE appear to fail.
    const seededRows = await this.db.query<Array<{ meta_value: string }>>(
      'SELECT meta_value FROM dashboard_site_conf_meta WHERE meta_key = ?',
      ['defaults_seeded_v1'],
    );
    if (seededRows.length === 0) {
      const rows = await this.db.query<Array<{ total: number }>>('SELECT COUNT(*) AS total FROM dashboard_site_conf');
      if (Number(rows[0]?.total || 0) === 0) {
        for (const item of SITE_CONF_DEFAULTS) {
          const envValue = item.envKey ? process.env[item.envKey] : undefined;
          await this.db.query(
            `INSERT INTO dashboard_site_conf
              (conf_key, conf_value, value_type, category, description, is_sensitive, is_runtime_editable, default_value, validation_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
            [
              item.key,
              envValue ?? item.defaultValue ?? '',
              item.valueType,
              item.category,
              item.description,
              item.sensitive ? 1 : 0,
              item.runtimeEditable === false ? 0 : 1,
              item.defaultValue ?? null,
              item.validation ? JSON.stringify(item.validation) : null,
            ],
          );
        }
      }
      await this.db.query(
        `INSERT IGNORE INTO dashboard_site_conf_meta (meta_key, meta_value, created_at, updated_at)
         VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        ['defaults_seeded_v1', '1'],
      );
    }
    await this.seedRuntimeConfigDefaults();
    await this.refreshCache();
  }

  private async seedRuntimeConfigDefaults() {
    // Existing installations have already completed defaults_seeded_v1. Seed
    // newly introduced runtime entries separately without recreating defaults
    // an administrator deliberately deleted.
    const metaKey = 'runtime_config_defaults_v1';
    const seededRows = await this.db.query<Array<{ meta_value: string }>>(
      'SELECT meta_value FROM dashboard_site_conf_meta WHERE meta_key = ?',
      [metaKey],
    );
    if (seededRows.length > 0) return;

    const item = SITE_CONF_DEFAULTS_BY_KEY.get('frontend.logs.socket_url');
    if (item) {
      await this.db.query(
        `INSERT IGNORE INTO dashboard_site_conf
          (conf_key, conf_value, value_type, category, description, is_sensitive, is_runtime_editable, default_value, validation_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [
          item.key,
          item.defaultValue ?? '',
          item.valueType,
          item.category,
          item.description,
          item.sensitive ? 1 : 0,
          item.runtimeEditable === false ? 0 : 1,
          item.defaultValue ?? null,
          item.validation ? JSON.stringify(item.validation) : null,
        ],
      );
    }
    await this.db.query(
      `INSERT IGNORE INTO dashboard_site_conf_meta (meta_key, meta_value, created_at, updated_at)
       VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [metaKey, '1'],
    );
  }

  private normalizePublicHttpUrl(value: string): string {
    const raw = value.trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      return url.toString().replace(/\/$/, '');
    } catch {
      this.logger.warn('Ignoring invalid frontend.logs.socket_url siteconf value');
      return '';
    }
  }

  private validateValue(value: string, type: SiteConfValueType, validationJson?: string) {
    if (type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new BadRequestException('confValue must be a valid number');
      if (validationJson?.trim()) {
        const rules = JSON.parse(validationJson);
        if (rules.min !== undefined && n < Number(rules.min)) throw new BadRequestException(`confValue must be >= ${rules.min}`);
        if (rules.max !== undefined && n > Number(rules.max)) throw new BadRequestException(`confValue must be <= ${rules.max}`);
      }
    }
    if (type === 'boolean' && !['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(String(value).trim().toLowerCase())) {
      throw new BadRequestException('confValue must be a valid boolean');
    }
    if (type === 'json') {
      try { JSON.parse(value); } catch { throw new BadRequestException('confValue must be valid JSON'); }
    }
    if (validationJson?.trim()) {
      const rules = JSON.parse(validationJson);
      if (Array.isArray(rules.enum) && rules.enum.length > 0 && !rules.enum.map(String).includes(String(value))) {
        throw new BadRequestException(`confValue must be one of: ${rules.enum.join(', ')}`);
      }
    }
  }

  private mapRow(row: SiteConfRow): SiteConfItem {
    return {
      id: row.id,
      confKey: row.conf_key,
      confValue: row.conf_value ?? '',
      valueType: row.value_type,
      category: row.category || undefined,
      description: row.description || undefined,
      isSensitive: Number(row.is_sensitive || 0) === 1,
      isRuntimeEditable: Number(row.is_runtime_editable || 0) === 1,
      defaultValue: row.default_value ?? undefined,
      validationJson: row.validation_json ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private defaultToItem(item: (typeof SITE_CONF_DEFAULTS)[number]): SiteConfItem {
    return {
      id: 0,
      confKey: item.key,
      confValue: (item.envKey ? process.env[item.envKey] : undefined) ?? item.defaultValue ?? '',
      valueType: item.valueType,
      category: item.category,
      description: item.description,
      isSensitive: item.sensitive === true,
      isRuntimeEditable: item.runtimeEditable !== false,
      defaultValue: item.defaultValue,
      validationJson: item.validation ? JSON.stringify(item.validation) : undefined,
    };
  }
}
