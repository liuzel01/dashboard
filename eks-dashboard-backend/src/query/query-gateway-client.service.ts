import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { EnvironmentsService } from '../environments/environments.service';
import { QueryRequestContext } from './query-request-context';

@Injectable()
export class QueryGatewayClientService {
  private readonly logger = new Logger(QueryGatewayClientService.name);

  constructor(private readonly environmentsService: EnvironmentsService) {}

  isGatewayEnabled() {
    return String(process.env.QUERY_CENTER_GATEWAY_ENABLED || '')
      .trim()
      .toLowerCase() === 'true';
  }

  isGatewayEnabledForEnvironment(environmentId: string) {
    if (!this.isGatewayEnabled()) return false;
    const denylist = this.parseList(process.env.QUERY_CENTER_GATEWAY_ENV_DENYLIST);
    if (denylist.has(environmentId)) return false;
    const allowlist = this.parseList(
      process.env.QUERY_CENTER_GATEWAY_ENV_ALLOWLIST,
    );
    if (allowlist.size === 0) return true;
    return allowlist.has(environmentId);
  }

  isGatewayStrict() {
    return String(process.env.QUERY_CENTER_GATEWAY_STRICT || '')
      .trim()
      .toLowerCase() === 'true';
  }

  async aggregate(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId?: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!this.isGatewayEnabledForEnvironment(environmentId)) return null;
    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(
      environmentId,
    );
    if (!baseUrl) return null;

    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/aggregate`;
    const timeoutMs = Number(process.env.QUERY_CENTER_GATEWAY_TIMEOUT_MS || 15_000);
    const requestId = context?.requestId || randomUUID();
    const token = process.env.QUERY_CENTER_AGENT_TOKEN || '';

    this.logger.log(
      `[QueryGateway] forwarding aggregate env=${environmentId} url=${url} requestId=${requestId}`,
    );
    const response = await axios.post(
      url,
      { identifier, type, tenantId },
      {
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  private parseList(raw?: string) {
    if (!raw) return new Set<string>();
    return new Set(
      String(raw)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
}
