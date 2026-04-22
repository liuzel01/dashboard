import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { EnvironmentsService } from '../environments/environments.service';

@Injectable()
export class QueryGatewayClientService {
  private readonly logger = new Logger(QueryGatewayClientService.name);

  constructor(private readonly environmentsService: EnvironmentsService) {}

  isGatewayEnabled() {
    return String(process.env.QUERY_CENTER_GATEWAY_ENABLED || '')
      .trim()
      .toLowerCase() === 'true';
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
  ): Promise<any | null> {
    if (!this.isGatewayEnabled()) return null;
    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(
      environmentId,
    );
    if (!baseUrl) return null;

    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/aggregate`;
    const timeoutMs = Number(process.env.QUERY_CENTER_GATEWAY_TIMEOUT_MS || 15_000);
    const requestId = randomUUID();
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
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }
}

