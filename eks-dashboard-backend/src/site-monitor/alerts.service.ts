import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { EnvironmentsService } from '../environments/environments.service';
import { CentralDatabaseService } from './central-database.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly envs: EnvironmentsService,
    private readonly db: CentralDatabaseService,
  ) {}

  // Parse acceptable status codes string to a predicate
  // Supports: comma separated numbers (e.g., 200,302) and ranges (200-399)
  parseAcceptablePredicate(spec?: string | null): (code: number) => boolean {
    const s = (spec || '').trim();
    if (!s) {
      // default: 200-399
      return (code: number) => code >= 200 && code < 400;
    }
    try {
      const parts = s.split(/[\s,]+/).filter(Boolean);
      const ranges: Array<[number, number]> = [];
      for (const p of parts) {
        if (p.includes('-')) {
          const [a, b] = p.split('-');
          const lo = parseInt(a, 10);
          const hi = parseInt(b, 10);
          if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
            ranges.push([lo, hi]);
          }
        } else {
          const v = parseInt(p, 10);
          if (Number.isFinite(v)) ranges.push([v, v]);
        }
      }
      if (ranges.length === 0) return (code: number) => code >= 200 && code < 400;
      return (code: number) => ranges.some(([lo, hi]) => code >= lo && code <= hi);
    } catch {
      return (code: number) => code >= 200 && code < 400;
    }
  }

  isAcceptableStatus(code?: number | null, spec?: string | null) {
    if (!code || !Number.isFinite(code)) return false;
    return this.parseAcceptablePredicate(spec)(code as number);
  }

  async getEffectiveWebhook(environmentId: string): Promise<string | null> {
    // 1) DB first
    try {
      const [row] = await this.db.query<{ lark_webhook_url: string; lark_sign_secret?: string | null }[]>(
        'SELECT lark_webhook_url, lark_sign_secret FROM environment_alerts WHERE environment_id = ? LIMIT 1',
        [environmentId],
      );
      if (row?.lark_webhook_url) return row.lark_webhook_url;
    } catch {
      // ignore and fallback
    }
    // 2) Fallback to file config
    const env = this.envs.getEnvironmentById(environmentId);
    return env?.alerts?.lark_webhook_url || null;
  }

  private async postLark(environmentId: string, text: string) {
    const webhook = await this.getEffectiveWebhook(environmentId);
    if (!webhook) {
      this.logger.warn(`No Lark webhook configured for env ${environmentId}`);
      return;
    }
    const payload: any = { msg_type: 'text', content: { text } };
    const resp = await axios.post(webhook, payload, { timeout: 5000 });
    const data = resp?.data || {};
    const statusCode = data?.StatusCode ?? data?.code;
    if (statusCode !== undefined && statusCode !== 0) {
      throw new Error(`Lark returned non-success code: ${statusCode} message=${data?.StatusMessage || data?.msg}`);
    }
  }

  async sendUnavailableAlert(environmentId: string, site: any) {
    const tenantName = await this.getTenantName(environmentId, (site as any).tenant_id);
    const text = [
      `【站点不可用告警】`,
      `环境: ${environmentId}`,
      `租户: ${tenantName ?? (site.tenant_id ?? '-')}`,
      `名称: ${site.name}`,
      // 避免在 Lark 中自动变成可点击的 http://host:port 链接，改为拆分展示
      `Host: ${site.host} (${site.is_https ? 'HTTPS' : 'HTTP'}, port ${site.port})`,
      `状态: ${site.http_status ?? '-'}  失败次数: ${site.failure_count ?? '-'}`,
      `最后错误: ${site.last_error ?? '-'}`,
      `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    ].join('\n');
    try {
      await this.postLark(environmentId, text);
    } catch (e: any) {
      this.logger.error(`Failed to send Lark alert: ${e?.message || e}`);
    }
  }

  async markAlertSent(environmentId: string, siteId: number) {
    await this.db.query('UPDATE site_monitors SET last_alert_at = UTC_TIMESTAMP() WHERE id = ? AND environment_id = ?', [siteId, environmentId]);
  }

  async sendTestAlert(environmentId: string) {
    const text = [
      '【测试告警】',
      `环境: ${environmentId}`,
      `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    ].join('\n');
    await this.postLark(environmentId, text);
  }

  async getEnvAlertConfig(environmentId: string): Promise<{ failureThreshold: number; cooldownMinutes: number; probeTimeoutMs?: number | null; acceptableStatusCodes?: string | null }> {
    const defaults = { failureThreshold: 3, cooldownMinutes: 10, probeTimeoutMs: null as number | null, acceptableStatusCodes: null as string | null };
    try {
      const [row] = await this.db.query<{ failure_threshold?: number | null; cooldown_minutes?: number | null; probe_timeout_ms?: number | null; acceptable_status_codes?: string | null }[]>(
        'SELECT failure_threshold, cooldown_minutes, probe_timeout_ms, acceptable_status_codes FROM environment_alerts WHERE environment_id = ? LIMIT 1',
        [environmentId],
      );
      if (!row) {
        // fallback to environments.json if provided
        const env = this.envs.getEnvironmentById(environmentId);
        return {
          ...defaults,
          acceptableStatusCodes: env?.alerts?.acceptable_status_codes ?? null,
        };
      }
      return {
        failureThreshold: row.failure_threshold ?? defaults.failureThreshold,
        cooldownMinutes: row.cooldown_minutes ?? defaults.cooldownMinutes,
        probeTimeoutMs: row.probe_timeout_ms ?? defaults.probeTimeoutMs,
        acceptableStatusCodes: row.acceptable_status_codes ?? this.envs.getEnvironmentById(environmentId)?.alerts?.acceptable_status_codes ?? null,
      };
    } catch {
      const env = this.envs.getEnvironmentById(environmentId);
      return { ...defaults, acceptableStatusCodes: env?.alerts?.acceptable_status_codes ?? null };
    }
  }

  async sendRecoveryAlert(environmentId: string, site: any) {
    const tenantName = await this.getTenantName(environmentId, (site as any).tenant_id);
    const text = [
      `【站点恢复通知】`,
      `环境: ${environmentId}`,
      `租户: ${tenantName ?? (site.tenant_id ?? '-')}`,
      `名称: ${site.name}`,
      `Host: ${site.host} (${site.is_https ? 'HTTPS' : 'HTTP'}, port ${site.port})`,
      `当前状态: ${site.http_status ?? '-'}（已恢复可用）`,
      `恢复时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    ].join('\n');
    try {
      await this.postLark(environmentId, text);
    } catch (e: any) {
      this.logger.error(`Failed to send Lark recovery alert: ${e?.message || e}`);
    }
  }

  async getTenantName(environmentId: string, tenantId?: number | null): Promise<string | null> {
    if (!tenantId && tenantId !== 0) return null;
    try {
      const [row] = await this.db.query<{ name: string }[]>(
        'SELECT name FROM tenants WHERE environment_id = ? AND tenant_id = ? LIMIT 1',
        [environmentId, tenantId],
      );
      return row?.name || null;
    } catch {
      return null;
    }
  }
}
