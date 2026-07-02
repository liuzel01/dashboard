import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { createHash, createHmac } from 'crypto';
const { RPCClient } = require('@alicloud/pop-core');
import type * as mysql from 'mysql2/promise';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import {
  CreateAssetAccountDto,
  CreateAssetDomainDto,
  CreateAssetResourceDto,
  CreateCredentialRefDto,
  ListAssetsDto,
  ListChangeLogsDto,
  SyncAccountDomainsDto,
  SyncWangsuDomainsDto,
  SyncAliyunDcdnDomainsDto,
  UpdateAssetAccountDto,
  UpdateAssetDomainDto,
  UpdateAssetResourceDto,
  UpdateCredentialRefDto,
} from './dto/asset.dto';

type ActorContext = {
  userId: number;
  username: string;
  permissions: string[];
  roles: string[];
};

type AssetConfig = {
  assetType: string;
  table: string;
  fields: string[];
  requiredField: string;
  defaultValues: Record<string, unknown>;
  keywordFields: string[];
  typeField?: string;
  providerField?: string;
  environmentField?: string;
  tenantField?: string;
  ownerField?: string;
  statusField?: string;
};

type DbRow = Record<string, any>;

type WangsuDomainPreviewItem = {
  domain: string;
  domainId?: string;
  cname?: string;
  serviceType?: string;
  status?: string;
  cdnServiceStatus?: string;
  enabled?: string;
  lastModified?: string;
  billingAreas?: string;
  provider: 'wangsu';
  raw: Record<string, unknown>;
};

type AliyunDcdnDomainPreviewItem = {
  provider: 'aliyun_dcdn';
  accountId?: number;
  accountName?: string;
  accountIdentifier?: string;
  domain: string;
  domainId?: string;
  cname?: string;
  status?: string;
  sslProtocol?: string;
  gmtCreated?: string;
  gmtModified?: string;
  resourceGroupId?: string;
  description?: string;
  sources?: unknown;
  raw: Record<string, unknown>;
};

const MENU_PERMISSION = 'menu:asset-management';

const accountConfig: AssetConfig = {
  assetType: 'account',
  table: 'asset_accounts',
  fields: [
    'account_name',
    'account_type',
    'provider',
    'login_url',
    'account_identifier',
    'owner',
    'department',
    'usage_scope',
    'environment_scope',
    'credential_ref_id',
    'mfa_enabled',
    'status',
    'remark',
  ],
  requiredField: 'account_name',
  defaultValues: { account_type: 'other', mfa_enabled: false, status: 'active' },
  keywordFields: ['account_name', 'provider', 'account_identifier', 'owner', 'department', 'usage_scope', 'remark'],
  typeField: 'account_type',
  providerField: 'provider',
  environmentField: 'environment_scope',
  ownerField: 'owner',
  statusField: 'status',
};

const resourceConfig: AssetConfig = {
  assetType: 'resource',
  table: 'asset_resources',
  fields: [
    'resource_name',
    'resource_type',
    'provider',
    'account_id',
    'resource_identifier',
    'console_url',
    'environment',
    'tenant',
    'business',
    'usage_desc',
    'owner',
    'status',
    'remark',
  ],
  requiredField: 'resource_name',
  defaultValues: { resource_type: 'other', status: 'active' },
  keywordFields: ['resource_name', 'provider', 'resource_identifier', 'environment', 'tenant', 'business', 'owner', 'remark'],
  typeField: 'resource_type',
  providerField: 'provider',
  environmentField: 'environment',
  tenantField: 'tenant',
  ownerField: 'owner',
  statusField: 'status',
};

const domainConfig: AssetConfig = {
  assetType: 'domain',
  table: 'asset_domains',
  fields: [
    'domain',
    'root_domain',
    'provider',
    'account_id',
    'resource_id',
    'icp_status',
    'icp_entity',
    'dns_provider',
    'cdn_provider',
    'environment',
    'tenant',
    'business',
    'usage_desc',
    'owner',
    'status',
    'remark',
  ],
  requiredField: 'domain',
  defaultValues: { icp_status: 'unknown', status: 'unknown' },
  keywordFields: ['domain', 'root_domain', 'provider', 'icp_entity', 'dns_provider', 'cdn_provider', 'environment', 'tenant', 'business', 'owner', 'remark'],
  providerField: 'provider',
  environmentField: 'environment',
  tenantField: 'tenant',
  ownerField: 'owner',
  statusField: 'status',
};

const credentialRefConfig: AssetConfig = {
  assetType: 'credential_ref',
  table: 'credential_refs',
  fields: [
    'ref_name',
    'ref_type',
    'storage_type',
    'storage_path',
    'related_account_id',
    'visibility_level',
    'owner',
    'remark',
  ],
  requiredField: 'ref_name',
  defaultValues: { ref_type: 'other', storage_type: 'other' },
  keywordFields: ['ref_name', 'ref_type', 'storage_type', 'storage_path', 'visibility_level', 'owner', 'remark'],
  typeField: 'ref_type',
  ownerField: 'owner',
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
    private readonly siteConf: SiteConfService,
  ) {}

  async resolveActorFromAuthorization(authorization?: string): Promise<ActorContext> {
    const auth = String(authorization || '');
    if (!auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7).trim();
    const payload = await this.authService.verifyToken(token);

    let userId: number;
    if (payload.source === 'keycloak' || typeof payload.sub !== 'number') {
      const user = await this.accessControl.ensureUserByUsername(payload.username, {
        displayName: payload.displayName,
      });
      userId = user.id;
    } else {
      userId = Number(payload.sub);
    }

    const me = await this.accessControl.getMe({ userId });
    const actor: ActorContext = {
      userId: Number(me.id),
      username: String(me.username || payload.username || ''),
      permissions: Array.isArray(me.permissions) ? me.permissions.map((v: any) => String(v)) : [],
      roles: Array.isArray(me.roles)
        ? me.roles.map((role: any) => String(role?.name || role || '')).filter(Boolean)
        : [],
    };
    this.ensureAssetPermission(actor);
    return actor;
  }

  async previewWangsuDomains(actor: ActorContext) {
    this.ensureAssetPermission(actor);
    const enabled = await this.siteConf.getBoolean('cdn.wangsu.enabled', false);
    const endpoint = (await this.siteConf.getString('cdn.wangsu.endpoint', 'https://open.chinanetcenter.com')).replace(/\/+$/, '');
    const accessKeyId = (await this.siteConf.getString('cdn.wangsu.access_key_id', '')).trim();
    const accessKeySecret = (await this.siteConf.getString('cdn.wangsu.access_key_secret', '')).trim();
    const username = (await this.siteConf.getString('cdn.wangsu.username', '')).trim();
    const apiKey = (await this.siteConf.getString('cdn.wangsu.api_key', '')).trim();
    const timeoutMs = await this.siteConf.getNumber('cdn.wangsu.timeout_ms', 15000);
    if ((!accessKeyId || !accessKeySecret) && (!username || !apiKey)) {
      throw new BadRequestException('Wangsu CDN credentials are incomplete. Configure cdn.wangsu.access_key_id/access_key_secret for AKSK, or cdn.wangsu.username/api_key for legacy auth.');
    }

    const url = `${endpoint}/api/domain`;
    const headers = accessKeyId && accessKeySecret
      ? this.buildWangsuAkskHeaders({ endpoint, method: 'GET', path: '/api/domain', accessKeyId, accessKeySecret })
      : this.buildWangsuBasicHeaders({ username, apiKey });
    const response = await axios.get(url, {
      timeout: timeoutMs,
      headers,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new BadRequestException(`Wangsu API request failed: HTTP ${response.status} ${this.summarizeWangsuError(response.data)}`);
    }

    const body = String(response.data || '');
    const items = this.parseWangsuDomainResponse(body);
    return {
      provider: 'wangsu',
      endpoint,
      enabled,
      fetchedAt: new Date().toISOString(),
      total: items.length,
      items,
    };
  }

  async syncWangsuDomains(actor: ActorContext, dto: SyncWangsuDomainsDto = {}) {
    this.ensureAssetPermission(actor);
    const preview = await this.previewWangsuDomains(actor);
    const dryRun = dto.dryRun !== false;
    const planned = preview.items.map((item) => this.buildWangsuDomainSyncPayload(item));

    return this.db.withTransaction(async (conn) => {
      const summary = { total: planned.length, created: 0, updated: 0, unchanged: 0, dryRun };
      const items: Array<{ domain: string; action: 'create' | 'update' | 'unchanged'; id?: number; before?: DbRow | null; after: Record<string, unknown> }> = [];

      for (const payload of planned) {
        const before = await this.findDomainByDomain(conn, String(payload.domain));
        if (!before) {
          summary.created += 1;
          items.push({ domain: String(payload.domain), action: 'create', after: payload });
          if (!dryRun) {
            const columns = Object.keys(payload);
            const result = await conn.execute<mysql.ResultSetHeader>(
              `INSERT INTO asset_domains (${columns.join(', ')}, created_by, updated_by, created_at, updated_at) VALUES (${columns.map(() => '?').join(', ')}, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
              [...columns.map((column) => payload[column]), actor.username, actor.username],
            );
            const id = result[0].insertId;
            const after = await this.getRowById(conn, domainConfig, id, true);
            await this.insertChangeLog(conn, { actor, assetType: 'domain', assetId: id, action: 'sync_wangsu_create', beforeData: null, afterData: after, remark: 'sync from wangsu cdn preview' });
            items[items.length - 1] = { domain: String(payload.domain), action: 'create', id, after: after || payload };
          }
          continue;
        }

        const patch = this.diffDomainPayload(before, payload);
        if (Object.keys(patch).length === 0) {
          summary.unchanged += 1;
          items.push({ domain: String(payload.domain), action: 'unchanged', id: Number(before.id), before, after: before });
          continue;
        }

        summary.updated += 1;
        items.push({ domain: String(payload.domain), action: 'update', id: Number(before.id), before, after: { ...before, ...patch } });
        if (!dryRun) {
          const keys = Object.keys(patch);
          await conn.execute(
            `UPDATE asset_domains SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_by = ?, updated_at = UTC_TIMESTAMP(), deleted_at = NULL WHERE id = ?`,
            [...keys.map((key) => patch[key]), actor.username, Number(before.id)],
          );
          const after = await this.getRowById(conn, domainConfig, Number(before.id), true);
          await this.insertChangeLog(conn, { actor, assetType: 'domain', assetId: Number(before.id), action: 'sync_wangsu_update', beforeData: before, afterData: after, remark: 'sync from wangsu cdn preview' });
          items[items.length - 1] = { domain: String(payload.domain), action: 'update', id: Number(before.id), before, after: after || { ...before, ...patch } };
        }
      }

      return { provider: 'wangsu', fetchedAt: preview.fetchedAt, summary, items };
    });
  }

  async previewAliyunDcdnDomains(actor: ActorContext) {
    this.ensureAssetPermission(actor);
    const client = await this.createAliyunDcdnClient();
    const timeoutMs = await this.getAliyunTimeoutMs();
    const pageSize = 100;
    let pageNumber = 1;
    const items: AliyunDcdnDomainPreviewItem[] = [];
    let totalCount = 0;

    do {
      const resp = await client.request('DescribeDcdnUserDomains', { PageNumber: pageNumber, PageSize: pageSize }, { method: 'GET', timeout: timeoutMs });
      totalCount = Number(resp?.TotalCount || 0);
      const pageData = resp?.Domains?.PageData || [];
      const rows = Array.isArray(pageData) ? pageData : [pageData].filter(Boolean);
      items.push(...rows.map((row: Record<string, unknown>) => this.parseAliyunDcdnDomain(row)).filter((item: AliyunDcdnDomainPreviewItem | null): item is AliyunDcdnDomainPreviewItem => Boolean(item)));
      pageNumber += 1;
    } while (items.length < totalCount && pageNumber <= 1000);

    return {
      provider: 'aliyun_dcdn',
      endpoint: await this.getAliyunDcdnEndpoint(),
      fetchedAt: new Date().toISOString(),
      total: items.length,
      totalCount,
      items,
    };
  }

  async syncAliyunDcdnDomains(actor: ActorContext, dto: SyncAliyunDcdnDomainsDto = {}) {
    this.ensureAssetPermission(actor);
    const preview = await this.previewAliyunDcdnDomains(actor);
    const dryRun = dto.dryRun !== false;
    const planned = preview.items.map((item) => this.buildAliyunDcdnDomainSyncPayload(item));

    return this.db.withTransaction(async (conn) => {
      const summary = { total: planned.length, created: 0, updated: 0, unchanged: 0, conflicts: 0, dryRun };
      const items: Array<{ domain: string; action: 'create' | 'update' | 'unchanged' | 'provider_conflict'; id?: number; before?: DbRow | null; after: Record<string, unknown>; conflictProvider?: string | null }> = [];

      for (const payload of planned) {
        const domain = String(payload.domain);
        const before = await this.findDomainByDomain(conn, domain);
        if (!before) {
          summary.created += 1;
          items.push({ domain, action: 'create', after: payload });
          if (!dryRun) {
            const columns = Object.keys(payload);
            const result = await conn.execute<mysql.ResultSetHeader>(
              `INSERT INTO asset_domains (${columns.join(', ')}, created_by, updated_by, created_at, updated_at) VALUES (${columns.map(() => '?').join(', ')}, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
              [...columns.map((column) => payload[column]), actor.username, actor.username],
            );
            const id = result[0].insertId;
            const after = await this.getRowById(conn, domainConfig, id, true);
            await this.insertChangeLog(conn, { actor, assetType: 'domain', assetId: id, action: 'sync_aliyun_dcdn_create', beforeData: null, afterData: after, remark: 'sync from aliyun dcdn preview' });
            items[items.length - 1] = { domain, action: 'create', id, after: after || payload };
          }
          continue;
        }

        const beforeProvider = before.cdn_provider === undefined || before.cdn_provider === null ? '' : String(before.cdn_provider);
        if (beforeProvider && beforeProvider !== 'aliyun_dcdn') {
          summary.conflicts += 1;
          items.push({ domain, action: 'provider_conflict', id: Number(before.id), before, after: before, conflictProvider: beforeProvider });
          continue;
        }

        const patch = this.diffDomainPayload(before, payload);
        if (Object.keys(patch).length === 0) {
          summary.unchanged += 1;
          items.push({ domain, action: 'unchanged', id: Number(before.id), before, after: before });
          continue;
        }

        summary.updated += 1;
        items.push({ domain, action: 'update', id: Number(before.id), before, after: { ...before, ...patch } });
        if (!dryRun) {
          const keys = Object.keys(patch);
          await conn.execute(
            `UPDATE asset_domains SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_by = ?, updated_at = UTC_TIMESTAMP(), deleted_at = NULL WHERE id = ?`,
            [...keys.map((key) => patch[key]), actor.username, Number(before.id)],
          );
          const after = await this.getRowById(conn, domainConfig, Number(before.id), true);
          await this.insertChangeLog(conn, { actor, assetType: 'domain', assetId: Number(before.id), action: 'sync_aliyun_dcdn_update', beforeData: before, afterData: after, remark: 'sync from aliyun dcdn preview' });
          items[items.length - 1] = { domain, action: 'update', id: Number(before.id), before, after: after || { ...before, ...patch } };
        }
      }

      return { provider: 'aliyun_dcdn', fetchedAt: preview.fetchedAt, summary, items };
    });
  }

  async previewAccountAliyunDcdnDomains(actor: ActorContext, accountId: number) {
    this.ensureAssetPermission(actor);
    const account = await this.getSyncableAccount(accountId, 'aliyun');
    const credentials = await this.resolveAccountSiteConfCredentials(account);
    const client = await this.createAliyunDcdnClient(credentials);
    const timeoutMs = await this.getAliyunTimeoutMs();
    const pageSize = 100;
    let pageNumber = 1;
    const items: AliyunDcdnDomainPreviewItem[] = [];
    let totalCount = 0;

    do {
      const resp = await client.request('DescribeDcdnUserDomains', { PageNumber: pageNumber, PageSize: pageSize }, { method: 'GET', timeout: timeoutMs });
      totalCount = Number(resp?.TotalCount || 0);
      const pageData = resp?.Domains?.PageData || [];
      const rows = Array.isArray(pageData) ? pageData : [pageData].filter(Boolean);
      items.push(...rows
        .map((row: Record<string, unknown>) => this.parseAliyunDcdnDomain(row, {
          accountId: Number(account.id),
          accountName: String(account.account_name || ''),
          accountIdentifier: String(account.account_identifier || ''),
        }))
        .filter((item: AliyunDcdnDomainPreviewItem | null): item is AliyunDcdnDomainPreviewItem => Boolean(item)));
      pageNumber += 1;
    } while (items.length < totalCount && pageNumber <= 1000);

    return {
      provider: 'aliyun_dcdn',
      account: {
        id: Number(account.id),
        account_name: String(account.account_name || ''),
        account_identifier: String(account.account_identifier || ''),
        provider: String(account.provider || ''),
      },
      endpoint: credentials.endpoint,
      fetchedAt: new Date().toISOString(),
      total: items.length,
      totalCount,
      items,
    };
  }

  async syncAccountAliyunDcdnDomains(actor: ActorContext, accountId: number, dto: SyncAccountDomainsDto = {}) {
    this.ensureAssetPermission(actor);
    const preview = await this.previewAccountAliyunDcdnDomains(actor, accountId);
    const dryRun = dto.dryRun !== false;
    const planned = preview.items.map((item) => this.buildAliyunDcdnDomainSyncPayload(item, {
      accountId: preview.account.id,
      accountIdentifier: preview.account.account_identifier,
    }));

    return this.db.withTransaction(async (conn) => {
      const summary = { total: planned.length, created: 0, updated: 0, unchanged: 0, conflicts: 0, dryRun };
      const items: Array<{ domain: string; action: 'create' | 'update' | 'unchanged' | 'provider_conflict'; id?: number; conflictProvider?: string | null }> = [];

      for (const payload of planned) {
        const domain = String(payload.domain);
        const before = await this.findDomainByDomain(conn, domain);
        if (!before) {
          summary.created += 1;
          items.push({ domain, action: 'create' });
          if (!dryRun) {
            const columns = Object.keys(payload);
            const result = await conn.execute<mysql.ResultSetHeader>(
              `INSERT INTO asset_domains (${columns.join(', ')}, created_by, updated_by, created_at, updated_at) VALUES (${columns.map(() => '?').join(', ')}, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
              [...columns.map((column) => payload[column]), actor.username, actor.username],
            );
            const id = result[0].insertId;
            const after = await this.getRowById(conn, domainConfig, id, true);
            await this.insertChangeLog(conn, { actor, assetType: 'domain', assetId: id, action: 'sync_account_aliyun_dcdn_create', beforeData: null, afterData: after, remark: `sync from aliyun dcdn account ${preview.account.account_identifier}` });
            items[items.length - 1] = { domain, action: 'create', id };
          }
          continue;
        }

        const beforeProvider = before.cdn_provider === undefined || before.cdn_provider === null ? '' : String(before.cdn_provider);
        if (beforeProvider && beforeProvider !== 'aliyun_dcdn') {
          summary.conflicts += 1;
          items.push({ domain, action: 'provider_conflict', id: Number(before.id), conflictProvider: beforeProvider });
          continue;
        }

        const patch = this.diffDomainPayload(before, payload, ['environment', 'tenant', 'business', 'owner', 'usage_desc']);
        if (Object.keys(patch).length === 0) {
          summary.unchanged += 1;
          items.push({ domain, action: 'unchanged', id: Number(before.id) });
          continue;
        }

        summary.updated += 1;
        items.push({ domain, action: 'update', id: Number(before.id) });
        if (!dryRun) {
          const keys = Object.keys(patch);
          await conn.execute(
            `UPDATE asset_domains SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_by = ?, updated_at = UTC_TIMESTAMP(), deleted_at = NULL WHERE id = ?`,
            [...keys.map((key) => patch[key]), actor.username, Number(before.id)],
          );
          const after = await this.getRowById(conn, domainConfig, Number(before.id), true);
          await this.insertChangeLog(conn, { actor, assetType: 'domain', assetId: Number(before.id), action: 'sync_account_aliyun_dcdn_update', beforeData: before, afterData: after, remark: `sync from aliyun dcdn account ${preview.account.account_identifier}` });
        }
      }

      return { provider: 'aliyun_dcdn', account: preview.account, fetchedAt: preview.fetchedAt, summary, items };
    });
  }

  async getOverview(actor: ActorContext) {
    this.ensureAssetPermission(actor);
    const [accountStats, resourceStats, domainStats, credentialStats, ownerStats, recentChanges] =
      await Promise.all([
        this.countByStatus(accountConfig),
        this.countByStatus(resourceConfig),
        this.countByStatus(domainConfig),
        this.countByStatus(credentialRefConfig),
        this.countMissingOwners(),
        this.db.query<DbRow[]>(
          `SELECT id, asset_type, asset_id, action, operator, remark, created_at
           FROM asset_change_logs
           ORDER BY created_at DESC, id DESC
           LIMIT 10`,
        ),
      ]);

    return {
      accounts: accountStats,
      resources: resourceStats,
      domains: domainStats,
      credentialRefs: credentialStats,
      missingOwners: ownerStats,
      recentChanges,
    };
  }

  listAccounts(actor: ActorContext, query: ListAssetsDto) {
    return this.listRows(actor, accountConfig, query);
  }

  createAccount(actor: ActorContext, dto: CreateAssetAccountDto) {
    return this.createRow(actor, accountConfig, dto as unknown as Record<string, unknown>);
  }

  updateAccount(actor: ActorContext, id: number, dto: UpdateAssetAccountDto) {
    return this.updateRow(actor, accountConfig, id, dto as unknown as Record<string, unknown>);
  }

  deleteAccount(actor: ActorContext, id: number) {
    return this.softDeleteRow(actor, accountConfig, id);
  }

  restoreAccount(actor: ActorContext, id: number) {
    return this.restoreRow(actor, accountConfig, id);
  }

  listResources(actor: ActorContext, query: ListAssetsDto) {
    return this.listRows(actor, resourceConfig, query);
  }

  createResource(actor: ActorContext, dto: CreateAssetResourceDto) {
    return this.createRow(actor, resourceConfig, dto as unknown as Record<string, unknown>);
  }

  updateResource(actor: ActorContext, id: number, dto: UpdateAssetResourceDto) {
    return this.updateRow(actor, resourceConfig, id, dto as unknown as Record<string, unknown>);
  }

  deleteResource(actor: ActorContext, id: number) {
    return this.softDeleteRow(actor, resourceConfig, id);
  }

  restoreResource(actor: ActorContext, id: number) {
    return this.restoreRow(actor, resourceConfig, id);
  }

  listDomains(actor: ActorContext, query: ListAssetsDto) {
    return this.listRows(actor, domainConfig, query);
  }

  createDomain(actor: ActorContext, dto: CreateAssetDomainDto) {
    return this.createRow(actor, domainConfig, dto as unknown as Record<string, unknown>);
  }

  updateDomain(actor: ActorContext, id: number, dto: UpdateAssetDomainDto) {
    return this.updateRow(actor, domainConfig, id, dto as unknown as Record<string, unknown>);
  }

  deleteDomain(actor: ActorContext, id: number) {
    return this.softDeleteRow(actor, domainConfig, id);
  }

  restoreDomain(actor: ActorContext, id: number) {
    return this.restoreRow(actor, domainConfig, id);
  }

  listCredentialRefs(actor: ActorContext, query: ListAssetsDto) {
    return this.listRows(actor, credentialRefConfig, query);
  }

  createCredentialRef(actor: ActorContext, dto: CreateCredentialRefDto) {
    return this.createRow(actor, credentialRefConfig, dto as unknown as Record<string, unknown>);
  }

  updateCredentialRef(actor: ActorContext, id: number, dto: UpdateCredentialRefDto) {
    return this.updateRow(actor, credentialRefConfig, id, dto as unknown as Record<string, unknown>);
  }

  deleteCredentialRef(actor: ActorContext, id: number) {
    return this.softDeleteRow(actor, credentialRefConfig, id);
  }

  restoreCredentialRef(actor: ActorContext, id: number) {
    return this.restoreRow(actor, credentialRefConfig, id);
  }

  async listChangeLogs(actor: ActorContext, query: ListChangeLogsDto) {
    this.ensureAssetPermission(actor);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)));
    const where = ['1=1'];
    const params: any[] = [];

    if (query.assetType?.trim()) {
      where.push('asset_type = ?');
      params.push(query.assetType.trim());
    }
    if (query.assetId) {
      where.push('asset_id = ?');
      params.push(query.assetId);
    }
    if (query.action?.trim()) {
      where.push('action = ?');
      params.push(query.action.trim());
    }

    const whereSql = where.join(' AND ');
    const totalRows = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(1) AS total FROM asset_change_logs WHERE ${whereSql}`,
      params,
    );
    const items = await this.db.query<DbRow[]>(
      `SELECT id, asset_type, asset_id, action, before_data, after_data, operator, remark, created_at
       FROM asset_change_logs
       WHERE ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return { items: items.map((row) => this.parseJsonColumns(row)), pagination: { page, pageSize, total: Number(totalRows[0]?.total || 0) } };
  }

  private buildWangsuAkskHeaders(input: { endpoint: string; method: string; path: string; accessKeyId: string; accessKeySecret: string }) {
    const host = new URL(input.endpoint).host;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const contentType = 'application/json';
    const signedHeaders = 'content-type;host';
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
    const payloadHash = this.sha256Hex('');
    const canonicalRequest = [
      input.method.toUpperCase(),
      input.path,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const stringToSign = ['CNC-HMAC-SHA256', timestamp, this.sha256Hex(canonicalRequest)].join('\n');
    const signature = createHmac('sha256', input.accessKeySecret).update(stringToSign).digest('hex');
    return {
      Authorization: `CNC-HMAC-SHA256 Credential=${input.accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      Accept: 'application/json',
      'content-type': contentType,
      Host: host,
      'Request-Method': input.method.toUpperCase(),
      'Request-Uri': input.path,
      'x-cnc-timestamp': timestamp,
      'x-cnc-accessKey': input.accessKeyId,
      'x-cnc-auth-method': 'AKSK',
    };
  }

  private buildWangsuBasicHeaders(input: { username: string; apiKey: string }) {
    const date = new Date().toUTCString();
    const password = createHmac('sha1', input.apiKey).update(date).digest('base64');
    return {
      Date: date,
      Accept: 'application/xml',
      Authorization: `Basic ${Buffer.from(`${input.username}:${password}`).toString('base64')}`,
    };
  }

  private summarizeWangsuError(data: unknown) {
    const body = String(data || '').replace(/\s+/g, ' ').trim();
    const code = this.extractXmlValue(body, 'code');
    const message = this.extractXmlValue(body, 'message');
    if (code || message) return `${code || 'UNKNOWN'} ${message || ''}`.trim();
    return body.slice(0, 300);
  }

  private async getAliyunDcdnEndpoint() {
    return (await this.siteConf.getString('cdn.aliyun.dcdn_endpoint', 'https://dcdn.aliyuncs.com')).trim() || 'https://dcdn.aliyuncs.com';
  }

  private async getAliyunTimeoutMs() {
    const timeoutMs = await this.siteConf.getNumber('cdn.aliyun.dcdn.timeout_ms', 15000);
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
  }

  private async createAliyunDcdnClient(credentials?: { accessKeyId: string; accessKeySecret: string; endpoint: string }) {
    const accessKeyId = credentials?.accessKeyId || (await this.siteConf.getString('cdn.aliyun.access_key_id', '')).trim();
    const accessKeySecret = credentials?.accessKeySecret || (await this.siteConf.getString('cdn.aliyun.access_key_secret', '')).trim();
    if (!accessKeyId || !accessKeySecret) {
      throw new BadRequestException('Aliyun credentials are incomplete. Configure cdn.aliyun.access_key_id and cdn.aliyun.access_key_secret.');
    }
    return new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint: await this.getAliyunDcdnEndpoint(),
      apiVersion: '2018-01-15',
      opts: { timeout: await this.getAliyunTimeoutMs() },
    });
  }

  private parseAliyunDcdnDomain(row: Record<string, unknown>, account?: { accountId: number; accountName: string; accountIdentifier: string }): AliyunDcdnDomainPreviewItem | null {
    const domain = String(row.DomainName || '').trim();
    if (!domain) return null;
    return {
      provider: 'aliyun_dcdn',
      accountId: account?.accountId,
      accountName: account?.accountName,
      accountIdentifier: account?.accountIdentifier,
      domain,
      domainId: row.DomainId === undefined || row.DomainId === null ? undefined : String(row.DomainId),
      cname: row.Cname === undefined || row.Cname === null ? undefined : String(row.Cname),
      status: row.DomainStatus === undefined || row.DomainStatus === null ? undefined : String(row.DomainStatus),
      sslProtocol: row.SSLProtocol === undefined || row.SSLProtocol === null ? undefined : String(row.SSLProtocol),
      gmtCreated: row.GmtCreated === undefined || row.GmtCreated === null ? undefined : String(row.GmtCreated),
      gmtModified: row.GmtModified === undefined || row.GmtModified === null ? undefined : String(row.GmtModified),
      resourceGroupId: row.ResourceGroupId === undefined || row.ResourceGroupId === null ? undefined : String(row.ResourceGroupId),
      description: row.Description === undefined || row.Description === null ? undefined : String(row.Description),
      sources: row.Sources,
      raw: row,
    };
  }

  private mapAliyunDcdnStatus(status: string) {
    if (status === 'online') return 'active';
    if (['configuring', 'checking', 'configure_failed', 'check_failed'].includes(status)) return 'migrating';
    if (['offline', 'stopped', 'stopping', 'deleting', 'deleted'].includes(status)) return 'unused';
    return status || 'unknown';
  }

  private buildAliyunDcdnDomainSyncPayload(item: AliyunDcdnDomainPreviewItem, account?: { accountId?: number; accountIdentifier?: string }) {
    const normalizedStatus = String(item.status || '').toLowerCase();
    const status = this.mapAliyunDcdnStatus(normalizedStatus);
    return this.normalizePayload({
      domain: item.domain,
      root_domain: this.guessRootDomain(item.domain),
      cdn_provider: 'aliyun_dcdn',
      provider: 'aliyun',
      account_id: account?.accountId ?? item.accountId ?? undefined,
      status,
      usage_desc: 'Aliyun DCDN',
      remark: JSON.stringify({
        source: 'aliyun_dcdn_api',
        sourceAccountId: account?.accountId ?? item.accountId ?? null,
        sourceAccountIdentifier: account?.accountIdentifier ?? item.accountIdentifier ?? null,
        domainId: item.domainId || null,
        cname: item.cname || null,
        status: item.status || null,
        sslProtocol: item.sslProtocol || null,
        gmtCreated: item.gmtCreated || null,
        gmtModified: item.gmtModified || null,
        resourceGroupId: item.resourceGroupId || null,
        description: item.description || null,
        sources: item.sources || null,
        raw: item.raw || null,
      }, null, 2),
    });
  }

  private buildWangsuDomainSyncPayload(item: WangsuDomainPreviewItem) {
    const status = item.enabled === 'true' || item.cdnServiceStatus === 'true' || item.status === 'Deployed' ? 'active' : (item.status || 'unknown').toLowerCase();
    return this.normalizePayload({
      domain: item.domain,
      root_domain: this.guessRootDomain(item.domain),
      cdn_provider: 'wangsu',
      provider: 'wangsu',
      status,
      usage_desc: item.serviceType ? `Wangsu CDN ${item.serviceType}` : 'Wangsu CDN',
      remark: JSON.stringify({
        source: 'wangsu_cdn_api',
        domainId: item.domainId || null,
        cname: item.cname || null,
        serviceType: item.serviceType || null,
        cdnServiceStatus: item.cdnServiceStatus || null,
        enabled: item.enabled || null,
        billingAreas: item.billingAreas || null,
        lastModified: item.lastModified || null,
      }, null, 2),
    });
  }

  private diffDomainPayload(before: DbRow, payload: Record<string, unknown>, skipFields: string[] = []) {
    const patch: Record<string, unknown> = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (skipFields.includes(key)) return;
      const normalizedBefore = before[key] === undefined || before[key] === null ? null : String(before[key]);
      const normalizedValue = value === undefined || value === null ? null : String(value);
      if (normalizedBefore !== normalizedValue) patch[key] = value;
    });
    return patch;
  }

  private async findDomainByDomain(conn: mysql.PoolConnection, domain: string) {
    const result = await conn.execute(`SELECT * FROM asset_domains WHERE domain = ? LIMIT 1`, [domain]);
    const rows = result[0] as DbRow[];
    return rows[0] || null;
  }

  private async getSyncableAccount(id: number, provider?: string) {
    const rows = await this.db.query<DbRow[]>(`SELECT * FROM asset_accounts WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [id]);
    const account = rows[0] || null;
    if (!account) throw new NotFoundException('账号不存在');
    if (String(account.status || 'active') !== 'active') throw new BadRequestException('账号未启用，不能执行同步');
    if (provider && String(account.provider || '').trim() !== provider) throw new BadRequestException(`账号 provider 不是 ${provider}`);
    if (!account.credential_ref_id) throw new BadRequestException('账号未绑定凭证索引');
    return account;
  }

  private async resolveAccountSiteConfCredentials(account: DbRow) {
    const credentialRefId = Number(account.credential_ref_id || 0);
    const rows = await this.db.query<DbRow[]>(`SELECT * FROM credential_refs WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [credentialRefId]);
    const ref = rows[0] || null;
    if (!ref) throw new BadRequestException('账号绑定的凭证索引不存在');
    const storageType = String(ref.storage_type || '').trim();
    if (storageType !== 'siteconf') throw new BadRequestException(`当前仅支持 siteconf 凭证，实际为 ${storageType || 'unknown'}`);
    const storagePath = String(ref.storage_path || '').trim();
    if (!storagePath) throw new BadRequestException('凭证索引未配置 storage_path');
    const accessKeyId = (await this.siteConf.getString(`${storagePath}.access_key_id`, '')).trim();
    const accessKeySecret = (await this.siteConf.getString(`${storagePath}.access_key_secret`, '')).trim();
    const endpoint = (await this.siteConf.getString(`${storagePath}.endpoint`, await this.getAliyunDcdnEndpoint())).trim() || await this.getAliyunDcdnEndpoint();
    const enabled = await this.siteConf.getBoolean(`${storagePath}.enabled`, true);
    if (!enabled) throw new BadRequestException('该账号绑定的 siteconf 凭证已禁用');
    if (!accessKeyId || !accessKeySecret) throw new BadRequestException(`siteconf 凭证不完整，请检查 ${storagePath}.access_key_id / access_key_secret`);
    return { accessKeyId, accessKeySecret, endpoint, storagePath, refId: credentialRefId };
  }

  private guessRootDomain(domain: string) {
    const parts = domain.split('.').filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join('.') : domain;
  }

  private parseWangsuDomainResponse(body: string): WangsuDomainPreviewItem[] {
    const trimmed = body.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.result) ? parsed.result : [];
        return rows.map((row: Record<string, unknown>) => this.normalizeWangsuDomainRow(row)).filter((item: WangsuDomainPreviewItem) => item.domain);
      } catch {
        return this.parseWangsuDomainXml(body);
      }
    }
    return this.parseWangsuDomainXml(body);
  }

  private normalizeWangsuDomainRow(row: Record<string, unknown>): WangsuDomainPreviewItem {
    const domain = String(row['domain-name'] || row.domainName || row.domain || '').trim();
    return {
      domain,
      domainId: String(row['domain-id'] || row.domainId || '').trim() || undefined,
      cname: String(row.cname || row.CNAME || '').trim() || undefined,
      serviceType: String(row['service-type'] || row.serviceType || '').trim() || undefined,
      status: String(row.status || '').trim() || undefined,
      cdnServiceStatus: String(row['cdn-service-status'] || row.cdnServiceStatus || '').trim() || undefined,
      enabled: String(row.enabled || '').trim() || undefined,
      lastModified: String(row['last-modified'] || row.lastModified || '').trim() || undefined,
      billingAreas: String(row['billing-areas'] || row.billingAreas || '').trim() || undefined,
      provider: 'wangsu' as const,
      raw: row,
    };
  }

  private parseWangsuDomainXml(xml: string): WangsuDomainPreviewItem[] {
    const domainBlocks = this.extractXmlBlocks(xml, 'domain-summary');
    const sourceBlocks = domainBlocks.length ? domainBlocks : this.extractXmlBlocks(xml, 'domain');
    return sourceBlocks
      .map((block) => {
        const raw: Record<string, unknown> = {
          'domain-name': this.extractXmlValue(block, 'domain-name'),
          'domain-id': this.extractXmlValue(block, 'domain-id'),
          cname: this.extractXmlValue(block, 'cname'),
          'service-type': this.extractXmlValue(block, 'service-type'),
          status: this.extractXmlValue(block, 'status'),
          'cdn-service-status': this.extractXmlValue(block, 'cdn-service-status'),
          enabled: this.extractXmlValue(block, 'enabled'),
          'last-modified': this.extractXmlValue(block, 'last-modified'),
          'billing-areas': this.extractXmlValue(block, 'billing-areas'),
        };
        const domain = String(raw['domain-name'] || '').trim();
        return {
          domain,
          domainId: String(raw['domain-id'] || '').trim() || undefined,
          cname: String(raw.cname || '').trim() || undefined,
          serviceType: String(raw['service-type'] || '').trim() || undefined,
          status: String(raw.status || '').trim() || undefined,
          cdnServiceStatus: String(raw['cdn-service-status'] || '').trim() || undefined,
          enabled: String(raw.enabled || '').trim() || undefined,
          lastModified: String(raw['last-modified'] || '').trim() || undefined,
          billingAreas: String(raw['billing-areas'] || '').trim() || undefined,
          provider: 'wangsu' as const,
          raw: Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== '')),
        };
      })
      .filter((item) => item.domain);
  }

  private extractXmlBlocks(xml: string, tagName: string) {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml))) blocks.push(match[1]);
    return blocks;
  }

  private extractXmlValue(xml: string, tagName: string) {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(xml);
    if (!match) return undefined;
    return this.decodeXmlEntities(match[1].replace(/<[^>]+>/g, '').trim());
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private decodeXmlEntities(value: string) {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  private ensureAssetPermission(actor: ActorContext) {
    if (actor.username.trim().toLowerCase() === 'admin') return;
    if (actor.permissions.includes(MENU_PERMISSION)) return;
    throw new ForbiddenException(`Missing permissions: ${MENU_PERMISSION}`);
  }

  private async listRows(actor: ActorContext, config: AssetConfig, query: ListAssetsDto) {
    this.ensureAssetPermission(actor);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)));
    const where: string[] = [];
    const params: any[] = [];

    if (!query.includeDeleted) {
      where.push('deleted_at IS NULL');
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      where.push(`(${config.keywordFields.map((field) => `${field} LIKE ?`).join(' OR ')})`);
      config.keywordFields.forEach(() => params.push(`%${keyword}%`));
    }
    this.addExactFilter(where, params, config.statusField, query.status);
    this.addExactFilter(where, params, config.providerField, query.provider);
    this.addExactFilter(where, params, config.typeField, query.type);
    this.addExactFilter(where, params, config.environmentField, query.environment);
    this.addExactFilter(where, params, config.tenantField, query.tenant);
    this.addExactFilter(where, params, config.ownerField, query.owner);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRows = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(1) AS total FROM ${config.table} ${whereSql}`,
      params,
    );
    const items = await this.db.query<DbRow[]>(
      `SELECT *
       FROM ${config.table}
       ${whereSql}
       ORDER BY deleted_at IS NOT NULL ASC, updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return { items, pagination: { page, pageSize, total: Number(totalRows[0]?.total || 0) } };
  }

  private async createRow(actor: ActorContext, config: AssetConfig, dto: Record<string, unknown>) {
    this.ensureAssetPermission(actor);
    const data = this.buildCreatePayload(config, dto, actor);

    return this.db.withTransaction(async (conn) => {
      const columns = Object.keys(data);
      const placeholders = columns.map(() => '?').join(', ');
      const result = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`,
        columns.map((column) => data[column]),
      );
      const id = result[0].insertId;
      const after = await this.getRowById(conn, config, id, true);
      await this.insertChangeLog(conn, {
        actor,
        assetType: config.assetType,
        assetId: id,
        action: 'create',
        beforeData: null,
        afterData: after,
      });
      return { ok: true, id, item: after };
    });
  }

  private async updateRow(actor: ActorContext, config: AssetConfig, id: number, dto: Record<string, unknown>) {
    this.ensureAssetPermission(actor);
    const patch = this.buildUpdatePayload(config, dto, actor);
    const keys = Object.keys(patch);

    return this.db.withTransaction(async (conn) => {
      const before = await this.getRowById(conn, config, id, true);
      if (!before) {
        throw new NotFoundException('资产不存在');
      }
      if (keys.length > 0) {
        const setSql = keys.map((key) => `${key} = ?`).join(', ');
        await conn.execute(
          `UPDATE ${config.table} SET ${setSql} WHERE id = ?`,
          [...keys.map((key) => patch[key]), id],
        );
      }
      const after = await this.getRowById(conn, config, id, true);
      await this.insertChangeLog(conn, {
        actor,
        assetType: config.assetType,
        assetId: id,
        action: this.isStatusChange(config, before, after) ? 'status_change' : 'update',
        beforeData: before,
        afterData: after,
      });
      return { ok: true, id, item: after };
    });
  }

  private async softDeleteRow(actor: ActorContext, config: AssetConfig, id: number) {
    this.ensureAssetPermission(actor);
    return this.db.withTransaction(async (conn) => {
      const before = await this.getRowById(conn, config, id, true);
      if (!before) {
        throw new NotFoundException('资产不存在');
      }
      await conn.execute(
        `UPDATE ${config.table}
         SET deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP(), updated_by = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [actor.username, id],
      );
      const after = await this.getRowById(conn, config, id, true);
      await this.insertChangeLog(conn, {
        actor,
        assetType: config.assetType,
        assetId: id,
        action: 'delete',
        beforeData: before,
        afterData: after,
      });
      return { ok: true, id };
    });
  }

  private async restoreRow(actor: ActorContext, config: AssetConfig, id: number) {
    this.ensureAssetPermission(actor);
    return this.db.withTransaction(async (conn) => {
      const before = await this.getRowById(conn, config, id, true);
      if (!before) {
        throw new NotFoundException('资产不存在');
      }
      await conn.execute(
        `UPDATE ${config.table}
         SET deleted_at = NULL, updated_at = UTC_TIMESTAMP(), updated_by = ?
         WHERE id = ?`,
        [actor.username, id],
      );
      const after = await this.getRowById(conn, config, id, true);
      await this.insertChangeLog(conn, {
        actor,
        assetType: config.assetType,
        assetId: id,
        action: 'restore',
        beforeData: before,
        afterData: after,
      });
      return { ok: true, id, item: after };
    });
  }

  private async getRowById(conn: mysql.PoolConnection, config: AssetConfig, id: number, includeDeleted = false) {
    const deletedSql = includeDeleted ? '' : 'AND deleted_at IS NULL';
    const result = await conn.execute(
      `SELECT * FROM ${config.table} WHERE id = ? ${deletedSql} LIMIT 1`,
      [id],
    );
    const rows = result[0] as DbRow[];
    return rows[0] || null;
  }

  private buildCreatePayload(config: AssetConfig, dto: Record<string, unknown>, actor: ActorContext) {
    const payload: Record<string, unknown> = {
      ...config.defaultValues,
      ...this.pickFields(config.fields, dto),
      created_by: actor.username,
      updated_by: actor.username,
      created_at: new Date(),
      updated_at: new Date(),
    };
    if (payload[config.requiredField] === undefined || payload[config.requiredField] === null || payload[config.requiredField] === '') {
      throw new BadRequestException('缺少必要资产字段');
    }
    return this.normalizePayload(payload);
  }

  private buildUpdatePayload(config: AssetConfig, dto: Record<string, unknown>, actor: ActorContext) {
    return this.normalizePayload({
      ...this.pickFields(config.fields, dto),
      updated_by: actor.username,
      updated_at: new Date(),
    });
  }

  private pickFields(fields: string[], dto: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    fields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(dto, field) && dto[field] !== undefined) {
        data[field] = dto[field];
      }
    });
    return data;
  }

  private normalizePayload(payload: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        data[key] = trimmed === '' ? null : trimmed;
      } else if (typeof value === 'boolean') {
        data[key] = value ? 1 : 0;
      } else {
        data[key] = value;
      }
    });
    return data;
  }

  private addExactFilter(where: string[], params: any[], column: string | undefined, value: string | undefined) {
    const normalized = value?.trim();
    if (!column || !normalized) return;
    where.push(`${column} = ?`);
    params.push(normalized);
  }

  private async insertChangeLog(
    conn: mysql.PoolConnection,
    params: {
      actor: ActorContext;
      assetType: string;
      assetId: number;
      action: string;
      beforeData: unknown;
      afterData: unknown;
      remark?: string;
    },
  ) {
    await conn.execute(
      `INSERT INTO asset_change_logs (
         asset_type, asset_id, action, before_data, after_data, operator, remark, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        params.assetType,
        params.assetId,
        params.action,
        params.beforeData === null ? null : JSON.stringify(params.beforeData),
        params.afterData === null ? null : JSON.stringify(params.afterData),
        params.actor.username,
        params.remark || null,
      ],
    );
  }

  private isStatusChange(config: AssetConfig, before: DbRow | null, after: DbRow | null) {
    if (!config.statusField || !before || !after) return false;
    return before[config.statusField] !== after[config.statusField];
  }

  private parseJsonColumns(row: DbRow) {
    const copy = { ...row };
    for (const key of ['before_data', 'after_data']) {
      if (typeof copy[key] === 'string') {
        try {
          copy[key] = JSON.parse(copy[key]);
        } catch {
          copy[key] = null;
        }
      }
    }
    return copy;
  }

  private async countByStatus(config: AssetConfig) {
    const rows = await this.db.query<Array<{ status_value: string | null; count_value: number }>>(
      `SELECT ${config.statusField ? config.statusField : "'all'"} AS status_value, COUNT(1) AS count_value
       FROM ${config.table}
       WHERE deleted_at IS NULL
       GROUP BY ${config.statusField ? config.statusField : 'status_value'}`,
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    rows.forEach((row) => {
      const count = Number(row.count_value || 0);
      total += count;
      byStatus[String(row.status_value || 'unknown')] = count;
    });
    return { total, byStatus };
  }

  private async countMissingOwners() {
    const [accounts, resources, domains, credentialRefs] = await Promise.all([
      this.countMissingOwner(accountConfig),
      this.countMissingOwner(resourceConfig),
      this.countMissingOwner(domainConfig),
      this.countMissingOwner(credentialRefConfig),
    ]);
    return {
      accounts,
      resources,
      domains,
      credentialRefs,
      total: accounts + resources + domains + credentialRefs,
    };
  }

  private async countMissingOwner(config: AssetConfig) {
    if (!config.ownerField) return 0;
    const rows = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(1) AS total
       FROM ${config.table}
       WHERE deleted_at IS NULL AND (${config.ownerField} IS NULL OR ${config.ownerField} = '')`,
    );
    return Number(rows[0]?.total || 0);
  }
}
