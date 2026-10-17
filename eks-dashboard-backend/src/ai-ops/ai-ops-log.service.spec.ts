import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { AiOpsLogService } from './ai-ops-log.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const actor = {
  userId: 1,
  username: 'admin',
  permissions: ['menu:ai-ops', 'aiops:log-investigate'],
  roles: ['admin'],
};

const values: Record<string, string> = {
  'aiops.logs.environments.mgbx.enabled': 'true',
  'aiops.logs.environments.mgbx.project_id': 'mgbx',
  'aiops.logs.environments.mgbx.source_id': 'mgbx-loki-main',
  'aiops.logs.environments.mgbx.grafana_base_url':
    'https://grafana.mgbx.example',
  'aiops.logs.environments.mgbx.grafana_service_account':
    'dashboard-aiops-mgbx',
  'aiops.logs.environments.mgbx.grafana_token': 'mgbx-secret',
  'aiops.logs.environments.mgbx.datasource_uid': 'loki-uid',
  'aiops.logs.environments.mgbx.allowed_namespaces': 'default,monitoring',
  'aiops.logs.environments.mgbx.allowed_services': '',
  'aiops.logs.environments.mgbx.max_range_hours': '24',
  'aiops.logs.environments.mgbx.max_lines': '200',
  'aiops.logs.environments.mgbx.timeout_ms': '15000',
  'aiops.logs.environments.icoin.enabled': 'true',
  'aiops.logs.environments.icoin.project_id': 'icoin',
  'aiops.logs.environments.icoin.source_id': 'icoin-loki-main',
  'aiops.logs.environments.icoin.grafana_base_url':
    'https://grafana.icoin.example',
  'aiops.logs.environments.icoin.grafana_service_account':
    'dashboard-aiops-icoin',
  'aiops.logs.environments.icoin.grafana_token': 'icoin-secret',
  'aiops.logs.environments.icoin.datasource_uid': 'icoin-loki',
  'aiops.logs.environments.icoin.allowed_namespaces': 'default',
};

const createService = (overrides: Record<string, string> = {}) => {
  const config = { ...values, ...overrides };
  const siteConf = {
    getString: jest.fn(
      async (key: string, fallback: string) => config[key] ?? fallback,
    ),
    getBoolean: jest.fn(async (key: string, fallback: boolean) =>
      config[key] === undefined ? fallback : config[key] === 'true',
    ),
    getNumber: jest.fn(async (key: string, fallback: number) =>
      config[key] === undefined ? fallback : Number(config[key]),
    ),
  };
  const db = { query: jest.fn(async () => ({ affectedRows: 1 })) };
  const mcp = {
    enabled: jest.fn(async () => false),
    fallbackEnabled: jest.fn(async () => true),
    callTool: jest.fn(),
    textPayload: jest.fn(),
  };
  return {
    service: new AiOpsLogService(siteConf as any, db as any, mcp as any),
    siteConf,
    db,
    mcp,
  };
};

describe('AiOpsLogService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses only the selected environment credential profile', async () => {
    const { service, siteConf } = createService();
    await service.listSources('mgbx', actor);
    const requestedKeys = siteConf.getString.mock.calls.map((call) => call[0]);
    expect(requestedKeys).toContain(
      'aiops.logs.environments.mgbx.grafana_token',
    );
    expect(requestedKeys.some((key) => key.includes('.icoin.'))).toBe(false);
  });

  it('fails closed when the selected environment has no token', async () => {
    const { service } = createService({
      'aiops.logs.environments.mgbx.grafana_token': '',
    });
    await expect(service.listSources('mgbx', actor)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a source from another environment', async () => {
    const { service } = createService();
    await expect(
      service.search('mgbx', actor, {
        projectId: 'icoin',
        sourceId: 'icoin-loki-main',
        namespace: 'default',
        entityField: 'uid',
        entityValue: '1001',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('compiles a bounded Loki query and redacts secrets from evidence', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: {
          result: [
            {
              stream: {
                namespace: 'default',
                service_name: 'orders',
                ignored: 'x',
              },
              values: [['1735689600000000000', 'uid=1001 token=very-secret']],
            },
          ],
        },
      },
    } as any);
    const { service } = createService();
    const result = await service.search('mgbx', actor, {
      projectId: 'mgbx',
      sourceId: 'mgbx-loki-main',
      namespace: 'default',
      serviceName: 'orders',
      entityField: 'uid',
      entityValue: '1001',
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-01T00:10:00.000Z',
      limit: 20,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/datasources/proxy/uid/loki-uid/loki/api/v1/query_range',
      ),
      expect.objectContaining({
        headers: { Authorization: 'Bearer mgbx-secret' },
        params: expect.objectContaining({
          query: '{namespace="default",service_name="orders"} |= "1001"',
          limit: 20,
        }),
      }),
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].line).toBe('uid=1001 token=[REDACTED]');
    expect(result.evidence[0].labels).toEqual({
      namespace: 'default',
      service_name: 'orders',
    });
  });

  it('supports a generic log clue without a business identifier type', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { data: { result: [] } },
    } as any);
    const { service } = createService();
    await service.search('mgbx', actor, {
      projectId: 'mgbx',
      sourceId: 'mgbx-loki-main',
      namespace: 'default',
      queryText: 'connection refused',
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-01T00:10:00.000Z',
      limit: 20,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          query: '{namespace="default"} |= "connection refused"',
        }),
      }),
    );
  });

  it('uses the MCP executor and allows an investigation clue without namespace', async () => {
    const { service, mcp } = createService();
    mcp.enabled.mockResolvedValue(true);
    mcp.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'payload' }],
      isError: false,
    });
    mcp.textPayload.mockReturnValue([
      JSON.stringify({
        data: [
          {
            timestamp: '2026-10-17T03:00:00Z',
            line: 'uid=1001 token=secret-value',
            labels: { cluster: 'icoin', app: 'orders' },
          },
        ],
      }),
    ]);

    const result = await service.search('icoin', actor, {
      projectId: 'icoin',
      sourceId: 'icoin-loki-main',
      queryText: '1001',
      from: '2026-10-17T02:55:00.000Z',
      to: '2026-10-17T03:00:00.000Z',
      limit: 20,
    });

    expect(mcp.callTool).toHaveBeenCalledWith(
      'icoin',
      'query_loki_logs',
      expect.objectContaining({
        logql: '{cluster=~".+"} |= "1001"',
        limit: 20,
      }),
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result.evidence[0].labels).toEqual({ app: 'orders' });
    expect(result.evidence[0].line).toBe('uid=1001 token=[REDACTED]');
  });

  it('allows a service-only bounded query and rejects a namespace-only scan', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { data: { result: [] } },
    } as any);
    const { service } = createService();
    await service.search('mgbx', actor, {
      projectId: 'mgbx',
      sourceId: 'mgbx-loki-main',
      namespace: 'default',
      serviceName: 'orders',
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          query: '{namespace="default",service_name="orders"}',
        }),
      }),
    );
    await expect(
      service.search('mgbx', actor, {
        projectId: 'mgbx',
        sourceId: 'mgbx-loki-main',
        namespace: 'default',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects excessive time ranges before calling Grafana', async () => {
    const { service } = createService();
    await expect(
      service.search('mgbx', actor, {
        projectId: 'mgbx',
        sourceId: 'mgbx-loki-main',
        namespace: 'default',
        entityField: 'uid',
        entityValue: '1001',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-03T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('limits clue-only scans without a service to 15 minutes', async () => {
    const { service } = createService();
    await expect(
      service.search('mgbx', actor, {
        projectId: 'mgbx',
        sourceId: 'mgbx-loki-main',
        namespace: 'default',
        queryText: 'connection refused',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-01T00:16:00.000Z',
      }),
    ).rejects.toThrow('未指定服务时日志查询范围不能超过 15 分钟');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
