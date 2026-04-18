import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as dns from 'dns/promises';
import * as tls from 'tls';
import { ListLineDto } from './dto/list-line.dto';
import { ProvisionDcdnDomainDto } from './dto/provision-dcdn-domain.dto';
import { ApplyDcdnSecurityDto } from './dto/apply-dcdn-security.dto';
import { RegisterSuperAdminLineDto } from './dto/register-super-admin-line.dto';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { ListSuperAdminLinesDto } from './dto/list-super-admin-lines.dto';
import { ListLineInventoryDto } from './dto/list-line-inventory.dto';
import { CentralDatabaseService } from '../site-monitor/central-database.service';

const { RPCClient } = require('@alicloud/pop-core');

type DcdnProvisionResult = {
  domainName: string;
  originDomain: string;
  scope: 'global' | 'domestic' | 'overseas';
  created: boolean;
  cname: string | null;
  domainStatus?: string | null;
  cnameCheckStatus?: number | null;
  cnameCheckPassed?: boolean | null;
  cnameCheckErrMsg?: string | null;
  httpsEnabled?: boolean | null;
  websocketEnabled?: boolean | null;
  wafEnabled?: boolean | null;
  certName?: string | null;
  certId?: string | null;
  certRegion?: string | null;
  certType?: string | null;
  certStatus?: string | null;
  certDomainName?: string | null;
  certExpireTime?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  resourceGroupId?: string | null;
  tags?: Array<{ key: string; value: string }>;
  verifyRequired?: boolean;
  warnings?: string[];
  message: string;
};

type LineInventoryProvider = 'aliyun_dcdn' | 'aws_global' | 'aliyun_esa' | 'unknown';
type LineInventoryAvailability = 'up' | 'down' | 'unknown';
type LineInventoryErrorCode =
  | 'none'
  | 'timeout'
  | 'http_4xx'
  | 'http_5xx'
  | 'dns_error'
  | 'tcp_error'
  | 'ssl_error'
  | 'probe_unreachable'
  | 'stale_data'
  | 'no_data'
  | 'unknown_error';

type LineInventoryItem = {
  id: number | string | null;
  tenantId: number | null;
  zh: string;
  en: string;
  lineUrl: string;
  status: boolean | null;
  provider: LineInventoryProvider;
  sslExpireAt: string | null;
  sslDaysLeft: number | null;
  availability: LineInventoryAvailability;
  lastCheckedAt: string | null;
  error: LineInventoryErrorCode;
  availabilityScore: number | null;
  successRegions: number;
  failedRegions: number;
  unknownRegions: number;
  totalRegions: number;
};

type ProviderRule = {
  name: string;
  provider: LineInventoryProvider;
  pattern: RegExp;
};

type ProbeRecord = {
  host: string;
  region: string;
  ok: boolean | null;
  statusCode: number | null;
  errorText: string;
  checkedAt: Date | null;
};

type ProbeSnapshot = {
  records: ProbeRecord[];
  fetchedAt: string;
  sourceApi: string;
  warning?: string;
};

type LineSslSummary = {
  sslExpireAt: string | null;
  sslDaysLeft: number | null;
};

type LineSslSource = 'dcdn_api' | 'tls_probe' | 'unknown';

type LineSslResolvePayload = {
  summary: LineSslSummary;
  source: LineSslSource;
  lastError: string | null;
};

type SuperAdminLineItem = {
  id: number | string | null;
  zh: string;
  en: string;
  lineUrl: string;
  otcUrl: string;
  status: boolean | null;
  tenantId: number | null;
};

@Injectable()
export class LinesService {
  private readonly lineVerifyApiUrl: string;
  private readonly dcdnEndpoint: string;
  private readonly dcdnAccessKeyId: string;
  private readonly dcdnAccessKeySecret: string;
  private readonly dcdnWafClientIpTag: string;
  private readonly casEndpoint: string;
  private readonly casApiVersion: string;
  private readonly dcdnCertRegion: string;
  private readonly dcdnCertSourceDefault: 'cas' | 'upload';
  private readonly superAdminNamespace: string;
  private readonly superAdminServiceName: string;
  private readonly superAdminServicePort: number;
  private readonly superAdminAddPath: string;
  private readonly superAdminListPath: string;
  private readonly superAdminUpdatePathCandidates: string[];
  private readonly lineInventoryProbeApiUrl: string;
  private readonly availabilityWindowMs: number;
  private readonly availabilityCacheTtlMs: number;
  private readonly availabilityHttpTimeoutMs: number;
  private readonly availabilityUpThreshold: number;
  private readonly providerCacheTtlMs: number;
  private readonly sslCacheTtlMs: number;
  private readonly sslTlsTimeoutMs: number;
  private readonly sslResolveConcurrency: number;
  private readonly providerRules: ProviderRule[];
  private probeSnapshotCache: { expiresAt: number; snapshot: ProbeSnapshot } | null = null;
  private readonly providerCache = new Map<
    string,
    { provider: LineInventoryProvider; expiresAt: number; cnameValues: string[] }
  >();
  private readonly sslSummaryCache = new Map<
    string,
    { summary: LineSslSummary; expiresAt: number }
  >();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly kubernetesService: KubernetesService,
    private readonly centralDb: CentralDatabaseService,
  ) {
    this.lineVerifyApiUrl =
      this.configService.get<string>('LINE_VERIFY_API_URL') ||
      'http://172.31.29.3:3000/api/lines';
    this.dcdnEndpoint =
      this.configService.get<string>('DCDN_ENDPOINT') || 'https://dcdn.aliyuncs.com';
    this.dcdnAccessKeyId = this.configService.get<string>('ALIYUN_ACCESS_KEY_ID') || '';
    this.dcdnAccessKeySecret = this.configService.get<string>('ALIYUN_ACCESS_KEY_SECRET') || '';
    this.dcdnWafClientIpTag = this.configService.get<string>('DCDN_WAF_CLIENT_IP_TAG') || '';
    this.casEndpoint =
      this.configService.get<string>('CAS_ENDPOINT') || 'https://cas.ap-southeast-1.aliyuncs.com';
    this.casApiVersion = this.configService.get<string>('CAS_API_VERSION') || '2020-04-07';
    this.dcdnCertRegion = this.configService.get<string>('DCDN_CERT_REGION') || 'ap-southeast-1';
    const certSource =
      (this.configService.get<string>('DCDN_CERT_SOURCE') || 'cas').toLowerCase() === 'upload'
        ? 'upload'
        : 'cas';
    this.dcdnCertSourceDefault = certSource;
    this.superAdminNamespace = 'default';
    this.superAdminServiceName = 'kylin-admin-kylin-admin-impl';
    this.superAdminServicePort = 80;
    this.superAdminAddPath = '/admin/app/line/url/add';
    this.superAdminListPath = '/admin/app/line/url/list';
    this.superAdminUpdatePathCandidates = [
      '/admin/app/line/url/update',
      '/admin/app/line/url/edit',
      '/admin/app/line/url/modify',
    ];
    this.lineInventoryProbeApiUrl =
      this.configService.get<string>('LINE_INVENTORY_PROBE_API_URL') ||
      this.configService.get<string>('LINE_PROBE_LATEST_API_URL') ||
      this.deriveProbeApiFromLineVerify(this.lineVerifyApiUrl);
    this.availabilityWindowMs = this.parsePositiveInt(
      this.configService.get<string>('LINE_AVAILABILITY_WINDOW_MS'),
      120000,
    );
    this.availabilityCacheTtlMs = this.parsePositiveInt(
      this.configService.get<string>('LINE_AVAILABILITY_CACHE_TTL_MS'),
      15000,
    );
    this.availabilityHttpTimeoutMs = this.parsePositiveInt(
      this.configService.get<string>('LINE_AVAILABILITY_HTTP_TIMEOUT_MS'),
      3000,
    );
    this.availabilityUpThreshold = this.parsePositiveFloat(
      this.configService.get<string>('LINE_AVAILABILITY_UP_THRESHOLD'),
      0.8,
    );
    this.providerCacheTtlMs = this.parsePositiveInt(
      this.configService.get<string>('LINE_PROVIDER_CACHE_TTL_MS'),
      3600000,
    );
    this.sslCacheTtlMs = this.parsePositiveInt(
      this.configService.get<string>('LINE_SSL_CACHE_TTL_MS'),
      300000,
    );
    this.sslTlsTimeoutMs = this.parsePositiveInt(
      this.configService.get<string>('LINE_SSL_TLS_TIMEOUT_MS'),
      5000,
    );
    this.sslResolveConcurrency = this.parsePositiveInt(
      this.configService.get<string>('LINE_SSL_RESOLVE_CONCURRENCY'),
      8,
    );
    this.providerRules = this.buildProviderRules(
      this.configService.get<string>('LINE_PROVIDER_RULES_JSON'),
    );
  }

  async getLines(environmentId: string, query: ListLineDto) {
    const parsedPage = Number(query.page);
    const parsedSize = Number(query.size);
    const parsedTenantId = Number(query.tenantId);
    const lineUrl = query.lineUrl?.trim() || '';

    const result = await this.listSuperAdminLines(environmentId, {
      page: Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1,
      size: Number.isFinite(parsedSize) && parsedSize > 0 ? Math.floor(parsedSize) : 10,
      lineUrl,
      tenantId: Number.isFinite(parsedTenantId) && parsedTenantId > 0 ? Math.floor(parsedTenantId) : undefined,
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        list: result.items,
        totalCount: result.total,
        page: result.page,
        size: result.size,
      },
    };
  }

  async getLineInventory(environmentId: string, query: ListLineInventoryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const size = query.size && query.size > 0 ? Math.min(query.size, 200) : 20;
    const lineUrl = query.lineUrl?.trim() || '';
    const tenantId = query.tenantId && query.tenantId > 0 ? query.tenantId : undefined;
    const forceRefresh = query.refresh === true;
    const shouldUseFullScan = this.shouldUseFullInventoryScan(query);
    let listFetchWarning: string | null = null;
    let sourceItems: SuperAdminLineItem[] = [];
    let sourceTotal = 0;
    if (shouldUseFullScan) {
      const fullList = await this.listAllSuperAdminLinesForInventory(environmentId, {
        lineUrl,
        tenantId,
      });
      sourceItems = fullList.items;
      sourceTotal = sourceItems.length;
      listFetchWarning = fullList.warning;
    } else {
      const base = await this.listSuperAdminLines(environmentId, {
        page,
        size,
        lineUrl,
        tenantId,
      });
      sourceItems = base.items;
      sourceTotal = base.total;
    }

    let probeSnapshot: ProbeSnapshot = {
      records: [],
      fetchedAt: new Date().toISOString(),
      sourceApi: this.lineInventoryProbeApiUrl || '(not configured)',
      warning: '未获取探测快照',
    };
    let probeSourceUnavailable = false;
    try {
      probeSnapshot = await this.getLatestProbeSnapshot(forceRefresh);
    } catch (error: any) {
      probeSourceUnavailable = true;
      probeSnapshot = {
        records: [],
        fetchedAt: new Date().toISOString(),
        sourceApi: this.lineInventoryProbeApiUrl || '(not configured)',
        warning: error?.message || '探测接口不可用',
      };
    }

    const uniqueHosts = Array.from(
      new Set(
        sourceItems
          .map((item) => this.safeNormalizeToHost(item.lineUrl || ''))
          .filter((host): host is string => Boolean(host)),
      ),
    );
    const activeHosts = Array.from(
      new Set(
        sourceItems
          .filter((item) => item.status === true)
          .map((item) => this.safeNormalizeToHost(item.lineUrl || ''))
          .filter((host): host is string => Boolean(host)),
      ),
    );
    const providerMap = await this.resolveProvidersByHosts(uniqueHosts, forceRefresh);
    const sslMap = await this.resolveSslSummaryByHosts(
      environmentId,
      activeHosts,
      providerMap,
      forceRefresh,
    );

    let items: LineInventoryItem[] = sourceItems.map((item) => {
      const host = this.safeNormalizeToHost(item.lineUrl || '');
      const providerInfo = host ? providerMap.get(host) : null;
      const sslSummary = host ? sslMap.get(host) : null;
      const availabilitySummary = host
        ? this.buildAvailabilitySummaryByHost(host, probeSnapshot.records, probeSourceUnavailable)
        : {
            availability: 'unknown' as LineInventoryAvailability,
            error: 'unknown_error' as LineInventoryErrorCode,
            lastCheckedAt: null,
            availabilityScore: null,
            successRegions: 0,
            failedRegions: 0,
            unknownRegions: 0,
            totalRegions: 0,
          };

      return {
        id: item.id ?? null,
        tenantId: item.tenantId ?? null,
        zh: item.zh || '',
        en: item.en || '',
        lineUrl: item.lineUrl || '',
        status: item.status ?? null,
        provider: providerInfo?.provider || 'unknown',
        sslExpireAt: sslSummary?.sslExpireAt ?? null,
        sslDaysLeft: sslSummary?.sslDaysLeft ?? null,
        availability: availabilitySummary.availability,
        lastCheckedAt: availabilitySummary.lastCheckedAt,
        error: availabilitySummary.error,
        availabilityScore: availabilitySummary.availabilityScore,
        successRegions: availabilitySummary.successRegions,
        failedRegions: availabilitySummary.failedRegions,
        unknownRegions: availabilitySummary.unknownRegions,
        totalRegions: availabilitySummary.totalRegions,
      };
    });
    items = this.applyLineInventoryFilters(items, query);
    const total = shouldUseFullScan ? items.length : sourceTotal;
    const pagedItems = shouldUseFullScan
      ? items.slice((page - 1) * size, (page - 1) * size + size)
      : items;

    const warningParts: string[] = [];
    if (probeSnapshot.warning) warningParts.push(probeSnapshot.warning);
    if (listFetchWarning) warningParts.push(listFetchWarning);

    return {
      page,
      size,
      total,
      tenantId: tenantId || null,
      lineUrl: lineUrl || null,
      filters: {
        status: typeof query.status === 'boolean' ? query.status : null,
        provider: query.provider || null,
        availability: query.availability || null,
        certExpireDaysLt:
          typeof query.certExpireDaysLt === 'number' ? query.certExpireDaysLt : null,
        refresh: forceRefresh,
      },
      items: pagedItems,
      probeSnapshot: {
        fetchedAt: probeSnapshot.fetchedAt,
        sourceApi: probeSnapshot.sourceApi,
      },
      fetchedAt: probeSnapshot.fetchedAt || new Date().toISOString(),
      warning: warningParts.length > 0 ? warningParts.join('；') : null,
    };
  }

  private shouldUseFullInventoryScan(query: ListLineInventoryDto): boolean {
    return (
      typeof query.status === 'boolean' ||
      Boolean(query.provider) ||
      Boolean(query.availability) ||
      typeof query.certExpireDaysLt === 'number'
    );
  }

  private applyLineInventoryFilters(
    items: LineInventoryItem[],
    query: ListLineInventoryDto,
  ): LineInventoryItem[] {
    let filtered = items;
    if (typeof query.status === 'boolean') {
      filtered = filtered.filter((item) => item.status === query.status);
    }
    if (query.provider) {
      filtered = filtered.filter((item) => item.provider === query.provider);
    }
    if (query.availability) {
      filtered = filtered.filter((item) => item.availability === query.availability);
    }
    if (typeof query.certExpireDaysLt === 'number') {
      filtered = filtered.filter(
        (item) => typeof item.sslDaysLeft === 'number' && item.sslDaysLeft <= query.certExpireDaysLt!,
      );
    }
    return filtered;
  }

  private async listAllSuperAdminLinesForInventory(
    environmentId: string,
    query: { lineUrl: string; tenantId?: number },
  ): Promise<{ items: SuperAdminLineItem[]; warning: string | null }> {
    const pageSize = 200;
    const maxPages = 200;
    const items: SuperAdminLineItem[] = [];
    let page = 1;
    let expectedTotal: number | null = null;
    let truncated = false;

    while (page <= maxPages) {
      const current = await this.listSuperAdminLines(environmentId, {
        page,
        size: pageSize,
        lineUrl: query.lineUrl,
        tenantId: query.tenantId,
      });
      if (page === 1) {
        const firstTotal = Number(current.total);
        if (Number.isFinite(firstTotal) && firstTotal > pageSize) {
          expectedTotal = firstTotal;
        }
      }
      if (!current.items.length) break;
      items.push(...current.items);

      const reachedExpectedTotal = expectedTotal !== null && items.length >= expectedTotal;
      const reachedLastPage = current.items.length < pageSize;
      if (reachedExpectedTotal || reachedLastPage) break;

      if (page === maxPages) {
        truncated = true;
        break;
      }
      page += 1;
    }

    return {
      items,
      warning: truncated
        ? `线路列表全量拉取已达到安全上限（${maxPages} 页，${items.length} 条），结果可能不完整`
        : null,
    };
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
  }

  private parsePositiveFloat(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    if (value > 1 && value <= 100) return value / 100;
    if (value > 100) return fallback;
    return value;
  }

  private deriveProbeApiFromLineVerify(lineVerifyApiUrl: string): string {
    try {
      const parsed = new URL(lineVerifyApiUrl);
      if (parsed.pathname === '/api/lines') {
        parsed.pathname = '/api/probes/latest';
      } else if (parsed.pathname === '/api/latest') {
        return parsed.toString();
      } else if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/api/probes/latest';
      }
      return parsed.toString();
    } catch {
      return '';
    }
  }

  private buildProviderRules(rawJson: string | undefined): ProviderRule[] {
    const builtinRules: ProviderRule[] = [
      { name: 'aws-cloudfront', provider: 'aws_global', pattern: /\.cloudfront\.net$/i },
      {
        name: 'aws-global-accelerator',
        provider: 'aws_global',
        pattern: /\.awsglobalaccelerator\.com$/i,
      },
      { name: 'aws-elb', provider: 'aws_global', pattern: /\.elb\.amazonaws\.com$/i },
      { name: 'aliyun-dcdn', provider: 'aliyun_dcdn', pattern: /dcdn|kunlun/i },
      { name: 'aliyun-esa', provider: 'aliyun_esa', pattern: /esa|edge\.aliyun/i },
    ];

    if (!rawJson?.trim()) return builtinRules;

    try {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) return builtinRules;
      const envRules: ProviderRule[] = parsed
        .map((item, index) => {
          const provider = String(item?.provider || '').trim() as LineInventoryProvider;
          const patternRaw = String(item?.pattern || '').trim();
          const flags = String(item?.flags || '').trim();
          const name = String(item?.name || `env-rule-${index + 1}`).trim();
          if (!provider || !patternRaw) return null;
          if (!['aliyun_dcdn', 'aws_global', 'aliyun_esa', 'unknown'].includes(provider)) {
            return null;
          }
          return {
            provider,
            name,
            pattern: new RegExp(patternRaw, flags),
          } as ProviderRule;
        })
        .filter((item): item is ProviderRule => Boolean(item));
      return builtinRules.concat(envRules);
    } catch {
      return builtinRules;
    }
  }

  private safeNormalizeToHost(rawValue: string): string | null {
    const value = String(rawValue || '').trim();
    if (!value) return null;
    try {
      return this.normalizeToHost(value);
    } catch {
      return null;
    }
  }

  private flattenProbeRecords(payload: unknown, output: any[]) {
    if (payload == null) return;
    if (Array.isArray(payload)) {
      payload.forEach((item) => this.flattenProbeRecords(item, output));
      return;
    }
    if (typeof payload !== 'object') return;

    const obj = payload as Record<string, unknown>;
    const hasProbeShape =
      'line_url' in obj ||
      'lineUrl' in obj ||
      'ok' in obj ||
      'http_status' in obj ||
      'httpStatus' in obj;
    if (hasProbeShape) {
      output.push(obj);
    }
    Object.values(obj).forEach((value) => this.flattenProbeRecords(value, output));
  }

  private toProbeDate(value: unknown): Date | null {
    if (value == null) return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private normalizeProbeRecord(raw: any): ProbeRecord | null {
    const host = this.safeNormalizeToHost(
      String(raw?.line_url || raw?.lineUrl || raw?.url || raw?.lineUrlHost || ''),
    );
    if (!host) return null;

    const regionRaw = String(raw?.region || raw?.agentRegion || raw?.agent || 'unknown')
      .trim()
      .toLowerCase();
    const region = regionRaw || 'unknown';
    const statusRaw = raw?.http_status ?? raw?.httpStatus ?? raw?.status ?? null;
    const statusCode = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
    const okRaw = raw?.ok;
    let ok: boolean | null = null;
    if (typeof okRaw === 'boolean') {
      ok = okRaw;
    } else if (String(okRaw).toLowerCase() === 'true') {
      ok = true;
    } else if (String(okRaw).toLowerCase() === 'false') {
      ok = false;
    } else if (statusCode != null) {
      ok = statusCode >= 200 && statusCode < 400;
    }

    return {
      host,
      region,
      ok,
      statusCode,
      errorText: String(raw?.error || raw?.err || '').trim(),
      checkedAt: this.toProbeDate(raw?.time ?? raw?.checkedAt ?? raw?.timestamp ?? raw?.updatedAt),
    };
  }

  private async getLatestProbeSnapshot(forceRefresh: boolean): Promise<ProbeSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.probeSnapshotCache && this.probeSnapshotCache.expiresAt > now) {
      return this.probeSnapshotCache.snapshot;
    }
    if (!this.lineInventoryProbeApiUrl) {
      return {
        records: [],
        fetchedAt: new Date().toISOString(),
        sourceApi: '(not configured)',
        warning: '未配置线路探测聚合接口',
      };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(this.lineInventoryProbeApiUrl, {
          timeout: this.availabilityHttpTimeoutMs,
        }),
      );
      const rawRecords: any[] = [];
      this.flattenProbeRecords(response.data, rawRecords);
      const latestByHostRegion = new Map<string, ProbeRecord>();
      rawRecords.forEach((raw) => {
        const normalized = this.normalizeProbeRecord(raw);
        if (!normalized) return;
        const key = `${normalized.host}#${normalized.region}`;
        const existing = latestByHostRegion.get(key);
        const currentTs = normalized.checkedAt?.getTime() ?? 0;
        const existingTs = existing?.checkedAt?.getTime() ?? 0;
        if (!existing || currentTs >= existingTs) {
          latestByHostRegion.set(key, normalized);
        }
      });
      const snapshot: ProbeSnapshot = {
        records: Array.from(latestByHostRegion.values()),
        fetchedAt: new Date().toISOString(),
        sourceApi: this.lineInventoryProbeApiUrl,
      };
      this.probeSnapshotCache = {
        expiresAt: now + this.availabilityCacheTtlMs,
        snapshot,
      };
      return snapshot;
    } catch (error: any) {
      if (this.probeSnapshotCache) {
        return {
          ...this.probeSnapshotCache.snapshot,
          warning: '探测接口请求失败，已回退到缓存快照',
        };
      }
      throw new InternalServerErrorException(
        `探测接口请求失败: ${error?.message || 'unknown error'}`,
      );
    }
  }

  private async resolveProvidersByHosts(
    hosts: string[],
    forceRefresh: boolean,
  ): Promise<Map<string, { provider: LineInventoryProvider; cnameValues: string[] }>> {
    const result = new Map<string, { provider: LineInventoryProvider; cnameValues: string[] }>();
    await Promise.all(
      hosts.map(async (host) => {
        const resolved = await this.resolveProviderForHost(host, forceRefresh);
        result.set(host, resolved);
      }),
    );
    return result;
  }

  private async resolveProviderForHost(
    host: string,
    forceRefresh: boolean,
  ): Promise<{ provider: LineInventoryProvider; cnameValues: string[] }> {
    const now = Date.now();
    const cached = this.providerCache.get(host);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return { provider: cached.provider, cnameValues: cached.cnameValues };
    }

    const cnameValues = await this.resolveCnameValues(host);
    const candidates = [host, ...cnameValues].map((item) => item.toLowerCase());
    let provider: LineInventoryProvider = 'unknown';
    for (const rule of this.providerRules) {
      if (candidates.some((candidate) => rule.pattern.test(candidate))) {
        provider = rule.provider;
        break;
      }
    }

    this.providerCache.set(host, {
      provider,
      cnameValues,
      expiresAt: now + this.providerCacheTtlMs,
    });
    return { provider, cnameValues };
  }

  private async resolveCnameValues(host: string): Promise<string[]> {
    const results: string[] = [];
    let currentLevel = [host];
    const visited = new Set<string>([host]);
    for (let depth = 0; depth < 3; depth += 1) {
      const nextLevel: string[] = [];
      await Promise.all(
        currentLevel.map(async (domain) => {
          try {
            const aliases = await dns.resolveCname(domain);
            aliases.forEach((alias) => {
              const normalized = alias.trim().toLowerCase().replace(/\.$/, '');
              if (!normalized) return;
              if (!visited.has(normalized)) {
                visited.add(normalized);
                results.push(normalized);
                nextLevel.push(normalized);
              }
            });
          } catch {
            // ignore DNS failures; provider fallback will be unknown
          }
        }),
      );
      if (nextLevel.length === 0) break;
      currentLevel = nextLevel;
    }
    return results;
  }

  private hasAliyunCredentials(): boolean {
    return Boolean(this.dcdnAccessKeyId && this.dcdnAccessKeySecret);
  }

  private buildSslCacheKey(environmentId: string, host: string): string {
    return `${environmentId}#${host}`;
  }

  private async resolveSslSummaryByHosts(
    environmentId: string,
    hosts: string[],
    providerMap: Map<string, { provider: LineInventoryProvider; cnameValues: string[] }>,
    forceRefresh: boolean,
  ): Promise<Map<string, LineSslSummary>> {
    const result = new Map<string, LineSslSummary>();
    if (!hosts.length) return result;

    const now = Date.now();
    let pendingHosts = hosts;
    if (!forceRefresh) {
      pendingHosts = hosts.filter((host) => {
        const cacheKey = this.buildSslCacheKey(environmentId, host);
        const cached = this.sslSummaryCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
          result.set(host, cached.summary);
          return false;
        }
        return true;
      });
      if (pendingHosts.length > 0) {
        const dbCached = await this.loadSslSummaryFromDbCache(environmentId, pendingHosts);
        dbCached.forEach((summary, host) => {
          result.set(host, summary);
          const cacheKey = this.buildSslCacheKey(environmentId, host);
          this.sslSummaryCache.set(cacheKey, {
            summary,
            expiresAt: now + this.sslCacheTtlMs,
          });
        });
        pendingHosts = pendingHosts.filter((host) => !dbCached.has(host));
      }
    }

    if (!pendingHosts.length) return result;

    const needDcdn = pendingHosts.some((host) => providerMap.get(host)?.provider === 'aliyun_dcdn');
    const dcdnClient = needDcdn && this.hasAliyunCredentials() ? this.createDcdnClient() : null;
    const batchSize = Math.max(1, Math.min(this.sslResolveConcurrency, 50));
    const upsertRows: Array<{
      host: string;
      provider: LineInventoryProvider;
      summary: LineSslSummary;
      source: LineSslSource;
      lastError: string | null;
    }> = [];

    for (let i = 0; i < pendingHosts.length; i += batchSize) {
      const batch = pendingHosts.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (host) => {
          const provider = providerMap.get(host)?.provider || 'unknown';
          const resolved = await this.resolveSslSummaryForHost(
            environmentId,
            host,
            provider,
            forceRefresh,
            dcdnClient,
          );
          result.set(host, resolved.summary);
          upsertRows.push({
            host,
            provider,
            summary: resolved.summary,
            source: resolved.source,
            lastError: resolved.lastError,
          });
        }),
      );
    }

    if (upsertRows.length > 0) {
      await this.upsertSslSummaryCacheRows(environmentId, upsertRows);
    }
    return result;
  }

  private async loadSslSummaryFromDbCache(
    environmentId: string,
    hosts: string[],
  ): Promise<Map<string, LineSslSummary>> {
    const result = new Map<string, LineSslSummary>();
    if (!hosts.length) return result;

    try {
      const placeholders = hosts.map(() => '?').join(',');
      const rows = await this.centralDb.query<
        Array<{ host: string; ssl_expire_at: string | null; ssl_days_left: number | string | null }>
      >(
        `SELECT host, ssl_expire_at, ssl_days_left
         FROM line_inventory_ssl_cache
         WHERE environment_id = ?
           AND host IN (${placeholders})
           AND expires_at > UTC_TIMESTAMP()`,
        [environmentId, ...hosts],
      );
      rows.forEach((row) => {
        const host = String(row?.host || '').trim().toLowerCase();
        if (!host) return;
        const sslExpireAt = this.toIsoTime(row?.ssl_expire_at);
        const numericDays = Number(row?.ssl_days_left);
        const sslDaysLeft =
          Number.isFinite(numericDays) ? Math.floor(numericDays) : this.computeSslDaysLeft(sslExpireAt);
        result.set(host, {
          sslExpireAt,
          sslDaysLeft,
        });
      });
    } catch (error: any) {
      // DB cache read failure should not block inventory response.
      console.warn('loadSslSummaryFromDbCache failed:', error?.message || error);
    }
    return result;
  }

  private async upsertSslSummaryCacheRows(
    environmentId: string,
    rows: Array<{
      host: string;
      provider: LineInventoryProvider;
      summary: LineSslSummary;
      source: LineSslSource;
      lastError: string | null;
    }>,
  ): Promise<void> {
    if (!rows.length) return;
    try {
      const valuesSql = rows
        .map(
          () =>
            '(?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        )
        .join(',');
      const sql = `
        INSERT INTO line_inventory_ssl_cache (
          environment_id, host, provider, ssl_expire_at, ssl_days_left, source, last_checked_at, expires_at, last_error, created_at, updated_at
        ) VALUES ${valuesSql}
        ON DUPLICATE KEY UPDATE
          provider = VALUES(provider),
          ssl_expire_at = VALUES(ssl_expire_at),
          ssl_days_left = VALUES(ssl_days_left),
          source = VALUES(source),
          last_checked_at = VALUES(last_checked_at),
          expires_at = VALUES(expires_at),
          last_error = VALUES(last_error),
          updated_at = UTC_TIMESTAMP()
      `;
      const ttlSeconds = Math.max(1, Math.floor(this.sslCacheTtlMs / 1000));
      const params: any[] = [];
      rows.forEach((row) => {
        params.push(
          environmentId,
          row.host,
          row.provider,
          row.summary.sslExpireAt,
          row.summary.sslDaysLeft,
          row.source,
          ttlSeconds,
          row.lastError,
        );
      });
      await this.centralDb.query(sql, params);
    } catch (error: any) {
      // DB cache write failure should not block inventory response.
      console.warn('upsertSslSummaryCacheRows failed:', error?.message || error);
    }
  }

  private async resolveSslSummaryForHost(
    environmentId: string,
    host: string,
    provider: LineInventoryProvider,
    forceRefresh: boolean,
    dcdnClient: any | null,
  ): Promise<LineSslResolvePayload> {
    const now = Date.now();
    const cacheKey = this.buildSslCacheKey(environmentId, host);
    const cached = this.sslSummaryCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return {
        summary: cached.summary,
        source: 'unknown',
        lastError: null,
      };
    }

    let expireAt: string | null = null;
    let source: LineSslSource = 'unknown';
    let lastError: string | null = null;
    if (provider === 'aliyun_dcdn') {
      const dcdnResult = await this.tryResolveDcdnCertExpireAt(dcdnClient, host);
      expireAt = dcdnResult.expireAt;
      if (dcdnResult.expireAt) {
        source = 'dcdn_api';
        lastError = null;
      } else {
        lastError = dcdnResult.error;
      }
    }
    if (!expireAt) {
      const tlsResult = await this.tryResolveTlsCertExpireAt(host);
      expireAt = tlsResult.expireAt;
      if (tlsResult.expireAt) {
        source = 'tls_probe';
        lastError = null;
      } else {
        lastError = tlsResult.error || lastError;
      }
    }

    const summary: LineSslSummary = {
      sslExpireAt: expireAt,
      sslDaysLeft: this.computeSslDaysLeft(expireAt),
    };
    this.sslSummaryCache.set(cacheKey, {
      summary,
      expiresAt: now + this.sslCacheTtlMs,
    });
    return {
      summary,
      source,
      lastError,
    };
  }

  private async tryResolveDcdnCertExpireAt(
    client: any | null,
    domainName: string,
  ): Promise<{ expireAt: string | null; error: string | null }> {
    if (!client) return { expireAt: null, error: 'dcdn client unavailable' };
    try {
      const info = await this.getDcdnCertificateInfo(client, domainName);
      return { expireAt: this.toIsoTime(info.certExpireTime), error: null };
    } catch (error: any) {
      return { expireAt: null, error: error?.message || 'resolve dcdn certificate failed' };
    }
  }

  private async tryResolveTlsCertExpireAt(
    host: string,
  ): Promise<{ expireAt: string | null; error: string | null }> {
    try {
      const cert = await this.fetchTlsCertificate(host, 443, this.sslTlsTimeoutMs);
      return { expireAt: cert.notAfter ? cert.notAfter.toISOString() : null, error: null };
    } catch (error: any) {
      return { expireAt: null, error: error?.message || 'resolve tls certificate failed' };
    }
  }

  private toIsoTime(raw: unknown): string | null {
    if (raw == null) return null;
    const value = String(raw).trim();
    if (!value) return null;

    const formatted = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(/\s+/, 'T')}Z`
      : value;
    const date = new Date(formatted);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  private computeSslDaysLeft(expireAtIso: string | null): number | null {
    if (!expireAtIso) return null;
    const ts = new Date(expireAtIso).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.floor((ts - Date.now()) / (24 * 60 * 60 * 1000));
  }

  private fetchTlsCertificate(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ notAfter: Date | null }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
        () => {
          settle(() => {
            try {
              const cert: any = socket.getPeerCertificate();
              const notAfter = cert?.valid_to ? new Date(cert.valid_to) : null;
              resolve({
                notAfter:
                  notAfter && !Number.isNaN(notAfter.getTime()) ? notAfter : null,
              });
            } catch (error) {
              reject(error);
            } finally {
              socket.end();
            }
          });
        },
      );
      socket.on('error', (error) => {
        settle(() => reject(error));
      });
      socket.setTimeout(timeoutMs, () => {
        settle(() => {
          socket.destroy();
          reject(new Error('TLS timeout'));
        });
      });
    });
  }

  private mapErrorFromProbe(
    failures: ProbeRecord[],
    sourceUnavailable: boolean,
  ): LineInventoryErrorCode {
    if (sourceUnavailable && failures.length === 0) return 'probe_unreachable';
    for (const failure of failures) {
      if (failure.statusCode != null) {
        if (failure.statusCode >= 500) return 'http_5xx';
        if (failure.statusCode >= 400) return 'http_4xx';
      }
      const text = failure.errorText.toLowerCase();
      if (text.includes('timeout')) return 'timeout';
      if (text.includes('dns') || text.includes('enotfound') || text.includes('nxdomain')) return 'dns_error';
      if (text.includes('ssl') || text.includes('certificate') || text.includes('tls')) return 'ssl_error';
      if (text.includes('tcp') || text.includes('connect') || text.includes('refused')) return 'tcp_error';
    }
    return failures.length > 0 ? 'unknown_error' : 'no_data';
  }

  private buildAvailabilitySummaryByHost(
    host: string,
    records: ProbeRecord[],
    sourceUnavailable: boolean,
  ): {
    availability: LineInventoryAvailability;
    error: LineInventoryErrorCode;
    lastCheckedAt: string | null;
    availabilityScore: number | null;
    successRegions: number;
    failedRegions: number;
    unknownRegions: number;
    totalRegions: number;
  } {
    const hostRecords = records.filter((record) => record.host === host);
    if (hostRecords.length === 0) {
      return {
        availability: 'unknown',
        error: sourceUnavailable ? 'probe_unreachable' : 'no_data',
        lastCheckedAt: null,
        availabilityScore: null,
        successRegions: 0,
        failedRegions: 0,
        unknownRegions: 0,
        totalRegions: 0,
      };
    }

    const latestCheckedAt = hostRecords
      .map((record) => record.checkedAt?.getTime() ?? 0)
      .reduce((prev, current) => Math.max(prev, current), 0);
    const now = Date.now();
    const freshRecords = hostRecords.filter((record) => {
      const ts = record.checkedAt?.getTime();
      return typeof ts === 'number' && ts > 0 && now - ts <= this.availabilityWindowMs;
    });
    if (freshRecords.length === 0) {
      return {
        availability: 'unknown',
        error: 'stale_data',
        lastCheckedAt: latestCheckedAt > 0 ? new Date(latestCheckedAt).toISOString() : null,
        availabilityScore: null,
        successRegions: 0,
        failedRegions: 0,
        unknownRegions: hostRecords.length,
        totalRegions: hostRecords.length,
      };
    }

    let successRegions = 0;
    let failedRegions = 0;
    let unknownRegions = 0;
    const failures: ProbeRecord[] = [];
    freshRecords.forEach((record) => {
      if (record.ok === true) {
        successRegions += 1;
      } else if (record.ok === false) {
        failedRegions += 1;
        failures.push(record);
      } else {
        unknownRegions += 1;
      }
    });
    const effectiveRegions = successRegions + failedRegions;
    if (effectiveRegions === 0) {
      return {
        availability: 'unknown',
        error: 'no_data',
        lastCheckedAt: latestCheckedAt > 0 ? new Date(latestCheckedAt).toISOString() : null,
        availabilityScore: null,
        successRegions,
        failedRegions,
        unknownRegions,
        totalRegions: freshRecords.length,
      };
    }

    const availabilityScore = Number(((successRegions / effectiveRegions) * 100).toFixed(2));
    const isUp = availabilityScore >= this.availabilityUpThreshold * 100;
    return {
      availability: isUp ? 'up' : 'down',
      error: isUp ? 'none' : this.mapErrorFromProbe(failures, sourceUnavailable),
      lastCheckedAt: latestCheckedAt > 0 ? new Date(latestCheckedAt).toISOString() : null,
      availabilityScore,
      successRegions,
      failedRegions,
      unknownRegions,
      totalRegions: freshRecords.length,
    };
  }

  async listIngressOriginCandidates(environmentId: string, keyword?: string) {
    const result = await this.kubernetesService.listIngressOriginCandidates(
      environmentId,
      keyword || 'nginx-web-app',
    );
    return result;
  }

  private normalizeToHost(rawLineUrl: string) {
    const value = rawLineUrl.trim().toLowerCase();
    if (!value) {
      throw new BadRequestException('lineUrl is required');
    }
    try {
      const withSchema = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      return new URL(withSchema).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('lineUrl format is invalid');
    }
  }

  private createDcdnClient() {
    if (!this.dcdnAccessKeyId || !this.dcdnAccessKeySecret) {
      throw new InternalServerErrorException(
        'ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET is not configured',
      );
    }

    return new RPCClient({
      accessKeyId: this.dcdnAccessKeyId,
      accessKeySecret: this.dcdnAccessKeySecret,
      endpoint: this.dcdnEndpoint,
      apiVersion: '2018-01-15',
    });
  }

  private createCasClient() {
    if (!this.dcdnAccessKeyId || !this.dcdnAccessKeySecret) {
      throw new InternalServerErrorException(
        'ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET is not configured',
      );
    }
    return new RPCClient({
      accessKeyId: this.dcdnAccessKeyId,
      accessKeySecret: this.dcdnAccessKeySecret,
      endpoint: this.casEndpoint,
      apiVersion: this.casApiVersion,
    });
  }

  private isDomainAlreadyExistsError(error: any) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const dataCode = String(error?.data?.Code || '').toLowerCase();
    const combined = `${code} ${message} ${dataCode}`;
    const rawMessage = String(error?.message || '') + String(error?.data?.Message || '');
    return (
      combined.includes('already') ||
      combined.includes('exist') ||
      rawMessage.includes('已存在') ||
      rawMessage.includes('重复')
    );
  }

  private extractCname(payload: any): string | null {
    const candidates = [
      payload?.Cname,
      payload?.DomainCname,
      payload?.Data?.Cname,
      payload?.Data?.DomainCname,
      payload?.DomainDetail?.Cname,
      payload?.DomainDetail?.DomainNameCname,
    ].filter((v) => typeof v === 'string' && v.trim() !== '') as string[];
    return candidates[0] || null;
  }

  private extractDomainStatus(payload: any): string | null {
    const value = payload?.DomainStatus || payload?.DomainDetail?.DomainStatus || payload?.Data?.DomainStatus;
    if (typeof value === 'string' && value.trim()) return value;
    return null;
  }

  private extractDomainFromUserDomains(payload: any, domainName: string) {
    const pageData = payload?.Domains?.PageData;
    const list = Array.isArray(pageData) ? pageData : [];
    const exact = list.find((item: any) =>
      String(item?.DomainName || '').toLowerCase() === domainName.toLowerCase(),
    );
    return exact || list[0] || null;
  }

  private formatTags(raw: any): Array<{ key: string; value: string }> {
    const tagsArray = Array.isArray(raw) ? raw : [];
    return tagsArray
      .map((item: any) => ({
        key: String(item?.Key || item?.TagKey || '').trim(),
        value: String(item?.Value || item?.TagValue || '').trim(),
      }))
      .filter((item) => item.key);
  }

  private extractOriginFromSources(sourcesPayload: any): string | null {
    if (!sourcesPayload) return null;
    const sources = Array.isArray(sourcesPayload)
      ? sourcesPayload
      : Array.isArray(sourcesPayload?.Source)
        ? sourcesPayload.Source
        : Array.isArray(sourcesPayload?.Sources)
          ? sourcesPayload.Sources
          : [];
    const first = sources[0];
    if (!first || typeof first !== 'object') return null;
    const candidates = [
      first.Content,
      first.content,
      first.Source,
      first.source,
      first.Address,
      first.address,
    ];
    const value = candidates.find((item) => typeof item === 'string' && item.trim()) as
      | string
      | undefined;
    return value ? value.trim() : null;
  }

  private extractOriginDomainFromDomainInfo(domainInfo: any, detailResp: any): string | null {
    return (
      this.extractOriginFromSources(detailResp?.DomainDetail?.Sources) ||
      this.extractOriginFromSources(domainInfo?.Sources) ||
      this.extractOriginFromSources(domainInfo?.Origin) ||
      null
    );
  }

  private extractAliyunErrorMessage(error: any, fallback: string) {
    const code = String(error?.data?.Code || error?.code || '').trim();
    const message = String(error?.data?.Message || error?.message || fallback).trim();
    return code ? `${code}: ${message}` : message;
  }

  private isCertificateNameConflict(error: any) {
    const code = String(error?.data?.Code || error?.code || '').toLowerCase();
    const message = String(error?.data?.Message || error?.message || '').toLowerCase();
    return (
      code.includes('name') && code.includes('exist')
    ) || (
      message.includes('name') && message.includes('exist')
    ) || (
      message.includes('already') && message.includes('name')
    );
  }

  private async uploadCertificateToCas(
    casClient: any,
    certName: string,
    sslPub: string,
    sslPri: string,
  ) {
    const doUpload = async (name: string) => {
      const resp = await casClient.request(
        'UploadUserCertificate',
        {
          Name: name,
          Cert: sslPub,
          Key: sslPri,
        },
        {
          method: 'POST',
          timeout: 20000,
        },
      );
      const certIdRaw = resp?.CertId ?? resp?.CertificateId;
      const certId = Number(certIdRaw);
      if (!Number.isFinite(certId) || certId <= 0) {
        throw new InternalServerErrorException('CAS 上传证书成功但未返回有效 CertId');
      }
      return {
        certId,
        certName: name,
      };
    };

    try {
      return await doUpload(certName);
    } catch (error) {
      if (!this.isCertificateNameConflict(error)) {
        throw error;
      }
      const suffix = Date.now().toString().slice(-6);
      return await doUpload(`${certName}-${suffix}`);
    }
  }

  private normalizeHostToken(domainRaw: string): string {
    return String(domainRaw || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\.$/, '');
  }

  private normalizeCertificatePattern(domainRaw: string): string {
    const token = this.normalizeHostToken(domainRaw);
    if (!token) return '';
    if (token === '*') return '';
    if (token.startsWith('*.')) {
      return `*.${token.slice(2)}`;
    }
    return token;
  }

  private splitCertificateDomains(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map((item) => this.normalizeCertificatePattern(String(item)))
        .filter(Boolean);
    }
    return String(value)
      .split(/[,\s;|]+/)
      .map((item) => this.normalizeCertificatePattern(item))
      .filter(Boolean);
  }

  private certificatePatternCoversHost(patternRaw: string, hostRaw: string): boolean {
    const pattern = this.normalizeCertificatePattern(patternRaw);
    const host = this.normalizeHostToken(hostRaw);
    if (!pattern || !host) return false;
    if (pattern === host) return true;
    if (!pattern.startsWith('*.')) return false;

    const suffix = pattern.slice(2);
    if (!suffix || !host.endsWith(`.${suffix}`)) return false;

    const hostLabels = host.split('.').length;
    const suffixLabels = suffix.split('.').length;
    return hostLabels === suffixLabels + 1;
  }

  private rootDomainMatched(rootDomainRaw: string, certificateDomains: string[]): string[] {
    const root = this.normalizeHostToken(rootDomainRaw);
    return certificateDomains.filter((patternRaw) => {
      const pattern = this.normalizeCertificatePattern(patternRaw);
      if (!pattern) return false;
      if (pattern === root) return true;
      if (pattern === `*.${root}`) return true;
      return !pattern.startsWith('*.') && pattern.endsWith(`.${root}`);
    });
  }

  private collectCasCertificateRecords(payload: unknown, output: any[]) {
    if (payload == null) return;
    if (Array.isArray(payload)) {
      payload.forEach((item) => this.collectCasCertificateRecords(item, output));
      return;
    }
    if (typeof payload !== 'object') return;

    const obj = payload as Record<string, unknown>;
    const certId = obj.CertificateId ?? obj.CertId ?? obj.Id;
    const certName = obj.Name ?? obj.CertName ?? obj.CertificateName;
    const commonName = obj.CommonName ?? obj.CertDomainName ?? obj.DomainName;
    const sans = obj.Sans ?? obj.SubjectAlternativeName ?? obj.DomainList;
    const endDate = obj.EndDate ?? obj.CertExpireTime ?? obj.ExpireDate;

    if (certId || certName || commonName || sans || endDate) {
      output.push(obj);
    }

    Object.values(obj).forEach((value) => this.collectCasCertificateRecords(value, output));
  }

  private extractBooleanFlag(
    input: unknown,
    trueValues: string[] = ['on', 'enabled', 'true', '1'],
    falseValues: string[] = ['off', 'disabled', 'false', '0'],
  ): boolean | null {
    if (input == null) return null;
    const raw = String(input).trim().toLowerCase();
    if (!raw) return null;
    if (trueValues.includes(raw)) return true;
    if (falseValues.includes(raw)) return false;
    return null;
  }

  private extractWebsocketEnabled(payload: any): boolean | null {
    const domainConfigs = payload?.DomainConfigs?.DomainConfig;
    const configList = Array.isArray(domainConfigs) ? domainConfigs : [];
    const websocketConfig = configList.find(
      (item: any) => String(item?.FunctionName || '').toLowerCase() === 'websocket',
    );
    if (!websocketConfig) return null;
    const args = websocketConfig?.FunctionArgs?.FunctionArg;
    const argList = Array.isArray(args) ? args : [];
    const enabledArg = argList.find(
      (item: any) => String(item?.ArgName || '').toLowerCase() === 'enabled',
    );
    return this.extractBooleanFlag(enabledArg?.ArgValue);
  }

  private extractWafEnabled(payload: any, domainName: string): boolean | null {
    const listCandidates = [
      payload?.Domains?.PageData,
      payload?.Domains?.Domain,
      payload?.Domains?.Domains,
      payload?.Domains,
      payload?.PageData,
      payload?.Data,
    ];
    const list = listCandidates.find((item) => Array.isArray(item));
    const arrayList = Array.isArray(list) ? list : [];
    const normalizedDomain = domainName.toLowerCase();
    const target =
      arrayList.find((item: any) => {
        const rawDomain = String(
          item?.DomainName || item?.Domain || item?.domain || item?.domain_name || '',
        ).toLowerCase();
        return rawDomain === normalizedDomain;
      }) || arrayList[0] || payload;

    const statusValue =
      target?.DefenseStatus ??
      target?.Status ??
      target?.WafStatus ??
      target?.Enable ??
      target?.Enabled ??
      target?.WafEnable ??
      target?.DefenseEnabled;

    if (typeof statusValue === 'boolean') return statusValue;
    if (typeof statusValue === 'number') return statusValue > 0;
    return this.extractBooleanFlag(
      statusValue,
      ['on', 'enabled', 'open', 'true', '1'],
      ['off', 'disabled', 'close', 'false', '0'],
    );
  }

  private extractHttpsEnabled(payload: any): boolean | null {
    const candidates = [
      payload?.DomainDetail?.SSLProtocol,
      payload?.DomainDetail?.HttpsCnameStatus,
      payload?.SSLProtocol,
    ];
    const value = candidates.find((item) => item != null);
    return this.extractBooleanFlag(value);
  }

  private normalizeCertRegion(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'global' || normalized === 'overseas') return 'overseas';
    if (normalized === 'cn-hangzhou' || normalized === 'china') return 'china';
    return value;
  }

  private async getDcdnCnameCheck(client: any, domainName: string) {
    try {
      const resp = await client.request(
        'DescribeDcdnDomainCname',
        { DomainName: domainName },
        { method: 'GET', timeout: 10000 },
      );
      const data = Array.isArray(resp?.CnameDatas?.Data)
        ? resp.CnameDatas.Data
        : Array.isArray(resp?.Data)
          ? resp.Data
          : [];
      const target = data.find(
        (item: any) =>
          String(item?.Domain || item?.DomainName || '').toLowerCase() === domainName.toLowerCase(),
      );
      const item = target || data[0] || null;
      const statusRaw = item?.Status;
      const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
      const errMsg = item?.ErrMsg ? String(item.ErrMsg) : null;
      return {
        cnameCheckStatus: status,
        cnameCheckPassed: status === null ? null : status === 0,
        cnameCheckErrMsg: errMsg,
      };
    } catch (error) {
      return {
        cnameCheckStatus: null,
        cnameCheckPassed: null,
        cnameCheckErrMsg: this.extractAliyunErrorMessage(error, '读取 CNAME 检测状态失败'),
      };
    }
  }

  private async getDcdnCertificateInfo(client: any, domainName: string) {
    try {
      const resp = await client.request(
        'DescribeDcdnDomainCertificateInfo',
        { DomainName: domainName },
        { method: 'GET', timeout: 10000 },
      );
      const certList = Array.isArray(resp?.CertInfos?.CertInfo) ? resp.CertInfos.CertInfo : [];
      const target =
        certList.find(
          (item: any) =>
            String(item?.DomainName || item?.CertDomainName || '').toLowerCase() ===
            domainName.toLowerCase(),
        ) || certList[0] || null;
      const certStatusRaw =
        target?.Status ??
        target?.CertStatus ??
        target?.CertificateStatus ??
        resp?.Status ??
        resp?.CertStatus ??
        resp?.CertificateStatus;
      return {
        certName: target?.CertName ? String(target.CertName) : null,
        certId: target?.CertId ? String(target.CertId) : null,
        certRegion: this.normalizeCertRegion(target?.CertRegion ? String(target.CertRegion) : null),
        certType: target?.CertType ? String(target.CertType) : null,
        certStatus: certStatusRaw ? String(certStatusRaw) : null,
        certDomainName: target?.CertDomainName ? String(target.CertDomainName) : null,
        certExpireTime: target?.CertExpireTime ? String(target.CertExpireTime) : null,
      };
    } catch (error) {
      return {
        certName: null,
        certId: null,
        certRegion: null,
        certType: null,
        certStatus: null,
        certDomainName: null,
        certExpireTime: null,
        certInfoError: this.extractAliyunErrorMessage(error, '读取证书状态失败'),
      };
    }
  }

  private async getDcdnSecuritySnapshot(client: any, domainName: string) {
    let httpsEnabled: boolean | null = null;
    let websocketEnabled: boolean | null = null;
    let wafEnabled: boolean | null = null;
    let detailRespRaw: any = null;
    const warnings: string[] = [];

    try {
      const detailResp = await client.request(
        'DescribeDcdnDomainDetail',
        { DomainName: domainName },
        { method: 'GET', timeout: 10000 },
      );
      detailRespRaw = detailResp;
      httpsEnabled = this.extractHttpsEnabled(detailResp);
    } catch (error) {
      warnings.push(`读取 HTTPS 状态失败：${this.extractAliyunErrorMessage(error, 'unknown error')}`);
    }

    try {
      const websocketResp = await client.request(
        'DescribeDcdnDomainConfigs',
        {
          DomainName: domainName,
          FunctionNames: 'websocket',
        },
        { method: 'GET', timeout: 10000 },
      );
      websocketEnabled = this.extractWebsocketEnabled(websocketResp);
    } catch (error) {
      warnings.push(
        `读取 WebSocket 状态失败：${this.extractAliyunErrorMessage(error, 'unknown error')}`,
      );
    }

    try {
      const wafResp = await client.request(
        'DescribeDcdnWafDomains',
        {
          DomainName: domainName,
          PageSize: 50,
          PageNumber: 1,
        },
        { method: 'GET', timeout: 10000 },
      );
      wafEnabled = this.extractWafEnabled(wafResp, domainName);
    } catch (error) {
      warnings.push(`读取 WAF 状态失败：${this.extractAliyunErrorMessage(error, 'unknown error')}`);
    }

    const cnameCheck = await this.getDcdnCnameCheck(client, domainName);
    if (cnameCheck.cnameCheckErrMsg && cnameCheck.cnameCheckStatus == null) {
      warnings.push(`读取 CNAME 检测状态失败：${cnameCheck.cnameCheckErrMsg}`);
    }

    const certInfo = await this.getDcdnCertificateInfo(client, domainName);
    if ((certInfo as any).certInfoError) {
      warnings.push(`读取证书状态失败：${(certInfo as any).certInfoError}`);
    }

    return {
      httpsEnabled,
      websocketEnabled,
      wafEnabled,
      warnings,
      detailRespRaw,
      ...cnameCheck,
      ...certInfo,
    };
  }

  private async getDcdnDomainStatusInternal(client: any, domainName: string) {
    const statusResp = await client.request(
      'DescribeDcdnUserDomains',
      {
        DomainName: domainName,
        PageSize: 20,
        PageNumber: 1,
      },
      {
        method: 'GET',
        timeout: 10000,
      },
    );
    const domainInfo = this.extractDomainFromUserDomains(statusResp, domainName);
    const tags = this.formatTags(domainInfo?.Tags?.Tag || domainInfo?.Tags);
    const security = await this.getDcdnSecuritySnapshot(client, domainName);
    const derivedCertStatus =
      security.certStatus || (security.httpsEnabled && security.certName ? 'bound' : null);
    const originDomain = this.extractOriginDomainFromDomainInfo(domainInfo, security.detailRespRaw);

    return {
      domainName,
      fetchedAt: new Date().toISOString(),
      originDomain,
      cname: domainInfo?.Cname || domainInfo?.DomainCname || null,
      domainStatus: domainInfo?.DomainStatus || null,
      cnameCheckStatus: security.cnameCheckStatus,
      cnameCheckPassed: security.cnameCheckPassed,
      cnameCheckErrMsg: security.cnameCheckErrMsg,
      httpsEnabled: security.httpsEnabled,
      websocketEnabled: security.websocketEnabled,
      wafEnabled: security.wafEnabled,
      certName: security.certName,
      certId: security.certId,
      certRegion: security.certRegion,
      certType: security.certType,
      certStatus: derivedCertStatus,
      certDomainName: security.certDomainName,
      certExpireTime: security.certExpireTime,
      scope: domainInfo?.Scope || null,
      createdAt: domainInfo?.GmtCreated || null,
      updatedAt: domainInfo?.GmtModified || null,
      resourceGroupId: domainInfo?.ResourceGroupId || null,
      tags,
      warnings: security.warnings,
      raw: domainInfo || null,
    };
  }

  async provisionDcdnDomain(dto: ProvisionDcdnDomainDto): Promise<DcdnProvisionResult> {
    const domainName = this.normalizeToHost(dto.domainName);
    const originDomain = this.normalizeToHost(dto.originDomain);
    const scope = (dto.scope || 'global') as 'global' | 'domestic' | 'overseas';

    const client = this.createDcdnClient();
    const sourcePayload = JSON.stringify([
      {
        content: originDomain,
        type: 'domain',
        port: 443,
        priority: '20',
        weight: '10',
      },
    ]);

    let created = false;
    let verifyRequired = false;

    try {
      await client.request(
        'AddDcdnDomain',
        {
          DomainName: domainName,
          Sources: sourcePayload,
          Scope: scope,
        },
        {
          method: 'POST',
          timeout: 10000,
        },
      );
      created = true;
    } catch (error) {
      if (!this.isDomainAlreadyExistsError(error)) {
        console.error('AddDcdnDomain failed:', error);
        const msg = error?.message || error?.data?.Message || 'Failed to create DCDN domain';
        throw new InternalServerErrorException(msg);
      }
    }

    let cname: string | null = null;
    let domainStatus: string | null = null;
    let cnameCheckStatus: number | null = null;
    let cnameCheckPassed: boolean | null = null;
    let cnameCheckErrMsg: string | null = null;
    let httpsEnabled: boolean | null = null;
    let websocketEnabled: boolean | null = null;
    let wafEnabled: boolean | null = null;
    let certName: string | null = null;
    let certId: string | null = null;
    let certRegion: string | null = null;
    let certType: string | null = null;
    let certStatus: string | null = null;
    let certDomainName: string | null = null;
    let certExpireTime: string | null = null;
    let createdAt: string | null = null;
    let updatedAt: string | null = null;
    let resourceGroupId: string | null = null;
    let tags: Array<{ key: string; value: string }> = [];
    let warnings: string[] = [];
    try {
      const snapshot = await this.getDcdnDomainStatusInternal(client, domainName);
      cname = snapshot.cname;
      domainStatus = snapshot.domainStatus;
      cnameCheckStatus = snapshot.cnameCheckStatus;
      cnameCheckPassed = snapshot.cnameCheckPassed;
      cnameCheckErrMsg = snapshot.cnameCheckErrMsg;
      httpsEnabled = snapshot.httpsEnabled;
      websocketEnabled = snapshot.websocketEnabled;
      wafEnabled = snapshot.wafEnabled;
      certName = snapshot.certName;
      certId = snapshot.certId;
      certRegion = snapshot.certRegion;
      certType = snapshot.certType;
      certStatus = snapshot.certStatus;
      certDomainName = snapshot.certDomainName;
      certExpireTime = snapshot.certExpireTime;
      createdAt = snapshot.createdAt;
      updatedAt = snapshot.updatedAt;
      resourceGroupId = snapshot.resourceGroupId;
      tags = snapshot.tags;
      warnings = snapshot.warnings || [];
      if (!cname) verifyRequired = true;
    } catch (error) {
      console.warn('DescribeDcdnUserDomains failed:', error);
      verifyRequired = true;
    }

    return {
      domainName,
      originDomain,
      scope,
      created,
      cname,
      domainStatus,
      cnameCheckStatus,
      cnameCheckPassed,
      cnameCheckErrMsg,
      httpsEnabled,
      websocketEnabled,
      wafEnabled,
      certName,
      certId,
      certRegion,
      certType,
      certStatus,
      certDomainName,
      certExpireTime,
      createdAt,
      updatedAt,
      resourceGroupId,
      tags,
      verifyRequired,
      message: created
        ? 'DCDN 域名创建成功，请继续完成 DNS 与人工校验'
        : 'DCDN 域名已存在，已返回当前配置信息',
      warnings,
    };
  }

  async getDcdnDomainStatus(domainNameRaw: string) {
    const domainName = this.normalizeToHost(domainNameRaw);
    const client = this.createDcdnClient();
    try {
      return await this.getDcdnDomainStatusInternal(client, domainName);
    } catch (error) {
      console.error('DescribeDcdnUserDomains failed:', error);
      const msg = error?.message || error?.data?.Message || 'Failed to fetch DCDN domain status';
      throw new InternalServerErrorException(msg);
    }
  }

  async listCasCertificates(rootDomainRaw: string, targetDomainRaw?: string) {
    const rootDomain = this.normalizeToHost(rootDomainRaw);
    const targetDomain = targetDomainRaw ? this.normalizeToHost(targetDomainRaw) : null;
    const casClient = this.createCasClient();
    const requestList = async (orderType: 'UPLOAD' | 'CERT') => {
      try {
        return await casClient.request(
          'ListUserCertificateOrder',
          {
            CurrentPage: 1,
            ShowSize: 100,
            OrderType: orderType,
          },
          {
            method: 'POST',
            timeout: 15000,
          },
        );
      } catch (error) {
        console.warn(`ListUserCertificateOrder failed (${orderType}):`, error?.message || error);
        return null;
      }
    };

    const [uploadResp, certResp] = await Promise.all([requestList('UPLOAD'), requestList('CERT')]);
    const records: any[] = [];
    this.collectCasCertificateRecords(uploadResp, records);
    this.collectCasCertificateRecords(certResp, records);

    const uniqueMap = new Map<string, any>();
    records.forEach((item) => {
      const certId = Number(item?.CertificateId ?? item?.CertId ?? item?.Id);
      if (!Number.isFinite(certId) || certId <= 0) return;
      const name = String(item?.Name ?? item?.CertName ?? item?.CertificateName ?? '').trim();
      const commonName = String(item?.CommonName ?? item?.CertDomainName ?? item?.DomainName ?? '').trim();
      const sans = this.splitCertificateDomains(item?.Sans ?? item?.SubjectAlternativeName ?? item?.DomainList);
      const common = this.normalizeCertificatePattern(commonName);
      const domains = Array.from(new Set([common, ...sans].filter(Boolean)));
      const matchedDomains = targetDomain
        ? domains.filter((pattern) => this.certificatePatternCoversHost(pattern, targetDomain))
        : this.rootDomainMatched(rootDomain, domains);
      if (matchedDomains.length === 0) return;

      const endDateRaw = item?.EndDate ?? item?.CertExpireTime ?? item?.ExpireDate ?? null;
      const endDate = endDateRaw ? String(endDateRaw) : null;
      const key = String(certId);
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          certificateId: certId,
          certName: name || `cert-${certId}`,
          commonName: commonName || null,
          sans,
          matchedDomains,
          wildcardMatched: targetDomain
            ? matchedDomains.some((pattern) => pattern.startsWith('*.'))
            : null,
          endDate,
          orderType: String(item?.OrderType || item?.ProductType || '').toUpperCase() || null,
        });
      }
    });

    const certificates = Array.from(uniqueMap.values()).sort((a, b) => {
      const left = a.endDate ? new Date(a.endDate).getTime() : 0;
      const right = b.endDate ? new Date(b.endDate).getTime() : 0;
      return right - left;
    });

    return {
      rootDomain,
      targetDomain,
      total: certificates.length,
      certificates,
      fetchedAt: new Date().toISOString(),
    };
  }

  async applyDcdnSecurity(dto: ApplyDcdnSecurityDto) {
    const domainName = this.normalizeToHost(dto.domainName);
    const client = this.createDcdnClient();
    const certName = (dto.certName || `${domainName}-cert`).trim();
    const certSource = (dto.certSource || this.dcdnCertSourceDefault) as 'cas' | 'upload';
    const enableWebsocket = dto.enableWebsocket ?? true;
    const enableWaf = dto.enableWaf ?? true;

    const warnings: string[] = [];
    const errors: string[] = [];
    let httpsConfigured = false;
    let websocketConfigured = false;
    let wafConfigured = false;
    let appliedCertName = certName;
    let appliedCertId: number | null = null;
    const sslPub = dto.sslPub?.trim() || '';
    const sslPri = dto.sslPri?.trim() || '';
    const casCertificateId = dto.casCertificateId ? Number(dto.casCertificateId) : null;

    if (enableWebsocket && enableWaf) {
      warnings.push(
        '阿里云官方说明 WebSocket 与 WAF 可能存在互斥，请在测试环境先验证该组合可用性。',
      );
    }

    try {
      if (certSource === 'cas') {
        if (casCertificateId && Number.isFinite(casCertificateId) && casCertificateId > 0) {
          appliedCertId = casCertificateId;
          appliedCertName = (dto.casCertificateName || certName).trim();
        } else {
          if (!sslPub || !sslPri) {
            throw new BadRequestException('CAS 模式未选择复用证书时，必须提供 cert.crt 与 privkey.key');
          }
          const casClient = this.createCasClient();
          const casUpload = await this.uploadCertificateToCas(casClient, certName, sslPub, sslPri);
          appliedCertName = casUpload.certName;
          appliedCertId = casUpload.certId;
          if (appliedCertName !== certName) {
            warnings.push(`证书名称 ${certName} 已存在，已自动使用 ${appliedCertName}`);
          }
        }
        await client.request(
          'SetDcdnDomainSSLCertificate',
          {
            DomainName: domainName,
            SSLProtocol: 'on',
            CertType: 'cas',
            CertName: appliedCertName,
            CertId: String(appliedCertId),
            CertRegion: this.dcdnCertRegion,
          },
          {
            method: 'POST',
            timeout: 15000,
          },
        );
      } else {
        if (!sslPub || !sslPri) {
          throw new BadRequestException('直传模式必须提供 cert.crt 与 privkey.key');
        }
        await client.request(
          'SetDcdnDomainSSLCertificate',
          {
            DomainName: domainName,
            SSLProtocol: 'on',
            CertName: certName,
            CertType: 'upload',
            SSLPub: sslPub,
            SSLPri: sslPri,
          },
          {
            method: 'POST',
            timeout: 15000,
          },
        );
      }
      httpsConfigured = true;
    } catch (error) {
      errors.push(`HTTPS 证书配置失败：${this.extractAliyunErrorMessage(error, 'unknown error')}`);
    }

    if (enableWebsocket) {
      try {
        const functionArgs: Array<{ argName: string; argValue: string }> = [{ argName: 'enabled', argValue: 'on' }];
        if (dto.websocketOriginScheme) {
          functionArgs.push({ argName: 'origin_scheme', argValue: dto.websocketOriginScheme });
        }
        if (dto.websocketHeartbeat != null) {
          functionArgs.push({ argName: 'heartbeat', argValue: String(dto.websocketHeartbeat) });
        }

        await client.request(
          'BatchSetDcdnDomainConfigs',
          {
            DomainNames: domainName,
            Functions: JSON.stringify([
              {
                functionName: 'websocket',
                functionArgs,
              },
            ]),
          },
          {
            method: 'POST',
            timeout: 15000,
          },
        );
        websocketConfigured = true;
      } catch (error) {
        errors.push(
          `WebSocket 配置失败：${this.extractAliyunErrorMessage(error, 'unknown error')}`,
        );
      }
    }

    if (enableWaf) {
      try {
        const params: Record<string, string> = {
          DomainNames: domainName,
          DefenseStatus: 'on',
        };
        if (this.dcdnWafClientIpTag) {
          params.ClientIpTag = this.dcdnWafClientIpTag;
        }
        await client.request(
          'BatchSetDcdnWafDomainConfigs',
          params,
          {
            method: 'POST',
            timeout: 15000,
          },
        );
        wafConfigured = true;
      } catch (error) {
        errors.push(`WAF 配置失败：${this.extractAliyunErrorMessage(error, 'unknown error')}`);
      }
    }

    const status = await this.getDcdnDomainStatusInternal(client, domainName);
    if (certSource === 'upload' && !status.certRegion) {
      warnings.push('当前 DCDN 直传证书模式未返回证书地域。');
    }
    if (status.certName && appliedCertName && status.certName !== appliedCertName) {
      warnings.push(
        `证书名称与预期不一致，预期=${appliedCertName}，实际生效=${status.certName}。请确认是否选中了历史证书。`,
      );
    }

    return {
      domainName,
      certName: appliedCertName,
      certSource,
      certId: appliedCertId,
      httpsConfigured,
      websocketConfigured,
      wafConfigured,
      warnings: warnings.concat(status.warnings || []),
      errors,
      status,
      message:
        errors.length === 0
          ? 'DCDN HTTPS/WebSocket/WAF 配置已完成'
          : 'DCDN 安全配置部分失败，请根据 errors 排查',
    };
  }

  private normalizeAbsoluteHttpUrl(raw: string, fallbackPath = ''): string {
    const host = this.normalizeToHost(raw);
    const cleanPath = fallbackPath ? (fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`) : '';
    return `https://${host}${cleanPath}`;
  }

  private flattenLineRecords(payload: unknown, output: any[]) {
    if (payload == null) return;
    if (Array.isArray(payload)) {
      payload.forEach((item) => this.flattenLineRecords(item, output));
      return;
    }
    if (typeof payload !== 'object') return;

    const obj = payload as Record<string, unknown>;
    const hasLineShape =
      'lineUrl' in obj || 'line_url' in obj || 'tenantId' in obj || 'tenant_id' in obj || 'zh' in obj || 'en' in obj;
    if (hasLineShape) {
      output.push(obj);
    }
    Object.values(obj).forEach((value) => this.flattenLineRecords(value, output));
  }

  private normalizeLineRecord(raw: any) {
    const lineUrl = String(raw?.lineUrl ?? raw?.line_url ?? '').trim();
    const otcUrl = String(raw?.otcUrl ?? raw?.otc_url ?? '').trim();
    const zh = String(raw?.zh ?? raw?.nameZh ?? '').trim();
    const en = String(raw?.en ?? raw?.nameEn ?? '').trim();
    const tenantIdRaw = raw?.tenantId ?? raw?.tenant_id;
    const tenantId = Number.isFinite(Number(tenantIdRaw)) ? Number(tenantIdRaw) : null;
    const statusValue = raw?.status;
    const status = typeof statusValue === 'boolean'
      ? statusValue
      : String(statusValue).trim() === '1'
        ? true
        : String(statusValue).trim() === '0'
          ? false
          : String(statusValue).toLowerCase() === 'true'
            ? true
            : String(statusValue).toLowerCase() === 'false'
              ? false
              : null;
    const id = raw?.id ?? raw?.lineId ?? raw?.line_id ?? null;
    return {
      id,
      lineUrl,
      otcUrl,
      zh,
      en,
      tenantId,
      status,
      raw,
    };
  }

  private buildLineDiff(
    existing: { lineUrl: string; otcUrl: string; zh: string; en: string; status: boolean | null },
    incoming: { lineUrl: string; otcUrl: string; zh: string; en: string; status: boolean },
  ) {
    const differences: Array<{ field: string; existing: any; incoming: any }> = [];
    const pushIfDifferent = (field: 'lineUrl' | 'otcUrl' | 'zh' | 'en' | 'status') => {
      if (existing[field] !== incoming[field]) {
        differences.push({
          field,
          existing: existing[field],
          incoming: incoming[field],
        });
      }
    };
    pushIfDifferent('lineUrl');
    pushIfDifferent('otcUrl');
    pushIfDifferent('zh');
    pushIfDifferent('en');
    pushIfDifferent('status');
    return differences;
  }

  private async callSuperAdminService(
    environmentId: string,
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, any>,
    body?: any,
  ) {
    return await this.kubernetesService.requestServiceProxy(environmentId, {
      namespace: this.superAdminNamespace,
      serviceName: this.superAdminServiceName,
      port: this.superAdminServicePort,
      method,
      path,
      query,
      body,
      timeoutMs: 15000,
    });
  }

  private extractProxyStatusCode(error: any): number | null {
    const responseStatus = Number(error?.response?.status);
    if (Number.isFinite(responseStatus) && responseStatus > 0) {
      return responseStatus;
    }
    const message = String(error?.message || '');
    const matched = message.match(/failed\s+\((\d{3})\)/i);
    if (!matched) return null;
    const status = Number(matched[1]);
    return Number.isFinite(status) ? status : null;
  }

  private async fetchSuperAdminLineListRaw(
    environmentId: string,
    query: { page: number; size: number; lineUrl?: string; tenantId?: number },
  ) {
    return await this.callSuperAdminService(environmentId, 'GET', this.superAdminListPath, {
      page: query.page,
      size: query.size,
      lineUrl: query.lineUrl || '',
      tenantId: query.tenantId,
    });
  }

  async listSuperAdminLines(environmentId: string, query: ListSuperAdminLinesDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const size = query.size && query.size > 0 ? Math.min(query.size, 200) : 20;
    const lineUrl = query.lineUrl?.trim() || '';
    const tenantId = query.tenantId && query.tenantId > 0 ? query.tenantId : undefined;

    let response: { statusCode: number; body: any; headers: Record<string, any> };
    try {
      response = await this.fetchSuperAdminLineListRaw(environmentId, {
        page,
        size,
        lineUrl,
        tenantId,
      });
    } catch (error) {
      const code = this.extractProxyStatusCode(error);
      if (code === 401 || code === 403) {
        throw new BadRequestException(
          `查询线路接口无权限（${code}）。请确认当前环境(${environmentId})的 kubeContext 是否正确，且接口 ${this.superAdminListPath} 在该集群内允许访问。`,
        );
      }
      throw error;
    }
    const records: any[] = [];
    this.flattenLineRecords(response.body, records);

    const items: SuperAdminLineItem[] = records
      .map((item) => this.normalizeLineRecord(item))
      .filter((item) => item.lineUrl)
      .filter((item) => (tenantId ? item.tenantId === tenantId : true))
      .map((item) => ({
        id: item.id,
        zh: item.zh,
        en: item.en,
        lineUrl: item.lineUrl,
        otcUrl: item.otcUrl,
        status: item.status,
        tenantId: item.tenantId,
      }));

    const totalCandidates = [
      response.body?.total,
      response.body?.count,
      response.body?.data?.total,
      response.body?.data?.count,
      response.body?.data?.totalCount,
      response.body?.pagination?.total,
      response.body?.page?.total,
    ];
    const totalRaw = totalCandidates.find((item) => Number.isFinite(Number(item)));
    const total = totalRaw ? Number(totalRaw) : items.length;

    return {
      page,
      size,
      total,
      tenantId: tenantId || null,
      lineUrl: lineUrl || null,
      items,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async findExistingSuperAdminLine(
    environmentId: string,
    lineUrl: string,
    tenantId: number,
  ) {
    try {
      const listResult = await this.listSuperAdminLines(environmentId, {
        page: 1,
        size: 200,
        lineUrl,
        tenantId,
      });
      const records = listResult.items;
      const lineHost = this.normalizeToHost(lineUrl);
      const candidates = records
        .map((item) => this.normalizeLineRecord(item))
        .filter(
          (item) =>
            item.tenantId === tenantId &&
            item.lineUrl &&
            this.normalizeToHost(item.lineUrl) === lineHost,
        );
      return {
        existing: candidates[0] || null,
        detectionUnavailable: false,
        detectionError: null,
      };
    } catch (error) {
      const code = this.extractProxyStatusCode(error);
      if (code === 401 || code === 403) {
        return {
          existing: null,
          detectionUnavailable: true,
          detectionError: `线路查询接口无权限（${code}）`,
        };
      }
      throw error;
    }
  }

  private async tryUpdateSuperAdminLine(
    environmentId: string,
    existingId: string | number | null,
    payload: any,
  ) {
    const updatePayload = existingId == null ? payload : { ...payload, id: existingId };
    for (const path of this.superAdminUpdatePathCandidates) {
      try {
        await this.callSuperAdminService(environmentId, 'POST', path, undefined, updatePayload);
        return { ok: true, path };
      } catch (error) {
        // try next candidate endpoint
      }
    }
    return { ok: false, path: null };
  }

  async registerSuperAdminLine(environmentId: string, dto: RegisterSuperAdminLineDto) {
    const normalizedLineUrl = this.normalizeAbsoluteHttpUrl(dto.lineUrl);
    const normalizedOtcUrl = (() => {
      if (!dto.otcUrl) return `${normalizedLineUrl}/otc`;
      const value = dto.otcUrl.trim();
      try {
        const withSchema = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        const parsed = new URL(withSchema);
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
        const search = parsed.search || '';
        return `https://${hostname}${pathname}${search}`;
      } catch {
        throw new BadRequestException('otcUrl format is invalid');
      }
    })();
    const payload = {
      zh: dto.zh.trim(),
      en: dto.en.trim(),
      lineUrl: normalizedLineUrl,
      financialUrl: '',
      csUrl: '',
      otcUrl: normalizedOtcUrl,
      status: dto.status,
      tenantId: dto.tenantId,
    };
    const mode = dto.mode || 'detect';

    const lookup = await this.findExistingSuperAdminLine(
      environmentId,
      normalizedLineUrl,
      dto.tenantId,
    );
    const existing = lookup.existing;

    if (lookup.detectionUnavailable) {
      if (mode === 'update') {
        throw new BadRequestException('无法查询已有线路，暂不支持自动更新，请改为人工处理。');
      }
      try {
        await this.callSuperAdminService(environmentId, 'POST', this.superAdminAddPath, undefined, payload);
        return {
          action: 'created',
          message: '超级后台线路登记成功（查询接口无权限，已直接尝试创建）',
          payload,
          warnings: [lookup.detectionError],
        };
      } catch (error) {
        if (this.isDomainAlreadyExistsError(error)) {
          return {
            action: 'conflict',
            message: '已存在同线路，但当前无查询权限，无法展示差异。请人工确认或开通查询权限后重试。',
            payload,
            canUpdate: false,
          };
        }
        throw new BadRequestException(this.extractAliyunErrorMessage(error, '超级后台登记失败'));
      }
    }

    if (!existing) {
      await this.callSuperAdminService(environmentId, 'POST', this.superAdminAddPath, undefined, payload);
      return {
        action: 'created',
        message: '超级后台线路登记成功',
        payload,
      };
    }

    const existingComparable = {
      lineUrl: this.normalizeAbsoluteHttpUrl(existing.lineUrl),
      otcUrl: existing.otcUrl || '',
      zh: existing.zh || '',
      en: existing.en || '',
      status: existing.status === null ? false : existing.status,
    };
    const incomingComparable = {
      lineUrl: payload.lineUrl,
      otcUrl: payload.otcUrl,
      zh: payload.zh,
      en: payload.en,
      status: payload.status,
    };
    const differences = this.buildLineDiff(existingComparable, incomingComparable);

    if (differences.length === 0) {
      return {
        action: 'unchanged',
        message: '超级后台已存在相同线路配置，无需更新',
        existing: existing.raw,
        payload,
      };
    }

    if (mode !== 'update') {
      return {
        action: 'conflict',
        message: '超级后台已存在同线路，但字段有差异，请确认是否更新',
        existing: existing.raw,
        payload,
        differences,
        canUpdate: true,
      };
    }

    const updated = await this.tryUpdateSuperAdminLine(environmentId, existing.id, payload);
    if (!updated.ok) {
      throw new BadRequestException(
        '检测到已有线路且存在差异，但自动更新失败（未匹配到可用更新接口）。请人工到超级后台修改。',
      );
    }

    return {
      action: 'updated',
      message: `超级后台线路已更新（${updated.path}）`,
      existing: existing.raw,
      payload,
      differences,
    };
  }

  private collectHosts(payload: unknown, result: Set<string>) {
    if (payload == null) return;

    if (typeof payload === 'string') {
      const text = payload.toLowerCase();
      const hostMatches = text.match(/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/g);
      if (hostMatches) {
        hostMatches.forEach((host) => result.add(host));
      }
      return;
    }

    if (Array.isArray(payload)) {
      payload.forEach((item) => this.collectHosts(item, result));
      return;
    }

    if (typeof payload === 'object') {
      Object.values(payload as Record<string, unknown>).forEach((value) =>
        this.collectHosts(value, result),
      );
    }
  }

  async verifyLineByExternalApi(lineUrl: string) {
    const targetHost = this.normalizeToHost(lineUrl);
    if (!this.lineVerifyApiUrl) {
      throw new InternalServerErrorException('LINE_VERIFY_API_URL is not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(this.lineVerifyApiUrl, {
          timeout: 10000,
        }),
      );
      const collectedHosts = new Set<string>();
      this.collectHosts(response.data, collectedHosts);
      const hosts = Array.from(collectedHosts);
      const exists = hosts.includes(targetHost);

      return {
        targetHost,
        exists,
        checkedAt: new Date().toISOString(),
        sourceApi: this.lineVerifyApiUrl,
        matchedHosts: exists ? [targetHost] : [],
        discoveredHosts: hosts.slice(0, 100),
      };
    } catch (error) {
      console.error('Error verifying line via external API:', error);
      throw new InternalServerErrorException('Failed to verify line via external API');
    }
  }
}
