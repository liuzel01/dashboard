import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import axios from 'axios';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import { DependencyProviderHealthService, ProviderCheckResult } from './dependency-provider-health.service';

export type DependencyTarget = {
  key: string;
  name: string;
  environmentId: string;
  category: string;
  url: string;
  module?: string;
  providerProfile?: string | null;
};

export type DependencyProbeResult = DependencyTarget & {
  healthy: boolean;
  httpStatus: number | null;
  durationMs: number | null;
  tlsExpiresAt: string | null;
  errorType: 'NONE' | 'NETWORK' | 'HTTP_STATUS' | 'PROBE_ERROR';
  checkedAt: string;
  overallStatus?: 'HEALTHY' | 'REACHABLE' | 'UNAVAILABLE' | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'BUSINESS_FAILED' | 'NOT_CONFIGURED' | 'CHECKING' | 'STALE';
  verificationDepth?: 'L1' | 'L2' | 'L3';
  layers?: { L1: DependencyLayerResult; L2?: ProviderCheckResult; L3?: ProviderCheckResult };
};

export type DependencyLayerResult = {
  status: 'PASS' | 'FAIL';
  reasonCode: string;
  summary: string;
  durationMs: number | null;
  checkedAt: string;
};

type DependencyHealthSnapshot = {
  checkedAt: string;
  summary: { total: number; healthy: number; unhealthy: number; checking?: number };
  items: DependencyProbeResult[];
};

@Injectable()
export class DependencyHealthService implements OnModuleInit {
  private snapshot: DependencyHealthSnapshot | null = null;
  private snapshotStoredAt = 0;
  private refreshInFlight: Promise<DependencyHealthSnapshot> | null = null;

  private backgroundRunning = false;

  constructor(private readonly siteConf: SiteConfService, private readonly providers: DependencyProviderHealthService, private readonly db: PlatformDatabaseService) {}

  onModuleInit() { setTimeout(() => void this.backgroundRefresh(), 5_000); }

  @Interval(60_000)
  async backgroundRefresh() {
    if (this.backgroundRunning) return;
    this.backgroundRunning = true;
    try { await this.refreshOnce(); } catch { /* next interval retries; the API keeps its last successful snapshot */ } finally { this.backgroundRunning = false; }
  }

  async targets(includeDisabled = true) {
    const rows = await this.db.query<any[]>(
      `SELECT target_key,name,environment_id,category,url,probe_module,provider_profile,enabled,sort_order,updated_at FROM dependency_health_targets ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY sort_order,target_key`,
    );
    return rows.map((row) => ({ key: row.target_key, name: row.name, environmentId: row.environment_id, category: row.category, url: row.url, module: row.probe_module, providerProfile: row.provider_profile || null, enabled: !!row.enabled, sortOrder: Number(row.sort_order), updatedAt: row.updated_at }));
  }

  async providerProfiles() { return this.providers.profiles(); }

  async providerProfileRecords() { return this.providers.profileRecords(); }
  async saveProviderProfile(id: string | null, input: unknown) { return this.providers.saveProfile(id, input); }
  async deleteProviderProfile(id: string) { return this.providers.deleteProfile(id); }
  providerTypes() { return this.providers.providerTypes(); }

  async siteConfReferences() { return this.siteConf.references(); }

  async saveTarget(key: string | null, input: unknown) {
    const value = input as Record<string, unknown>;
    const target = this.validateTargets([{ ...value, key: key || value?.key }])[0];
    const enabled = value?.enabled !== false;
    const sortOrder = Math.max(0, Math.min(100000, Number(value?.sortOrder) || 0));
    if (key) {
      const result: any = await this.db.query(
        `UPDATE dependency_health_targets SET name=?,environment_id=?,category=?,url=?,probe_module=?,provider_profile=?,enabled=?,sort_order=? WHERE target_key=?`,
        [target.name, target.environmentId, target.category, target.url, target.module, target.providerProfile || null, enabled ? 1 : 0, sortOrder, key],
      );
      if (!Number(result.affectedRows)) throw new BadRequestException('Dependency target not found');
    } else {
      await this.db.query(
        `INSERT INTO dependency_health_targets (target_key,name,environment_id,category,url,probe_module,provider_profile,enabled,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
        [target.key, target.name, target.environmentId, target.category, target.url, target.module, target.providerProfile || null, enabled ? 1 : 0, sortOrder],
      );
    }
    this.snapshot = null;
    return target;
  }

  async deleteTarget(key: string) {
    const result: any = await this.db.query(`DELETE FROM dependency_health_targets WHERE target_key=?`, [key]);
    if (!Number(result.affectedRows)) throw new BadRequestException('Dependency target not found');
    this.snapshot = null;
    return { deleted: true };
  }

  async verifyTarget(key: string) {
    const rows = await this.db.query<any[]>(
      `SELECT target_key,name,environment_id,category,url,probe_module,provider_profile FROM dependency_health_targets WHERE target_key=? AND enabled=1`,
      [key],
    );
    if (!rows[0]) throw new BadRequestException('Dependency target not found or disabled');
    const row = rows[0];
    const target = this.validateTargets([{
      key: row.target_key, name: row.name, environmentId: row.environment_id, category: row.category,
      url: row.url, module: row.probe_module, providerProfile: row.provider_profile,
    }])[0];
    const baseUrl = (await this.siteConf.getString('dependency_health.blackbox_base_url', 'http://127.0.0.1:9115')).trim().replace(/\/+$/, '');
    const timeoutMs = await this.siteConf.getNumber('dependency_health.timeout_ms', 12_000);
    const l1 = await this.probe(target, baseUrl, timeoutMs);
    await this.db.query(
      `INSERT INTO dependency_health_history (target_key,layer,status,reason_code,duration_ms,checked_at) VALUES (?,'L1',?,?,?,?)`,
      [l1.key, l1.healthy ? 'PASS' : 'FAIL', l1.errorType, l1.durationMs, l1.checkedAt.slice(0, 23).replace('T', ' ')],
    ).catch(() => undefined);
    const provider = target.providerProfile ? await this.providers.verifyTarget(target.key) : [];
    this.snapshot = null;
    return { targetKey: target.key, l1, provider };
  }

  async history(targetKey: string, hours = 24) {
    const safeHours = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
    const [points, availability, events] = await Promise.all([
      this.db.query<any[]>(`SELECT layer,status,reason_code,duration_ms,checked_at FROM dependency_health_history WHERE target_key=? AND checked_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? HOUR) ORDER BY checked_at ASC LIMIT 5000`, [targetKey, safeHours]),
      this.db.query<any[]>(`SELECT layer,COUNT(*) total,SUM(status='PASS') passed FROM dependency_health_history WHERE target_key=? AND checked_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? HOUR) GROUP BY layer`, [targetKey, safeHours]),
      this.db.query<any[]>(`SELECT layer,event_type,reason_code,summary,created_at FROM dependency_health_alert_events WHERE target_key=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? HOUR) ORDER BY id DESC LIMIT 100`, [targetKey, safeHours]),
    ]);
    return {
      targetKey, hours: safeHours,
      availability: availability.map((row) => ({ layer: row.layer, total: Number(row.total), passed: Number(row.passed), percentage: Number(row.total) ? Number((Number(row.passed) * 100 / Number(row.total)).toFixed(2)) : null })),
      points: points.map((row) => ({ layer: row.layer, status: row.status, reasonCode: row.reason_code, durationMs: row.duration_ms === null ? null : Number(row.duration_ms), checkedAt: String(row.checked_at).replace(' ', 'T') + 'Z' })),
      events: events.map((row) => ({ layer: row.layer, eventType: row.event_type, reasonCode: row.reason_code, summary: row.summary, createdAt: String(row.created_at).replace(' ', 'T') + 'Z' })),
    };
  }

  async list(options: { force?: boolean } = {}) {
    const now = Date.now();
    const cacheTtlMs = await this.siteConf.getNumber('dependency_health.cache_ttl_ms', 55_000);
    const cacheAgeMs = this.snapshot ? Math.max(0, now - this.snapshotStoredAt) : null;
    const forceAllowed = options.force && (cacheAgeMs === null || cacheAgeMs >= 5_000);
    if (this.snapshot && !forceAllowed && cacheAgeMs !== null && cacheAgeMs < cacheTtlMs) {
      return this.decorate(this.snapshot, { cached: true, stale: false, cacheAgeMs });
    }

    const joinedExistingRefresh = Boolean(this.refreshInFlight);
    try {
      const snapshot = await this.refreshOnce();
      return this.decorate(snapshot, {
        cached: joinedExistingRefresh,
        stale: false,
        cacheAgeMs: Math.max(0, Date.now() - this.snapshotStoredAt),
      });
    } catch (error) {
      if (this.snapshot) {
        return this.decorate(this.snapshot, {
          cached: true,
          stale: true,
          cacheAgeMs: Math.max(0, Date.now() - this.snapshotStoredAt),
        });
      }
      throw error;
    }
  }

  private async decorate(snapshot: DependencyHealthSnapshot, cache: { cached: boolean; stale: boolean; cacheAgeMs: number }) {
    const [providerResults, providerTargetKeys, l2IntervalMs, l3IntervalMs] = await Promise.all([
      this.providers.latest(),
      this.providers.targetKeys(),
      this.siteConf.getNumber('dependency_health.l2_interval_ms', 300_000),
      this.siteConf.getNumber('dependency_health.l3_interval_ms', 900_000),
    ]);
    const isStale = (result: ProviderCheckResult | undefined, intervalMs: number) => Boolean(result && Date.now() - new Date(result.checkedAt).getTime() > Math.max(120_000, intervalMs * 2));
    const items = snapshot.items.map((item) => {
      const verificationDepth = providerTargetKeys.has(item.key) ? 'L3' : 'L1';
      const provider = providerResults.get(item.key) || {};
      const l1: DependencyLayerResult = {
        status: item.healthy ? 'PASS' : 'FAIL', reasonCode: item.errorType,
        summary: item.healthy ? (item.module === 'http_reachable' ? '网络与 HTTP 服务可达' : 'HTTP 2xx 响应正常') : '网络、TLS 或 HTTP 探测失败',
        durationMs: item.durationMs, checkedAt: item.checkedAt,
      };
      let overallStatus: NonNullable<DependencyProbeResult['overallStatus']> = item.healthy
        ? item.module === 'http_reachable' ? 'REACHABLE' : 'HEALTHY'
        : 'UNAVAILABLE';
      if (item.healthy && verificationDepth !== 'L1') {
        if (!provider.L2) overallStatus = 'CHECKING';
        else if (isStale(provider.L2, l2IntervalMs)) overallStatus = 'STALE';
        else if (provider.L2.status === 'NOT_CONFIGURED') overallStatus = 'NOT_CONFIGURED';
        else if (provider.L2.status === 'FAIL') overallStatus = provider.L2.reasonCode === 'AUTH_FAILED'
          ? 'AUTH_FAILED' : provider.L2.reasonCode === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : 'UNAVAILABLE';
        else if (provider.L2.status !== 'PASS') overallStatus = 'CHECKING';
        else if (!provider.L3) overallStatus = 'CHECKING';
        else if (isStale(provider.L3, l3IntervalMs)) overallStatus = 'STALE';
        else if (provider.L3.status === 'NOT_CONFIGURED') overallStatus = 'NOT_CONFIGURED';
        else if (provider.L3.status === 'FAIL') overallStatus = 'BUSINESS_FAILED';
        else if (provider.L3.status === 'PASS') overallStatus = 'HEALTHY';
        else overallStatus = 'CHECKING';
      }
      return {
        ...item, healthy: ['HEALTHY', 'REACHABLE'].includes(overallStatus), overallStatus, verificationDepth,
        layers: { L1: l1, ...(provider.L2 ? { L2: provider.L2 } : {}), ...(provider.L3 ? { L3: provider.L3 } : {}) },
      };
    });
    return {
      ...snapshot, ...cache,
      summary: {
        total: items.length,
        healthy: items.filter((item) => item.healthy).length,
        unhealthy: items.filter((item) => !item.healthy && item.overallStatus !== 'CHECKING').length,
        checking: items.filter((item) => item.overallStatus === 'CHECKING').length,
      },
      items,
    };
  }

  private refreshOnce() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.collectSnapshot()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.snapshotStoredAt = Date.now();
        return snapshot;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private async collectSnapshot(): Promise<DependencyHealthSnapshot> {
    let targets: DependencyTarget[];
    try { targets = (await this.targets(false)).map(({ enabled: _enabled, sortOrder: _sortOrder, updatedAt: _updatedAt, ...target }: any) => target); }
    catch { targets = this.validateTargets(await this.siteConf.getJson<unknown>('dependency_health.targets_json', [])); }
    const baseUrl = (await this.siteConf.getString('dependency_health.blackbox_base_url', 'http://127.0.0.1:9115')).trim().replace(/\/+$/, '');
    const parsedBase = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password) {
      throw new Error('invalid blackbox base URL');
    }
    const timeoutMs = await this.siteConf.getNumber('dependency_health.timeout_ms', 12_000);
    const results = await Promise.all(targets.map((target) => this.probe(target, baseUrl, timeoutMs)));
    await Promise.all(results.map((item) => this.db.query(
      `INSERT INTO dependency_health_history (target_key,layer,status,reason_code,duration_ms,checked_at) VALUES (?,'L1',?,?,?,?)`,
      [item.key, item.healthy ? 'PASS' : 'FAIL', item.errorType, item.durationMs, item.checkedAt.slice(0, 23).replace('T', ' ')],
    ).catch(() => undefined)));
    return {
      checkedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        healthy: results.filter((item) => item.healthy).length,
        unhealthy: results.filter((item) => !item.healthy).length,
      },
      items: results,
    };
  }

  private validateTargets(input: unknown): DependencyTarget[] {
    if (!Array.isArray(input)) throw new BadRequestException('dependency_health.targets_json must be an array');
    if (input.length > 50) throw new BadRequestException('dependency health target count exceeds 50');
    const keys = new Set<string>();
    return input.map((raw, index) => {
      const value = raw as Record<string, unknown>;
      const target: DependencyTarget = {
        key: String(value?.key || '').trim(),
        name: String(value?.name || '').trim(),
        environmentId: String(value?.environmentId || '').trim(),
        category: String(value?.category || 'external-api').trim(),
        url: String(value?.url || '').trim(),
        module: String(value?.module || 'http_2xx').trim(),
        providerProfile: value?.providerProfile ? String(value.providerProfile).trim() : null,
      };
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(target.key)) throw new BadRequestException(`dependency target ${index} has invalid key`);
      if (keys.has(target.key)) throw new BadRequestException(`duplicate dependency target key: ${target.key}`);
      keys.add(target.key);
      if (!target.name || target.name.length > 100) throw new BadRequestException(`dependency target ${target.key} has invalid name`);
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target.environmentId) && target.environmentId !== 'global') {
        throw new BadRequestException(`dependency target ${target.key} has invalid environmentId`);
      }
      if (!['http_2xx', 'http_reachable'].includes(target.module || '')) {
        throw new BadRequestException(`dependency target ${target.key} uses unsupported module`);
      }
      let parsed: URL;
      try { parsed = new URL(target.url); } catch { throw new BadRequestException(`dependency target ${target.key} has invalid URL`); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new BadRequestException(`dependency target ${target.key} URL is not allowed`);
      }
      return target;
    });
  }

  private async probe(target: DependencyTarget, baseUrl: string, timeoutMs: number): Promise<DependencyProbeResult> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await axios.get<string>(`${baseUrl}/probe`, {
        params: { module: target.module || 'http_2xx', target: target.url },
        timeout: timeoutMs,
        responseType: 'text',
      });
      const metric = (name: string) => {
        const match = String(response.data).match(new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([^\\s]+)$`, 'm'));
        return match ? Number(match[1]) : null;
      };
      const success = metric('probe_success') === 1;
      const status = metric('probe_http_status_code');
      const duration = metric('probe_duration_seconds');
      const tlsExpiry = metric('probe_ssl_earliest_cert_expiry');
      return {
        ...target,
        healthy: success,
        httpStatus: status && status > 0 ? status : null,
        durationMs: duration === null ? null : Math.round(duration * 1000),
        tlsExpiresAt: tlsExpiry && tlsExpiry > 0 ? new Date(tlsExpiry * 1000).toISOString() : null,
        errorType: success ? 'NONE' : status && status > 0 ? 'HTTP_STATUS' : 'NETWORK',
        checkedAt,
      };
    } catch {
      return { ...target, healthy: false, httpStatus: null, durationMs: null, tlsExpiresAt: null, errorType: 'PROBE_ERROR', checkedAt };
    }
  }
}
