import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { SiteConfService } from '../site-conf/site-conf.service';

export type DependencyTarget = {
  key: string;
  name: string;
  environmentId: string;
  category: string;
  url: string;
  module?: string;
};

export type DependencyProbeResult = DependencyTarget & {
  healthy: boolean;
  httpStatus: number | null;
  durationMs: number | null;
  tlsExpiresAt: string | null;
  errorType: 'NONE' | 'NETWORK' | 'HTTP_STATUS' | 'PROBE_ERROR';
  checkedAt: string;
};

@Injectable()
export class DependencyHealthService {
  constructor(private readonly siteConf: SiteConfService) {}

  async list() {
    const targets = this.validateTargets(
      await this.siteConf.getJson<unknown>('dependency_health.targets_json', []),
    );
    const results = await Promise.all(targets.map((target) => this.probe(target)));
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
      };
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(target.key)) throw new BadRequestException(`dependency target ${index} has invalid key`);
      if (keys.has(target.key)) throw new BadRequestException(`duplicate dependency target key: ${target.key}`);
      keys.add(target.key);
      if (!target.name || target.name.length > 100) throw new BadRequestException(`dependency target ${target.key} has invalid name`);
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target.environmentId) && target.environmentId !== 'global') {
        throw new BadRequestException(`dependency target ${target.key} has invalid environmentId`);
      }
      if (target.module !== 'http_2xx') {
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

  private async probe(target: DependencyTarget): Promise<DependencyProbeResult> {
    const checkedAt = new Date().toISOString();
    try {
      const baseUrl = (await this.siteConf.getString('dependency_health.blackbox_base_url', 'http://127.0.0.1:9115')).trim().replace(/\/+$/, '');
      const parsedBase = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsedBase.protocol)) throw new Error('invalid blackbox base URL');
      const response = await axios.get<string>(`${baseUrl}/probe`, {
        params: { module: target.module || 'http_2xx', target: target.url },
        timeout: await this.siteConf.getNumber('dependency_health.timeout_ms', 12_000),
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
