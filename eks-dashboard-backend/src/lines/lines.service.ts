import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ListLineDto } from './dto/list-line.dto';
import { ProvisionDcdnDomainDto } from './dto/provision-dcdn-domain.dto';

const { RPCClient } = require('@alicloud/pop-core');

type DcdnProvisionResult = {
  domainName: string;
  originDomain: string;
  scope: 'global' | 'domestic' | 'overseas';
  created: boolean;
  cname: string | null;
  domainStatus?: string | null;
  verifyRequired?: boolean;
  message: string;
};

@Injectable()
export class LinesService {
  private readonly vlinkApiUrl: string;
  private readonly lineVerifyApiUrl: string;
  private readonly dcdnEndpoint: string;
  private readonly dcdnAccessKeyId: string;
  private readonly dcdnAccessKeySecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
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

  private isDomainAlreadyExistsError(error: any) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const dataCode = String(error?.data?.Code || '').toLowerCase();
    const combined = `${code} ${message} ${dataCode}`;
    return combined.includes('already') || combined.includes('exist');
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
    try {
      const detail = await client.request(
        'DescribeDcdnDomainDetail',
        { DomainName: domainName },
        { method: 'POST', timeout: 10000 },
      );
      domainStatus = this.extractDomainStatus(detail);
      cname = this.extractCname(detail) || cname;
    } catch (error) {
      console.warn('DescribeDcdnDomainDetail failed, fallback to DescribeDcdnDomainCname', error);
    }

    try {
      const cnameResp = await client.request(
        'DescribeDcdnDomainCname',
        { DomainName: domainName },
        { method: 'POST', timeout: 10000 },
      );
      cname = this.extractCname(cnameResp) || cname;
      // CNAME empty commonly means domain owner verification or backend sync still pending.
      if (!cname) verifyRequired = true;
    } catch (error) {
      console.warn('DescribeDcdnDomainCname failed:', error);
      verifyRequired = true;
    }

    return {
      domainName,
      originDomain,
      scope,
      created,
      cname,
      domainStatus,
      verifyRequired,
      message: created
        ? 'DCDN 域名创建成功，请继续完成 DNS 与人工校验'
        : 'DCDN 域名已存在，已返回当前配置信息',
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
