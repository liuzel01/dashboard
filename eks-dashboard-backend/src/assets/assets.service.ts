import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { createHmac } from 'crypto';
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
    const timeoutMs = await this.siteConf.getNumber('cdn.wangsu.timeout_ms', 15000);
    if (!accessKeyId || !accessKeySecret) {
      throw new BadRequestException('cdn.wangsu.access_key_id or cdn.wangsu.access_key_secret is empty.');
    }

    const date = new Date().toUTCString();
    const password = createHmac('sha1', accessKeySecret).update(date).digest('base64');
    const url = `${endpoint}/api/domain`;
    const response = await axios.get(url, {
      timeout: timeoutMs,
      auth: { username: accessKeyId, password },
      headers: { Date: date, Accept: 'application/xml' },
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new BadRequestException(`Wangsu API request failed: HTTP ${response.status} ${String(response.data || '').slice(0, 300)}`);
    }

    const xml = String(response.data || '');
    const items = this.parseWangsuDomainXml(xml);
    return {
      provider: 'wangsu',
      endpoint,
      enabled,
      fetchedAt: new Date().toISOString(),
      total: items.length,
      items,
    };
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
