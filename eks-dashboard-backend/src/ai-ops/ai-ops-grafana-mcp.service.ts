import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import axios from 'axios';
import { SiteConfService } from '../site-conf/site-conf.service';

type McpCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

@Injectable()
export class AiOpsGrafanaMcpService {
  private readonly tokenCache = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  constructor(private readonly siteConf: SiteConfService) {}

  async enabled(environmentId: string) {
    return (
      (await this.siteConf.getString(
        `aiops.logs.environments.${environmentId}.executor`,
        'direct',
      )) === 'mcp'
    );
  }

  async fallbackEnabled(environmentId: string) {
    return this.siteConf.getBoolean(
      `aiops.logs.environments.${environmentId}.mcp_fallback_direct`,
      true,
    );
  }

  async callTool(
    environmentId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) {
    const prefix = `aiops.logs.environments.${environmentId}`;
    const endpoint = await this.siteConf.getString(
      `${prefix}.mcp_url`,
      'http://127.0.0.1:8102/mcp',
    );
    const timeoutMs = Math.min(
      60000,
      Math.max(
        1000,
        await this.siteConf.getNumber(`${prefix}.timeout_ms`, 15000),
      ),
    );
    const token = await this.resolveToken(environmentId);
    try {
      const response = await axios.post<{ result?: McpCallResult }>(
        endpoint,
        {
          jsonrpc: '2.0',
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        },
      );
      const result = response.data?.result;
      if (!result || result.isError) {
        const summary = (result?.content || [])
          .map((item) => String(item?.text || ''))
          .filter(Boolean)
          .join('; ')
          .slice(0, 500);
        throw new BadGatewayException(
          `Grafana MCP 工具 ${toolName} 执行失败${summary ? `：${summary}` : ''}`,
        );
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) throw error;
      const status = axios.isAxiosError(error)
        ? Number(error.response?.status || 0)
        : 0;
      if (status === 401 || status === 403) {
        throw new BadGatewayException('Grafana MCP 调用凭据无效或无权访问');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(
        `Grafana MCP 调用失败：${message.slice(0, 500)}`,
      );
    }
  }

  textPayload(result: McpCallResult) {
    return (result.content || [])
      .filter((item) => item?.type === 'text' && item.text)
      .map((item) => String(item.text));
  }

  private async resolveToken(environmentId: string) {
    const prefix = `aiops.logs.environments.${environmentId}`;
    const source = (
      await this.siteConf.getString(`${prefix}.mcp_token_source`, 'siteconf')
    )
      .trim()
      .toLowerCase();

    if (source === 'siteconf') {
      const value = (
        await this.siteConf.getString(`${prefix}.mcp_token`, '')
      ).trim();
      if (!value) {
        throw new ServiceUnavailableException(
          `环境 ${environmentId} 未在 SiteConf 配置 Grafana MCP Token`,
        );
      }
      return value;
    }

    if (source !== 'ssm') {
      throw new ServiceUnavailableException(
        `环境 ${environmentId} 的 Grafana MCP Token 来源无效`,
      );
    }

    const cacheKey = `${environmentId}:${source}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const parameterName = await this.siteConf.getString(
      `${prefix}.mcp_token_parameter`,
      `/dashboard/grafana-mcp/${environmentId}/server-auth-token`,
    );
    const region = await this.siteConf.getString(
      `${prefix}.mcp_region`,
      'ap-southeast-1',
    );
    if (!parameterName) {
      throw new ServiceUnavailableException(
        `环境 ${environmentId} 未配置 Grafana MCP Token 参数`,
      );
    }
    const response = await new SSMClient({ region }).send(
      new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
    );
    const value = String(response.Parameter?.Value || '');
    if (!value) {
      throw new ServiceUnavailableException(
        `环境 ${environmentId} 的 Grafana MCP Token 不可用`,
      );
    }
    this.cacheToken(cacheKey, value);
    return value;
  }

  private cacheToken(cacheKey: string, value: string) {
    this.tokenCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }
}
