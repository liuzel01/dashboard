import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { verifySync } from 'otplib';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
  ACMClient,
  DescribeCertificateCommand,
  ExportCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from '@aws-sdk/client-acm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import JSZip from 'jszip';
import { createPrivateKey } from 'crypto';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { EnvironmentsService } from '../environments/environments.service';

const MENU_PERMISSION = 'menu:ssl-certificates';
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
  filename: string;
  mimeType: string;
  payload: Buffer;
};

type AwsSelection = {
  environmentId: string;
  region?: string;
};

@Injectable()
export class SslCertificatesService {
  private readonly logger = new Logger(SslCertificatesService.name);

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
    private readonly auditService: AuditService,
    private readonly environmentsService: EnvironmentsService,
  ) {}

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

  private assertMfa(actor: ActorContext, otpCode?: string) {
    if (!actor.mfaEnabled || !actor.mfaSecret) {
      throw new BadRequestException('当前账号未启用 Google Authenticator MFA');
    }
    if (!this.verifyMfa(actor.mfaSecret, otpCode)) {
      throw new UnauthorizedException('Google 验证码错误');
    }
  }

  private normalizeSelection(input: AwsSelection) {
    const environmentId = String(input.environmentId || '').trim();
    if (!environmentId) throw new BadRequestException('environmentId 不能为空');
    const region = String(input.region || '').trim() || undefined;
    return { environmentId, region };
  }

  private mapAwsError(error: unknown, action: string): never {
    const err = error as {
      name?: string;
      message?: string;
      Code?: string;
      code?: string;
      __type?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const name = String(err?.name || err?.Code || err?.code || err?.__type || 'UnknownAwsError');
    const message = String(err?.message || 'unknown error');
    const httpStatus = Number(err?.$metadata?.httpStatusCode || 0);
    const raw = `${name}: ${message}`;

    if (/AccessDenied|Unauthorized/i.test(name) || httpStatus === 403) {
      throw new ForbiddenException(`当前 AWS 凭证无权执行 ${action}：${raw}`);
    }
    if (/ExpiredToken|InvalidClientTokenId|UnrecognizedClient|SignatureDoesNotMatch|AuthFailure/i.test(name)) {
      throw new UnauthorizedException(`当前 AWS 凭证不可用，无法执行 ${action}：${raw}`);
    }
    if (/CredentialsProviderError|Credential/i.test(name) || /Could not load credentials|credential/i.test(message)) {
      throw new BadRequestException(`AWS 凭证配置无效或缺失，无法执行 ${action}：${raw}`);
    }
    if (/Throttl/i.test(name) || httpStatus === 429) {
      throw new ServiceUnavailableException(`AWS 接口限流，稍后重试：${raw}`);
    }
    if (/Validation|InvalidParameter|MissingParameter/i.test(name) || httpStatus === 400) {
      throw new BadRequestException(`AWS 请求参数错误，无法执行 ${action}：${raw}`);
    }

    throw new BadRequestException(`AWS 请求失败，无法执行 ${action}：${raw}`);
  }

  private async createAcmClient(input: AwsSelection) {
    const { environmentId, region } = this.normalizeSelection(input);
    const env = await this.environmentsService.getEnvironmentConfigById(environmentId);
    if (!env) {
      throw new NotFoundException(`Environment "${environmentId}" not found`);
    }

    const finalRegion = region || env.aws_region;
    if (!finalRegion) {
      throw new BadRequestException(`环境 ${environmentId} 未配置 aws_region，且本次请求未指定 region`);
    }

    const clientConfig: { region: string; credentials?: any } = { region: finalRegion };
    let credentialSource = 'default-chain';
    const roleArn = String(env.aws_role_arn || '').trim();
    if (roleArn) {
      const stsRegion =
        process.env.AWS_STS_REGION ||
        process.env.AWS_REGION ||
        process.env.AWS_DEFAULT_REGION ||
        'ap-southeast-1';
      clientConfig.credentials = fromTemporaryCredentials({
        clientConfig: { region: stsRegion },
        params: {
          RoleArn: roleArn,
          RoleSessionName: `dashboard-acm-${environmentId}`.replace(/[^A-Za-z0-9_=,.@-]/g, '-'),
        },
      });
      credentialSource = `assume-role:${roleArn}`;
    }

    const client = new ACMClient(clientConfig);
    const stsClient = new STSClient(clientConfig);
    let callerIdentity: { account?: string; arn?: string; userId?: string } | null = null;
    try {
      const ident = await stsClient.send(new GetCallerIdentityCommand({}));
      callerIdentity = {
        account: ident.Account ? String(ident.Account) : undefined,
        arn: ident.Arn ? String(ident.Arn) : undefined,
        userId: ident.UserId ? String(ident.UserId) : undefined,
      };
    } catch (error) {
      const err = error as { name?: string; message?: string };
      this.logger.warn(
        `[ssl-certificates] failed to resolve caller identity env=${environmentId} region=${finalRegion} source=${credentialSource} error=${err?.name || 'UnknownError'}:${err?.message || String(error)}`
      );
    }

    return {
      environmentId,
      region: finalRegion,
      client,
      credentialSource,
      callerIdentity,
    };
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

  private buildIdempotencyToken(input: { environmentId: string; region: string; domain: string; sans: string[] }) {
    const raw = `${input.environmentId}|${input.region}|${input.domain}|${input.sans.join(',')}`;
    return Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'sslrequesttoken';
  }

  private isExportable(detail: any) {
    const type = String(detail?.Type || '').toUpperCase();
    const option = String(detail?.Options?.Export || detail?.Options?.ExportOption || detail?.ExportOption || '').toUpperCase();
    return type === 'PRIVATE' || option === 'ENABLED';
  }

  private buildListItem(detail: any, source: { environmentId: string; region: string }) {
    const arn = String(detail?.CertificateArn || '').trim();
    const sans = this.splitCertificateDomains(detail?.SubjectAlternativeNames || detail?.Sans);
    return {
      certificateArn: arn,
      certificateId: arn,
      arn,
      certName: String(detail?.DomainName || detail?.CertificateArn || '').trim() || '-',
      domain: String(detail?.DomainName || '-').trim() || '-',
      sans,
      status: String(detail?.Status || 'UNKNOWN').trim(),
      certType: String(detail?.Type || 'UNKNOWN').trim(),
      canExport: this.isExportable(detail),
      orderType: null,
      endDate: detail?.NotAfter ? new Date(detail.NotAfter).toISOString() : null,
      lastExportedAt: null,
      lastExportedBy: null,
      sourceEnvironmentId: source.environmentId,
      sourceRegion: source.region,
      requestedAt: new Date().toISOString(),
    };
  }

  private async describeCertificate(client: ACMClient, certificateArn: string) {
    try {
      const resp = await client.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
      const detail = (resp as any)?.Certificate;
      if (!detail) throw new NotFoundException('Certificate not found');
      return detail;
    } catch (error) {
      this.mapAwsError(error, 'acm:DescribeCertificate');
    }
  }

  async listCertificates(
    actor: ActorContext,
    query: { environmentId: string; region?: string; keyword?: string; page?: number; pageSize?: number },
  ) {
    this.ensurePermission(actor);
    const { client, environmentId, region, credentialSource, callerIdentity } = await this.createAcmClient(query);
    this.logger.log(`[ssl-certificates] list env=${environmentId} region=${region} source=${credentialSource} account=${callerIdentity?.account || '-'} arn=${callerIdentity?.arn || '-'} keyword=${String(query.keyword || '').trim() || '-'} actor=${actor.username}`);

    const summaries: any[] = [];
    let nextToken: string | undefined = undefined;
    do {
      try {
        const resp = await client.send(new ListCertificatesCommand({ NextToken: nextToken, MaxItems: 1000 } as any));
        summaries.push(...((resp as any)?.CertificateSummaryList || []));
        nextToken = (resp as any)?.NextToken || undefined;
      } catch (error) {
        this.mapAwsError(error, 'acm:ListCertificates');
      }
    } while (nextToken);

    const keyword = String(query.keyword || '').trim().toLowerCase();
    const candidateSummaries = keyword
      ? summaries.filter((item) => `${item?.DomainName || ''} ${item?.CertificateArn || ''}`.toLowerCase().includes(keyword))
      : summaries;

    const details = await Promise.all(
      candidateSummaries.map(async (summary) => {
        const arn = String(summary?.CertificateArn || '').trim();
        if (!arn) return null;
        try {
          return await this.describeCertificate(client, arn);
        } catch (error) {
          this.logger.warn(`[ssl-certificates] skip describe certArn=${arn} env=${environmentId} region=${region} error=${(error as any)?.name || 'UnknownError'}:${(error as any)?.message || String(error)}`);
          return null;
        }
      }),
    );

    let items = details
      .filter(Boolean)
      .map((detail) => this.buildListItem(detail, { environmentId, region }));

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

    return {
      items: pageItems,
      total: items.length,
      page,
      pageSize,
      source: { provider: 'aws-acm', environmentId, region },
    };
  }

  async getCertificateDetail(
    actor: ActorContext,
    query: { environmentId: string; region?: string; certificateArn: string },
    req: { ip?: string | null; userAgent?: string | null },
  ) {
    this.ensurePermission(actor);
    const { client, environmentId, region, credentialSource, callerIdentity } = await this.createAcmClient(query);
    this.logger.log(`[ssl-certificates] detail env=${environmentId} region=${region} source=${credentialSource} account=${callerIdentity?.account || '-'} arn=${callerIdentity?.arn || '-'} certArn=${String(query.certificateArn || '').trim() || '-'} actor=${actor.username}`);
    const certificateArn = String(query.certificateArn || '').trim();
    if (!certificateArn) throw new BadRequestException('certificateArn 不能为空');
    const detail = await this.describeCertificate(client, certificateArn);
    const item = this.buildListItem(detail, { environmentId, region });
    const validationOptions = Array.isArray(detail?.DomainValidationOptions)
      ? detail.DomainValidationOptions.map((entry: any) => ({
          domainName: String(entry?.DomainName || ''),
          validationStatus: String(entry?.ValidationStatus || ''),
          recordName: String(entry?.ResourceRecord?.Name || ''),
          recordType: String(entry?.ResourceRecord?.Type || ''),
          recordValue: String(entry?.ResourceRecord?.Value || ''),
        }))
      : [];

    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'GET',
      path: `/ssl-certificates/detail`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.viewDetail',
      actionName: '查看证书详情',
      targetType: 'ssl_certificate',
      targetId: item.arn,
      requestSummary: { environmentId, region, certificateArn },
      responseSummary: { domain: item.domain, canExport: item.canExport },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });

    return {
      ...item,
      validationMethod: String(detail?.Type || ''),
      keyAlgorithm: String(detail?.KeyAlgorithm || ''),
      exportOption: String(detail?.Options?.Export || ''),
      transparencyLogging: String(detail?.Options?.CertificateTransparencyLoggingPreference || ''),
      validationOptions,
    };
  }

  private buildArchiveFilename(domain: string) {
    const base = String(domain || 'certificate').replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `${base}-certificate-package.zip`;
  }

  private decryptPrivateKeyPem(encryptedPrivateKeyPem: string, passphrase: string) {
    try {
      const keyObject = createPrivateKey({
        key: encryptedPrivateKeyPem,
        format: 'pem',
        passphrase,
      });
      return keyObject.export({ format: 'pem', type: 'pkcs8' }).toString();
    } catch (error) {
      const err = error as { message?: string };
      throw new BadRequestException(`私钥解密失败，请检查 passphrase 是否正确：${err?.message || String(error)}`);
    }
  }

  private extractExportParts(response: any, passphrase: string) {
    const certificate = String(response?.Certificate ?? '').trim();
    const privateKeyEncrypted = String(response?.PrivateKey ?? '').trim();
    const certificateChain = String(response?.CertificateChain ?? '').trim();

    if (!certificate || !privateKeyEncrypted) {
      throw new BadRequestException('导出结果中未包含可用证书/私钥内容');
    }

    const privateKeyDecrypted = this.decryptPrivateKeyPem(privateKeyEncrypted, passphrase).trim();

    return {
      certificate,
      certificateChain,
      privateKeyEncrypted,
      privateKeyDecrypted,
    };
  }

  private async buildCertificateZip(domain: string, parts: { certificate: string; certificateChain?: string; privateKeyEncrypted?: string; privateKeyDecrypted: string }) {
    const base = String(domain || 'certificate').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const zip = new JSZip();
    zip.file(`${base}.certificate.pem`, `${parts.certificate.trim()}\n`);
    if (parts.certificateChain?.trim()) {
      zip.file(`${base}.certificate-chain.pem`, `${parts.certificateChain.trim()}\n`);
    }
    if (parts.privateKeyEncrypted?.trim()) {
      zip.file(`${base}.private-key.encrypted.pem`, `${parts.privateKeyEncrypted.trim()}\n`);
    }
    zip.file(`${base}.private-key.decrypted.pem`, `${parts.privateKeyDecrypted.trim()}\n`);
    zip.file(
      `${base}.fullchain.pem`,
      [parts.certificate, parts.certificateChain].filter(Boolean).map((item) => String(item).trim()).join('\n') + '\n',
    );
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  async requestCertificate(
    actor: ActorContext,
    body: { environmentId: string; region?: string; domain: string; sans?: string },
    req: { ip?: string | null; userAgent?: string | null },
  ) {
    this.ensurePermission(actor);
    const { client, environmentId, region, credentialSource, callerIdentity } = await this.createAcmClient(body);
    const domain = this.normalizeCertificatePattern(body.domain);
    if (!domain) {
      throw new BadRequestException('domain 不能为空');
    }
    const sans = this.splitCertificateDomains(body.sans).filter((item) => item && item !== domain);
    const idempotencyToken = this.buildIdempotencyToken({ environmentId, region, domain, sans });

    this.logger.log(`[ssl-certificates] request-certificate env=${environmentId} region=${region} source=${credentialSource} account=${callerIdentity?.account || '-'} arn=${callerIdentity?.arn || '-'} domain=${domain} sans=${sans.join(',') || '-'} actor=${actor.username}`);

    let resp: any;
    try {
      resp = await client.send(
        new RequestCertificateCommand({
          DomainName: domain,
          SubjectAlternativeNames: sans.length ? sans : undefined,
          ValidationMethod: 'DNS',
          IdempotencyToken: idempotencyToken,
          KeyAlgorithm: 'RSA_2048',
          Options: {
            CertificateTransparencyLoggingPreference: 'ENABLED',
            Export: 'ENABLED',
          },
        }),
      );
    } catch (error) {
      this.mapAwsError(error, 'acm:RequestCertificate');
    }

    const certificateArn = String(resp?.CertificateArn || '').trim();
    if (!certificateArn) {
      throw new BadRequestException('AWS 未返回 certificateArn');
    }

    const detail = await this.describeCertificate(client, certificateArn);
    const validationOptions = Array.isArray(detail?.DomainValidationOptions)
      ? detail.DomainValidationOptions.map((item: any) => ({
          domainName: String(item?.DomainName || ''),
          validationStatus: String(item?.ValidationStatus || ''),
          recordName: String(item?.ResourceRecord?.Name || ''),
          recordType: String(item?.ResourceRecord?.Type || ''),
          recordValue: String(item?.ResourceRecord?.Value || ''),
        }))
      : [];

    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'POST',
      path: `/ssl-certificates/request-certificate`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.requestCertificate',
      actionName: '申请 SSL 证书',
      targetType: 'ssl_certificate_request',
      targetId: certificateArn,
      requestSummary: { environmentId, region, domain, sans },
      responseSummary: { certificateArn, validationOptionCount: validationOptions.length },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });

    return {
      certificateArn,
      domain,
      sans,
      status: String(detail?.Status || 'PENDING_VALIDATION'),
      certificateType: 'AMAZON_ISSUED_PUBLIC',
      validationMethod: 'DNS',
      keyAlgorithm: String(detail?.KeyAlgorithm || 'RSA_2048'),
      exportOption: String(detail?.Options?.Export || 'ENABLED'),
      transparencyLogging: String(detail?.Options?.CertificateTransparencyLoggingPreference || 'ENABLED'),
      tags: [],
      validationOptions,
      source: { provider: 'aws-acm', environmentId, region },
    };
  }

  async exportEncryptedPackage(
    actor: ActorContext,
    body: { environmentId: string; region?: string; certificateArn: string; otpCode?: string; passphrase?: string },
    req: { ip?: string | null; userAgent?: string | null },
  ) {
    this.ensurePermission(actor);
    this.assertMfa(actor, body.otpCode);
    const passphrase = String(body.passphrase || '').trim();
    if (passphrase.length < 8) {
      throw new BadRequestException('passphrase 至少 8 位');
    }
    const { client, environmentId, region, credentialSource, callerIdentity } = await this.createAcmClient(body);
    this.logger.log(`[ssl-certificates] export-encrypted env=${environmentId} region=${region} source=${credentialSource} account=${callerIdentity?.account || '-'} arn=${callerIdentity?.arn || '-'} certArn=${String(body.certificateArn || '').trim() || '-'} actor=${actor.username}`);
    const certificateArn = String(body.certificateArn || '').trim();
    if (!certificateArn) throw new BadRequestException('certificateArn 不能为空');

    const certificate = await this.describeCertificate(client, certificateArn);
    let response: any;
    try {
      response = await client.send(
        new ExportCertificateCommand({
          CertificateArn: certificateArn,
          Passphrase: new TextEncoder().encode(passphrase),
        }),
      );
    } catch (error) {
      this.mapAwsError(error, 'acm:ExportCertificate');
    }

    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'POST',
      path: `/ssl-certificates/export-encrypted`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.exportEncrypted',
      actionName: '导出加密包',
      targetType: 'ssl_certificate',
      targetId: certificateArn,
      requestSummary: { environmentId, region, certificateArn },
      responseSummary: { ok: true },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });

    return {
      certificateArn,
      arn: certificateArn,
      domain: String(certificate?.DomainName || '-'),
      certName: String(certificate?.DomainName || certificateArn),
      filename: this.buildArchiveFilename(String(certificate?.DomainName || 'certificate')),
      exportedAt: new Date().toISOString(),
      payload: response,
      source: { provider: 'aws-acm', environmentId, region },
    };
  }

  async createDecryptedDownload(
    actor: ActorContext,
    body: { environmentId: string; region?: string; certificateArn: string; otpCode?: string; passphrase?: string },
    req: { ip?: string | null; userAgent?: string | null },
  ) {
    this.ensurePermission(actor);
    this.assertMfa(actor, body.otpCode);
    const passphrase = String(body.passphrase || '').trim();
    if (passphrase.length < 8) {
      throw new BadRequestException('passphrase 至少 8 位');
    }
    const { client, environmentId, region, credentialSource, callerIdentity } = await this.createAcmClient(body);
    this.logger.log(`[ssl-certificates] decrypt-download env=${environmentId} region=${region} source=${credentialSource} account=${callerIdentity?.account || '-'} arn=${callerIdentity?.arn || '-'} certArn=${String(body.certificateArn || '').trim() || '-'} actor=${actor.username}`);
    const certificateArn = String(body.certificateArn || '').trim();
    if (!certificateArn) throw new BadRequestException('certificateArn 不能为空');

    const certificate = await this.describeCertificate(client, certificateArn);
    let response: any;
    try {
      response = await client.send(
        new ExportCertificateCommand({
          CertificateArn: certificateArn,
          Passphrase: new TextEncoder().encode(passphrase),
        }),
      );
    } catch (error) {
      this.mapAwsError(error, 'acm:ExportCertificate');
    }

    const parts = this.extractExportParts(response, passphrase);
    const filename = this.buildArchiveFilename(String(certificate?.DomainName || 'certificate'));
    const payload = await this.buildCertificateZip(String(certificate?.DomainName || 'certificate'), parts);

    await this.auditService.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName || actor.username,
      method: 'POST',
      path: `/ssl-certificates/decrypt-download`,
      menuKey: MENU_PERMISSION,
      action: 'sslCertificates.decryptDownload',
      actionName: '解密下载',
      targetType: 'ssl_certificate',
      targetId: certificateArn,
      requestSummary: { environmentId, region, certificateArn },
      responseSummary: { downloadedDirectly: true, filename, fileCount: parts.privateKeyEncrypted ? 4 : 3 },
      status: 'success',
      statusCode: 200,
      ip: req.ip || null,
      userAgent: req.userAgent || null,
    });

    return {
      filename,
      mimeType: 'application/zip',
      payload,
    };
  }
}
