import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { AiOpsGrafanaMcpService } from './ai-ops-grafana-mcp.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const createService = (values: Record<string, string>) => {
  const siteConf = {
    getString: jest.fn(async (key: string, fallback: string) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : fallback,
    ),
    getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
    getBoolean: jest.fn(async (_key: string, fallback: boolean) => fallback),
  };
  return {
    service: new AiOpsGrafanaMcpService(siteConf as any),
    siteConf,
  };
};

describe('AiOpsGrafanaMcpService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the SiteConf MCP token as the default shared configuration path', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { result: { content: [{ type: 'text', text: 'ok' }] } },
    } as any);
    const { service } = createService({
      'aiops.logs.environments.icoin.mcp_url': 'http://mcp.example/mcp',
      'aiops.logs.environments.icoin.mcp_token': 'siteconf-token',
    });

    await service.callTool('icoin', 'query_loki_logs', {
      query: '{cluster="icoin"}',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://mcp.example/mcp',
      expect.objectContaining({ method: 'tools/call' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer siteconf-token',
        }),
      }),
    );
  });

  it('fails before the MCP request when the selected SiteConf token is empty', async () => {
    const { service } = createService({
      'aiops.logs.environments.icoin.mcp_token_source': 'siteconf',
      'aiops.logs.environments.icoin.mcp_token': '',
    });

    await expect(
      service.callTool('icoin', 'query_loki_logs', {}),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects unsupported MCP token sources', async () => {
    const { service } = createService({
      'aiops.logs.environments.icoin.mcp_token_source': 'unknown',
    });

    await expect(
      service.callTool('icoin', 'query_loki_logs', {}),
    ).rejects.toThrow('Grafana MCP Token 来源无效');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
