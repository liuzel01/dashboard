import { Injectable, Logger } from '@nestjs/common';
import { CentralDatabaseService } from './central-database.service';
import { CreateSiteDto } from './dto/create-site.dto';
import * as dns from 'dns/promises';
import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import * as https from 'https';
import { AlertsService } from './alerts.service';
import { UpdateSiteDto } from './dto/update-site.dto';

type SiteRow = {
  id: number;
  environment_id: string;
  name: string;
  host: string;
  port: number;
  is_https: number;
  tenant_id: number | null;
  environment_label: string | null;
  notes: string | null;
  acceptable_status_codes?: string | null;
  last_checked_at: Date | null;
  dns_ok: number | null;
  resolved_ips: string | null;
  tcp_latency_ms: number | null;
  http_status: number | null;
  ssl_valid: number | null;
  ssl_issuer: string | null;
  ssl_subject: string | null;
  ssl_not_before: Date | null;
  ssl_not_after: Date | null;
  last_error: string | null;
  failure_count?: number | null;
  last_ok_at?: Date | null;
  last_alert_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class SiteMonitorService {
  private readonly logger = new Logger(SiteMonitorService.name);

  constructor(private readonly db: CentralDatabaseService, private readonly alerts: AlertsService) {}

  async listSites(environmentId: string, tenantId?: number): Promise<(SiteRow & { treated_ok?: boolean })[]> {
    let sql = 'SELECT * FROM site_monitors WHERE environment_id = ?';
    const params: any[] = [environmentId];
    if (typeof tenantId === 'number') {
      sql += ' AND tenant_id = ?';
      params.push(tenantId);
    }
    sql += ' ORDER BY id DESC';
    const rows = await this.db.query<SiteRow[]>(sql, params);
    const cfg = await this.alerts.getEnvAlertConfig(environmentId);
    return rows.map((r) => ({
      ...r,
      treated_ok: this.alerts.isAcceptableStatus(r.http_status ?? null, (r as any).acceptable_status_codes || cfg.acceptableStatusCodes || null),
    }));
  }

  async updateSite(environmentId: string, id: number, dto: UpdateSiteDto) {
    const fields: string[] = [];
    const params: any[] = [];
    if (dto.tenantId !== undefined) { fields.push('tenant_id = ?'); params.push(dto.tenantId); }
    if (dto.name !== undefined) { fields.push('name = ?'); params.push(dto.name); }
    if (dto.host !== undefined) { fields.push('host = ?'); params.push(dto.host); }
    if (dto.port !== undefined) { fields.push('port = ?'); params.push(dto.port); }
    if (dto.isHttps !== undefined) { fields.push('is_https = ?'); params.push(dto.isHttps ? 1 : 0); }
    if (dto.notes !== undefined) { fields.push('notes = ?'); params.push(dto.notes); }
    if (dto.acceptableStatusCodes !== undefined) { fields.push('acceptable_status_codes = ?'); params.push(dto.acceptableStatusCodes || null); }
    if (fields.length === 0) return { ok: true };
    const sql = `UPDATE site_monitors SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id = ? AND environment_id = ?`;
    params.push(id, environmentId);
    await this.db.query(sql, params);
    const [updated] = await this.db.query<SiteRow[]>(
      'SELECT * FROM site_monitors WHERE id = ? AND environment_id = ? LIMIT 1',
      [id, environmentId],
    );
    return updated;
  }

  async createSite(environmentId: string, dto: CreateSiteDto) {
    // 支持多个域名，用英文逗号/空白分隔
    const hosts = String(dto.host)
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hosts.length === 0) {
      throw new Error('Host is required');
    }

    if (hosts.length === 1) {
      const sql = `
        INSERT INTO site_monitors
        (environment_id, tenant_id, name, host, port, is_https, environment_label, notes, acceptable_status_codes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
      `;
      const params = [
        environmentId,
        dto.tenantId ?? null,
        dto.name,
        hosts[0],
        dto.port,
        dto.isHttps ? 1 : 0,
        dto.environmentLabel || null,
        dto.notes || null,
        dto.acceptableStatusCodes || null,
      ];
      const result: any = await this.db.query(sql, params);
      return { id: result.insertId };
    }

    // 多域名批量插入
    const valuesSql = hosts.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())').join(',');
    const sql = `INSERT INTO site_monitors
      (environment_id, tenant_id, name, host, port, is_https, environment_label, notes, acceptable_status_codes, created_at, updated_at)
      VALUES ${valuesSql}`;
    const params: any[] = [];
    for (const h of hosts) {
      params.push(
        environmentId,
        dto.tenantId ?? null,
        dto.name,
        h,
        dto.port,
        dto.isHttps ? 1 : 0,
        dto.environmentLabel || null,
        dto.notes || null,
        dto.acceptableStatusCodes || null,
      );
    }
    await this.db.query(sql, params);
    return { ids: [] };
  }

  async getSiteById(environmentId: string, id: number): Promise<SiteRow & { treated_ok?: boolean }> {
    const [site] = await this.db.query<SiteRow[]>(
      'SELECT * FROM site_monitors WHERE id = ? AND environment_id = ? LIMIT 1',
      [id, environmentId],
    );
    if (!site) throw new Error('Site not found');
    const cfg = await this.alerts.getEnvAlertConfig(environmentId);
    return { ...site, treated_ok: this.alerts.isAcceptableStatus(site.http_status ?? null, (site as any).acceptable_status_codes || cfg.acceptableStatusCodes || null) } as any;
  }

  async deleteSite(environmentId: string, id: number) {
    await this.db.query('DELETE FROM site_monitors WHERE id = ? AND environment_id = ?', [id, environmentId]);
    return { ok: true };
  }

  async checkSite(environmentId: string, id: number): Promise<SiteRow & { treated_ok?: boolean }> {
    const [site] = await this.db.query<SiteRow[]>(
      'SELECT * FROM site_monitors WHERE id = ? AND environment_id = ? LIMIT 1',
      [id, environmentId],
    );
    if (!site) throw new Error('Site not found');

    let dnsOk = 0;
    let resolvedIps: string | null = null;
    let tcpLatency: number | null = null;
  let httpStatus: number | null = null;
    let sslValid: number | null = null;
    let sslIssuer: string | null = null;
    let sslSubject: string | null = null;
    let sslNotBefore: Date | null = null;
    let sslNotAfter: Date | null = null;
    let lastError: string | null = null;

    const cfg = await this.alerts.getEnvAlertConfig(environmentId);
    try {
      const httpTimeout = cfg.probeTimeoutMs ?? 5000;
      const tcpTimeout = cfg.probeTimeoutMs ?? 5000;
      // DNS
      try {
        const a = await dns.lookup(site.host, { all: true });
        if (a && a.length > 0) {
          dnsOk = 1;
          resolvedIps = a.map((x) => x.address).join(',');
        }
      } catch (e: any) {
        dnsOk = 0;
        lastError = `DNS: ${e?.message || e}`;
      }

      // TCP latency (SYN time)
      try {
        const start = Date.now();
        await new Promise<void>((resolve, reject) => {
          const socket = new net.Socket();
          const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('TCP connect timeout'));
          }, tcpTimeout);
          socket.once('error', (err) => {
            clearTimeout(timer);
            socket.destroy();
            reject(err);
          });
          socket.connect(site.port, site.host, () => {
            clearTimeout(timer);
            tcpLatency = Date.now() - start;
            socket.end();
            resolve();
          });
        });
      } catch (e: any) {
        lastError = lastError ? `${lastError}; TCP: ${e?.message || e}` : `TCP: ${e?.message || e}`;
      }

      // SSL cert (for HTTPS only)
      if (site.is_https) {
        try {
          const certInfo = await this.fetchCert(site.host, site.port || 443);
          sslValid = certInfo.valid ? 1 : 0;
          sslIssuer = certInfo.issuer;
          sslSubject = certInfo.subject;
          sslNotBefore = certInfo.notBefore || null;
          sslNotAfter = certInfo.notAfter || null;
        } catch (e: any) {
          sslValid = 0;
          lastError = lastError ? `${lastError}; SSL: ${e?.message || e}` : `SSL: ${e?.message || e}`;
        }
      }

      // HTTP status — GET / with small timeout and early abort on first data
      try {
        const primary = await this.httpProbe(!!site.is_https, site.host, site.port || (site.is_https ? 443 : 80), httpTimeout);
        httpStatus = primary.statusCode ?? null;
      } catch (e1: any) {
        lastError = lastError ? `${lastError}; HTTP(primary): ${e1?.message || e1}` : `HTTP(primary): ${e1?.message || e1}`;
        // try alternate scheme/port: if primary was HTTP(80), try HTTPS(443); if primary was HTTPS, try HTTP(80)
        try {
          const alt = await this.httpProbe(!site.is_https, site.host, site.is_https ? 80 : 443, httpTimeout);
          httpStatus = alt.statusCode ?? null;
        } catch (e2: any) {
          lastError = `${lastError}; HTTP(alt): ${e2?.message || e2}`;
          httpStatus = 0; // mark explicitly unavailable rather than null
        }
      }
    } finally {
      // persist results
      // compute failure count using acceptable status codes (site > env > default)
      const treatedOk = !!httpStatus && this.alerts.isAcceptableStatus(httpStatus, site.acceptable_status_codes || cfg.acceptableStatusCodes || '');
      const nextFailureCount = treatedOk ? 0 : ((site.failure_count ?? 0) + 1);

      await this.db.query(
        `UPDATE site_monitors
         SET last_checked_at = UTC_TIMESTAMP(), dns_ok = ?, resolved_ips = ?, tcp_latency_ms = ?, http_status = ?,
             ssl_valid = ?, ssl_issuer = ?, ssl_subject = ?, ssl_not_before = ?, ssl_not_after = ?, last_error = ?, updated_at = UTC_TIMESTAMP()
             , failure_count = ?, last_ok_at = CASE WHEN ? THEN UTC_TIMESTAMP() ELSE last_ok_at END
         WHERE id = ? AND environment_id = ?`,
        [
          dnsOk,
          resolvedIps,
          tcpLatency,
          httpStatus,
          sslValid,
          sslIssuer,
          sslSubject,
          sslNotBefore,
          sslNotAfter,
          lastError,
          nextFailureCount,
          treatedOk ? 1 : 0,
          id,
          environmentId,
        ],
      );
    }

    const [updated] = await this.db.query<SiteRow[]>(
      'SELECT * FROM site_monitors WHERE id = ? AND environment_id = ? LIMIT 1',
      [id, environmentId],
    );
    return { ...updated, treated_ok: this.alerts.isAcceptableStatus(updated.http_status ?? null, (updated as any).acceptable_status_codes || cfg.acceptableStatusCodes || null) } as any;
  }

  private fetchCert(host: string, port = 443): Promise<{
    valid: boolean;
    issuer: string | null;
    subject: string | null;
    notBefore?: Date;
    notAfter?: Date;
  }> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false, timeout: 5000 },
        () => {
          try {
            const cert: any = socket.getPeerCertificate();
            const notBefore = cert?.valid_from ? new Date(cert.valid_from) : undefined;
            const notAfter = cert?.valid_to ? new Date(cert.valid_to) : undefined;
            const valid = !!notAfter && notAfter.getTime() > Date.now();
            resolve({
              valid,
              issuer: cert?.issuer?.O || cert?.issuer?.CN || null,
              subject: cert?.subject?.CN || null,
              notBefore,
              notAfter,
            });
          } catch (e) {
            reject(e);
          } finally {
            socket.end();
          }
        },
      );
      socket.on('error', (err) => reject(err));
      socket.setTimeout(5000, () => {
        socket.destroy(new Error('TLS timeout'));
      });
    });
  }

  private httpProbe(isHttps: boolean, host: string, port: number, timeoutMs = 5000): Promise<{ statusCode?: number }> {
    return new Promise((resolve, reject) => {
      const lib = isHttps ? https : http;
      const req = lib.request({ host, port, method: 'GET', path: '/', timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        // close early; we only need status code
        res.resume();
        resolve({ statusCode: res.statusCode });
        req.destroy();
      });
      req.on('timeout', () => {
        req.destroy(new Error('HTTP timeout'));
      });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }
}
