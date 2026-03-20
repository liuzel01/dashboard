import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ListLineDto } from './dto/list-line.dto';
import { ProvisionDcdnDomainDto } from './dto/provision-dcdn-domain.dto';
import { ApplyDcdnSecurityDto } from './dto/apply-dcdn-security.dto';
import { RegisterSuperAdminLineDto } from './dto/register-super-admin-line.dto';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { ListSuperAdminLinesDto } from './dto/list-super-admin-lines.dto';

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

@Injectable()
export class LinesService {
  private readonly vlinkApiUrl: string;
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

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly kubernetesService: KubernetesService,
  ) {
    // Make VLINK_API_URL optional at boot; validate when endpoint is called.
    const url = this.configService.get<string>('VLINK_API_URL');
    this.vlinkApiUrl = url || '';
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
  }

  async getLines(query: ListLineDto) {
    if (!this.vlinkApiUrl) {
      throw new Error('VLINK_API_URL is not configured in environment variables');
    }
    const { lineUrl = '', page, size, tenantId } = query;
    const url = `${this.vlinkApiUrl}/admin/app/line/url/list`;

    // Here you might need to add authentication headers required by the target API
    // For example: const headers = { 'Authorization': 'Bearer YOUR_TOKEN' };
    const headers = {};

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          params: { lineUrl, page, size, tenantId },
          headers,
        }),
      );
      return response.data;
    } catch (error) {
      // It's good practice to log the error and maybe throw a more specific exception
      console.error('Error fetching lines from VLINK API:', error);
      throw new Error('Failed to fetch lines.');
    }
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

    const items = records
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
