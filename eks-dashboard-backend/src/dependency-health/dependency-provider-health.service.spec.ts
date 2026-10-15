import axios from 'axios';
import { DependencyProviderHealthService, providerAlertTransition } from './dependency-provider-health.service';

jest.mock('axios');

describe('DependencyProviderHealthService', () => {
  const values: Record<string, string | number | boolean> = {
    'cicd.executors.hash-jenkins.base_url': 'https://jenkins.example.com',
    'cicd.executors.hash-jenkins.username': 'dashboard-bot',
    'cicd.executors.hash-jenkins.api_token': 'secret-token',
    'cicd.executors.hash-jenkins.timeout_ms': 15000,
    'aiops.cliproxy.base_url': 'https://llm.example.com/v1',
    'aiops.cliproxy.api_key': 'secret-key',
    'aiops.cliproxy.model': 'gpt-5.6-terra',
    'aiops.cliproxy.timeout_ms': 20000,
    'bytebase.hashex.base_url': 'https://bytebase.example.com',
    'bytebase.hashex.catalog_email': 'dashboard-catalog@example.com',
    'bytebase.hashex.catalog_service_key': 'bytebase-secret',
  };
  const siteConf = {
    getString: jest.fn(async (key: string, fallback = '') =>
      String(values[key] ?? fallback),
    ),
    getNumber: jest.fn(async (key: string, fallback = 0) =>
      Number(values[key] ?? fallback),
    ),
    getBoolean: jest.fn(async (_key: string, fallback = false) => fallback),
  };
  const db = { query: jest.fn(), withConnection: jest.fn() };
  let service: DependencyProviderHealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DependencyProviderHealthService(
      db as never,
      siteConf as never,
    );
  });

  it('uses the dedicated Jenkins identity for L2 and only reads the Job catalog for L3', async () => {
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({
        status: 200,
        data: { authenticated: true, name: 'dashboard-bot' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { jobs: [{ name: 'build-a' }] },
      });
    const definitions = await (service as any).definitions();
    const jenkins = definitions[0];
    await expect(jenkins.check('L2')).resolves.toMatchObject({
      status: 'PASS',
      reasonCode: 'OK',
    });
    await expect(jenkins.check('L3')).resolves.toMatchObject({
      status: 'PASS',
      metadata: { jobCount: 1 },
    });
    expect(axios.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'https://jenkins.example.com/whoAmI/api/json',
        auth: { username: 'dashboard-bot', password: 'secret-token' },
      }),
    );
    expect(axios.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: expect.stringContaining('/api/json?tree='),
      }),
    );
  });

  it('returns selectable provider profiles without returning SiteConf credential values', async () => {
    const profiles = await service.profiles();
    const jenkins = profiles.find((profile) => profile.id === 'jenkins-hash');
    expect(jenkins).toMatchObject({
      label: 'Jenkins / Hash', configured: true,
      suggestedUrl: 'https://jenkins.example.com',
    });
    expect(JSON.stringify(profiles)).not.toContain('secret-token');
    expect(JSON.stringify(profiles)).not.toContain('bytebase-secret');
  });

  it('checks the configured model without invoking completions', async () => {
    (axios.request as jest.Mock).mockResolvedValue({
      status: 200,
      data: { data: [{ id: 'gpt-5.6-terra' }] },
    });
    const definitions = await (service as any).definitions();
    const cliproxy = definitions.find((entry: any) =>
      entry.targetKeys.includes('cliproxy-api'),
    );
    await expect(cliproxy.check('L3')).resolves.toMatchObject({
      status: 'PASS',
      metadata: { model: 'gpt-5.6-terra' },
    });
    expect(axios.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://llm.example.com/v1/models' }),
    );
  });

  it('maps authentication failures without exposing credentials', async () => {
    (axios.request as jest.Mock).mockResolvedValue({
      status: 401,
      data: { message: 'token secret-token rejected' },
    });
    const definitions = await (service as any).definitions();
    await expect(definitions[0].check('L2')).rejects.toMatchObject({
      reasonCode: 'AUTH_FAILED',
      message: '专用凭据认证失败',
    });
  });

  it('uses the Bytebase catalog identity for L2 and a minimal project read for L3', async () => {
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({ status: 200, data: { token: 'short-token' } })
      .mockResolvedValueOnce({ status: 200, data: { token: 'short-token' } })
      .mockResolvedValueOnce({ status: 200, data: { projects: [{ name: 'projects/hash' }] } });
    const definitions = await (service as any).definitions();
    const bytebase = definitions.find((entry: any) => entry.targetKeys.includes('bytebase-hashex'));
    await expect(bytebase.check('L2')).resolves.toMatchObject({
      status: 'PASS', metadata: { identity: 'dashboard-catalog@example.com' },
    });
    await expect(bytebase.check('L3')).resolves.toMatchObject({
      status: 'PASS', metadata: { projectProbeCount: 1 },
    });
    expect(axios.request).toHaveBeenLastCalledWith(expect.objectContaining({
      url: 'https://bytebase.example.com/v1/projects?pageSize=1',
      headers: { Authorization: 'Bearer short-token' },
    }));
  });
});

describe('providerAlertTransition', () => {
  it('fires only after the configured consecutive failure threshold', () => {
    expect(providerAlertTransition('OK', 1, 'FAIL', 3)).toEqual({ state: 'OK', failures: 2, eventType: null });
    expect(providerAlertTransition('OK', 2, 'FAIL', 3)).toEqual({ state: 'FIRING', failures: 3, eventType: 'FIRING' });
    expect(providerAlertTransition('FIRING', 3, 'FAIL', 3)).toEqual({ state: 'FIRING', failures: 4, eventType: null });
  });

  it('emits one recovery event and resets the failure counter', () => {
    expect(providerAlertTransition('FIRING', 4, 'PASS', 3)).toEqual({ state: 'OK', failures: 0, eventType: 'RECOVERED' });
    expect(providerAlertTransition('OK', 0, 'PASS', 3)).toEqual({ state: 'OK', failures: 0, eventType: null });
  });
});
