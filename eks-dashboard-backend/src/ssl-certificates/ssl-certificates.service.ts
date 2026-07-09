import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { verifySync } from 'otplib';
import * as jwt from 'jsonwebtoken';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { SiteConfService } from '../site-conf/site-conf.service';
const { RPCClient } = require('@alicloud/pop-core');

const MENU_PERMISSION = 'menu:ssl-certificates';
const DOWNLOAD_TOKEN_TTL_MS = 2 * 60 * 1000;

type ActorContext = {
  userId: number;
  username: string;
  displayName?: string | null;
  permissions: string[];
  roles: string[];
  mfaEnabled?: boolean;
  mfaSecret?: string | null;
};

type DownloadSession = {
  token: string;
  actorUserId: number;
  actorUsername: string;
  certificateId: number;
  certIdentifier: string;
  expiresAt: number;
  filename: string;
  mimeType: string;
  payload: Buffer;
};

@Injectable()
export class SslCertificatesService {
  private readonly casEndpoint: string;
  private readonly casApiVersion: string;
  private readonly downloadSessions = new Map<string, DownloadSession>();

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
    private readonly auditService: AuditService,
    private readonly siteConf: SiteConfService,
  ) {
    this.casEndpoint = 'https://cas.ap-southeast-1.aliyuncs.com';
    this.casApiVersion = '2020-04-07';
  }

  private async getAliyunAccessKeyId() {
    return (await this.siteConf.getString('cdn.aliyun.access_key_id', '')).trim();
  }

  private async getAliyunAccessKeySecret() {
    return (await this.siteConf.getString('cdn.aliyun.access_key_secret', '')).trim();
  }

  private async createCasClient() {
    const accessKeyId = await this.getAliyunAccessKeyId();
    const accessKeySecret = await this.getAliyunAccessKeySecret();
    if (!accessKeyId || !accessKeySecret) {
      throw new InternalServerErrorException('Aliyun CAS credentials are not configured');
    }
    return new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint: this.casEndpoint,
      apiVersion: this.casApiVersion,
    });
  }

  private normalizeOtpCode(code?: string) {
    return String(code || '').replace(/\s+/g, '');
  }

  private verifyMfa(secret: string, code?: string) {
    const token = this.normalizeOtpCode(code);
    if (!secret || !token) return false;
    return verifySync({ strategy: 'totp', secret, token });
  }

  private ensurePermission(actor: ActorContext) {
    if (actor.permissions.includes(MENU_PERMISSION)) return;
    throw new ForbiddenException(`Missing permissions: ${MENU_PERMISSION}`);
  }

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
    const rows = await this.db.query<any[]>(
      'SELECT mfa_enabled, mfa_secret, display_name FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    const user = rows?.[0] || {};
    const actor: ActorContext = {
      userId: Number(me.id),
      username: String(me.username || payload.username || ''),
      displayName: String(user?.display_name || me.display_name || me.username || payload.displayName || payload.username || ''),
      permissions: Array.isArray(me.permissions) ? me.permissions.map((v: any) => String(v)) : [],
      roles: Array.isArray(me.roles) ? me.roles.map((r: any) => String(r?.name || r || '')).filter(Boolean) : [],
      mfaEnabled: Number(user?.mfa_enabled || 0) === 1 && !!user?.mfa_secret,
      mfaSecret: user?.mfa_secret ? String(user.mfa_secret) : null,
    };
    this.ensurePermission(actor);
    return actor;
  }

  private normalizeCertificatePattern(domainRaw: string): string {
    const value = String(domainRaw || '').trim().toLowerCase().replace(/^\*\./, '*.').replace(/^\.+|\.+$/g, '');
    return value;
  }

  private splitCertificateDomains(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map((item) => this.normalizeCertificatePattern(String(item))).filter(Boolean)));
    }
    return Array.from(
      new Set(
        String(value)
          .split(/[;,\n]/)
          .map((item) => this.normalizeCertificatePattern(item))
          .filter(Boolean),
      ),
    );
  }

  private collectCasCertificateRecords(payload: unknown, output: any[]) {
    if (payload == null) return;
    if (Array.isArray(payload)) {
      payload.forEach((item) => this.collectCasCertificateRecords(item, output));
      return;
    }
    if (typeof payload !== 'object') return;
    const obj = payload as Record<string, unknown>;
    const certId = Number((obj as any)?.CertificateId ?? (obj as any)?.CertId ?? (obj as any)?.Id);
    const commonName = String((obj as any)?.CommonName ?? (obj as any)?.CertDomainName ?? (obj as any)?.DomainName ?? '').trim();
    if (Number.isFinite(certId) && certId > 0 && commonName) {
      output.push(obj);
    }
    Object.values(obj).forEach((value) => this.collectCasCertificateRecords(value, output));
  }

  private toBoolean(value: unknown, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null) return fallback;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(text)) return true;
    if (['0', 'false', 'no', 'n'].includes(text)) return false;
    return fallback;
  }

  private formatCertificateRecord(item: any, exportMeta?: any) {
    const certificateId = Number(item?.CertificateId ?? item?.CertId ?? item?.Id);
    const certName = String(item?.Name ?? item?.CertName ?? item?.CertificateName ?? '').trim() || `cert-${certificateId}`;
    const domain = String(item?.CommonName ?? item?.CertDomainName ?? item?.DomainName ?? '').trim() || '-';
    const sans = this.splitCertificateDomains(item?.Sans ?? item?.SubjectAlternativeName ?? item?.DomainList);
    const endDate = item?.EndDate ?? item?.CertExpireTime ?? item?.ExpireDate ?? null;
    const status = String(item?.Status ?? item?.CertificateStatus ?? item?.CertStatus ?? '').trim() || 'unknown';
    const orderType = String(item?.OrderType || item?.ProductType || '').toUpperCase() || null;
    const certType = String(item?.CertificateType || item?.Type || orderType || '').trim() || 'unknown';
    const canExport = this.toBoolean(item?.CanExport ?? item?.Exportable ?? item?.IsExportable, orderType === 'UPLOAD');
    return {
      certificateId,
      arn: String(item?.CertIdentifier ?? item?.Identifier ?? item?.CertificateArn ?? item?.Arn ?? certificateId),
      certName,
      domain,
      sans,
      status,
      certType,
      canExport,
      orderType,
      endDate: endDate ? String(endDate) : null,
      lastExportedAt: exportMeta?.last_exported_at || null,
      lastExportedBy: exportMeta?.last_exported_by || null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getLatestExportMetaMap(ids: number[]) {
    if (!ids.length) return new Map<number, any>();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.db.query<any[]>(
      `SELECT certificate_id, last_exported_at, last_exported_by
       FROM ssl_certificate_export_meta
       WHERE certificate_id IN (${placeholders})`,
      ids,
    );
    const map = new Map<number, any>();
    for (const row of rows || []) map.set(Number(row.certificate_id), row);
    return map;
  }

  async listCertificates(actor: ActorContext, query: { keyword?: string; page?: number; pageSize?: number }) {
    this.ensurePermission(actor);
    const casClient = await this.createCasClient();
    const requestList = async (orderType: 'UPLOAD' | 'CERT') => {
      try {
        return await casClient.request(
          'ListUserCertificateOrder',
          { CurrentPage: 1, ShowSize: 100, OrderType: orderType },
          { method: 'POST', timeout: 15000 },
        );
      } catch {
        return null;
      }
    };
    const [uploadResp, certResp] = await Promise.all([requestList('UPLOAD'), requestList('CERT')]);
    const records: any[] = [];
    this.collectCasCertificateRecords(uploadResp, records);
    this.collectCasCertificateRecords(certResp, records);
    const dedup = new Map<number, any>();
    for (const item of records) {
      const id = Number(item?.CertificateId ?? item?.CertId ?? item?.Id);
      if (!Number.isFinite(id) || id <= 0 || dedup.has(id)) continue;
      dedup.set(id, item);
    }
    const ids = Array.from(dedup.keys());
    const exportMetaMap = await this.getLatestExportMetaMap(ids);
    const keyword = String(query.keyword || '').trim().toLowerCase();
    let items = Array.from(dedup.values()).map((item) => this.formatCertificateRecord(item, exportMetaMap.get(Number(item?.CertificateId ?? item?.CertId ?? item?.Id))));
    if (keyword) {
      items = items.filter((item) => [item.domain, item.certName, item.arn, ...(item.sans || [])].join(' ').toLowerCase().includes(keyword));
    }
    items.sort((a, b) => {
      const left = a.endDate ? new Date(a.endDate).getTime() : 0;
      const right = b.endDate ? new Date(b.endDate).getTime() : 0;
      return right - left;
    });
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    return { items: pageItems, total: items.length, page, pageSize };
  }

  async getCertificateDetail(actor: ActorContext, certificateId: number, req: { ip?: string | null; userAgent?: string | null }) {
    this.ensurePermission(actor);
    const list = await this.listCertificates(actor, { page: 1, pageSize: 200 });
    const item = (list.items || []).find((row: any) => Number(row.certificateId) === Number(certificateId)) || null;
    if (!item) throw new NotFoundException('Certificate not found');
    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'GET',
      path: `/ssl-certificates/${certificateId}`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.viewDetail',
      actionName: '查看证书详情',
      targetType: 'ssl_certificate',
      targetId: item.arn,
      requestSummary: { certificateId },
      responseSummary: { domain: item.domain, canExport: item.canExport },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });
    return item;
  }

  private assertMfa(actor: ActorContext, otpCode?: string) {
    if (!actor.mfaEnabled || !actor.mfaSecret) {
      throw new BadRequestException('当前账号未启用 Google Authenticator MFA');
    }
    if (!this.verifyMfa(actor.mfaSecret, otpCode)) {
      throw new UnauthorizedException('Google 验证码错误');
    }
  }

  private async loadCertificateOrThrow(actor: ActorContext, certificateId: number) {
    const list = await this.listCertificates(actor, { page: 1, pageSize: 200 });
    const item = (list.items || []).find((row: any) => Number(row.certificateId) === Number(certificateId)) || null;
    if (!item) throw new NotFoundException('Certificate not found');
    return item;
  }

  private buildArchiveFilename(domain: string) {
    const base = String(domain || 'certificate').replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `${base}-encrypted.zip`;
  }

  private buildPemFilename(domain: string) {
    const base = String(domain || 'certificate').replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `${base}-decrypted.pem`;
  }

  private safeJson(value: any) {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return value;
    }
  }

  private async upsertExportMeta(certificateId: number, actor: ActorContext) {
    await this.db.query(
      `INSERT INTO ssl_certificate_export_meta (certificate_id, last_exported_at, last_exported_by, created_at, updated_at)
       VALUES (?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE last_exported_at = VALUES(last_exported_at), last_exported_by = VALUES(last_exported_by), updated_at = UTC_TIMESTAMP()`,
      [certificateId, actor.username],
    );
  }

  async exportEncryptedPackage(
    actor: ActorContext,
    certificateId: number,
    body: { otpCode?: string; passphrase?: string },
    req: { ip?: string | null; userAgent?: string | null },
  ) {
    this.ensurePermission(actor);
    this.assertMfa(actor, body.otpCode);
    const passphrase = String(body.passphrase || '').trim();
    if (passphrase.length < 8) {
      throw new BadRequestException('passphrase 至少 8 位');
    }
    const certificate = await this.loadCertificateOrThrow(actor, certificateId);
    const casClient = await this.createCasClient();
    const response = await casClient.request(
      'ExportCertificate',
      { Identifier: certificate.arn, Passphrase: passphrase },
      { method: 'POST', timeout: 20000 },
    );
    await this.upsertExportMeta(certificateId, actor);
    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'POST',
      path: `/ssl-certificates/${certificateId}/export-encrypted`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.exportEncrypted',
      actionName: '导出加密包',
      targetType: 'ssl_certificate',
      targetId: certificate.arn,
      requestSummary: { certificateId, domain: certificate.domain },
      responseSummary: { ok: true },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });
    return {
      certificateId,
      arn: certificate.arn,
      domain: certificate.domain,
      certName: certificate.certName,
      filename: this.buildArchiveFilename(certificate.domain),
      exportedAt: new Date().toISOString(),
      payload: response,
    };
  }

  private extractPlaintextFromExport(response: any) {
    const payload = this.safeJson(response);
    const cert = String(payload?.Certificate ?? payload?.CertificateBody ?? payload?.Body ?? '').trim();
    const key = String(payload?.PrivateKey ?? payload?.Key ?? '').trim();
    const chain = String(payload?.CertificateChain ?? payload?.Chain ?? '').trim();
    if (!cert || !key) {
      throw new BadRequestException('导出结果中未包含可用证书/私钥内容');
    }
    return [cert, chain, key].filter(Boolean).join('\n');
  }

  async createDecryptedDownload(
    actor: ActorContext,
    certificateId: number,
    body: { otpCode?: string; passphrase?: string },
    req: { ip?: string | null; userAgent?: string | null },
  ) {
    this.ensurePermission(actor);
    this.assertMfa(actor, body.otpCode);
    const passphrase = String(body.passphrase || '').trim();
    if (passphrase.length < 8) {
      throw new BadRequestException('passphrase 至少 8 位');
    }
    const certificate = await this.loadCertificateOrThrow(actor, certificateId);
    const casClient = await this.createCasClient();
    const response = await casClient.request(
      'ExportCertificate',
      { Identifier: certificate.arn, Passphrase: passphrase },
      { method: 'POST', timeout: 20000 },
    );
    const plaintext = this.extractPlaintextFromExport(response);
    const token = randomBytes(24).toString('hex');
    const payload = Buffer.from(plaintext, 'utf8');
    this.downloadSessions.set(token, {
      token,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      certificateId,
      certIdentifier: certificate.arn,
      expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
      filename: this.buildPemFilename(certificate.domain),
      mimeType: 'application/x-pem-file',
      payload,
    });
    await this.upsertExportMeta(certificateId, actor);
    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'POST',
      path: `/ssl-certificates/${certificateId}/decrypt-download`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.decryptDownload',
      actionName: '解密下载',
      targetType: 'ssl_certificate',
      targetId: certificate.arn,
      requestSummary: { certificateId, domain: certificate.domain },
      responseSummary: { downloadTokenIssued: true, expiresInSeconds: Math.floor(DOWNLOAD_TOKEN_TTL_MS / 1000) },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });
    return {
      certificateId,
      arn: certificate.arn,
      domain: certificate.domain,
      downloadToken: token,
      expiresAt: new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS).toISOString(),
      expiresInSeconds: Math.floor(DOWNLOAD_TOKEN_TTL_MS / 1000),
    };
  }

  consumeDownloadToken(actor: ActorContext, token: string) {
    this.ensurePermission(actor);
    const session = this.downloadSessions.get(token);
    if (!session) throw new NotFoundException('下载链接不存在或已失效');
    if (session.actorUserId !== actor.userId) {
      this.downloadSessions.delete(token);
      throw new ForbiddenException('该下载链接不属于当前用户');
    }
    if (Date.now() > session.expiresAt) {
      this.downloadSessions.delete(token);
      throw new BadRequestException('下载链接已过期');
    }
    this.downloadSessions.delete(token);
    return session;
  }
}
