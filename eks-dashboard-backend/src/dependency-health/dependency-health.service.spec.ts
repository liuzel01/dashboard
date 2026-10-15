import axios from 'axios';
import { DependencyHealthService } from './dependency-health.service';

jest.mock('axios');

describe('DependencyHealthService', () => {
  const siteConf = {
    getJson: jest.fn(),
    getString: jest.fn(async () => 'http://127.0.0.1:9115'),
    getNumber: jest.fn(async (key: string) => key === 'dependency_health.cache_ttl_ms' ? 55000 : 12000),
  };
  let service: DependencyHealthService;
  const providers = {
    latest: jest.fn(async () => new Map()),
    targetKeys: jest.fn(async () => new Set<string>()),
    hasProfile: jest.fn(() => true),
  };
  const db = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    providers.latest.mockResolvedValue(new Map());
    providers.targetKeys.mockResolvedValue(new Set<string>());
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM dependency_health_targets')) throw new Error('migration not applied');
      return [];
    });
    service = new DependencyHealthService(siteConf as never, providers as never, db as never);
  });

  it('returns targets from every environment and parses blackbox metrics', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'jenkins-mgbx', name: 'Jenkins mgbx', environmentId: 'mgbx', category: 'jenkins', url: 'http://jenkins/login' },
      { key: 'jenkins-icoin', name: 'Jenkins icoin', environmentId: 'icoin', category: 'jenkins', url: 'http://icoin/login' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({ data: 'probe_duration_seconds 0.125\nprobe_http_status_code 200\nprobe_success 1\n' });
    const result = await service.list();
    expect(result.summary).toEqual({ total: 2, healthy: 2, unhealthy: 0, checking: 0 });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'jenkins-mgbx', environmentId: 'mgbx', healthy: true, httpStatus: 200, durationMs: 125 }),
      expect.objectContaining({ key: 'jenkins-icoin', environmentId: 'icoin', healthy: true, httpStatus: 200, durationMs: 125 }),
    ]));
  });

  it('does not probe credential-bearing URLs', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'unsafe-target', name: 'Unsafe', environmentId: 'mgbx', category: 'api', url: 'https://user:pass@example.com/health' },
    ]);
    await expect(service.list()).rejects.toThrow('URL is not allowed');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('supports the controlled reachability module', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'gitlab-api', name: 'GitLab API', environmentId: 'global', category: 'gitlab', url: 'https://git.example.com/api/v4/version', module: 'http_reachable' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({ data: 'probe_duration_seconds 0.25\nprobe_http_status_code 401\nprobe_success 1\n' });
    const result = await service.list();
    expect(result.items[0]).toMatchObject({ key: 'gitlab-api', module: 'http_reachable', healthy: true, httpStatus: 401 });
  });

  it('reuses a recent snapshot instead of probing again', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'dashboard-api', name: 'Dashboard API', environmentId: 'global', category: 'dashboard', url: 'https://dashboard.example.com/health' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({ data: 'probe_duration_seconds 0.1\nprobe_http_status_code 200\nprobe_success 1\n' });
    const first = await service.list();
    const second = await service.list();
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.stale).toBe(false);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent refreshes into one probe round', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'dashboard-api', name: 'Dashboard API', environmentId: 'global', category: 'dashboard', url: 'https://dashboard.example.com/health' },
    ]);
    let resolveProbe!: (value: { data: string }) => void;
    const probePromise = new Promise<{ data: string }>((resolve) => { resolveProbe = resolve; });
    (axios.get as jest.Mock).mockReturnValue(probePromise);
    const first = service.list();
    const second = service.list();
    resolveProbe({ data: 'probe_duration_seconds 0.1\nprobe_http_status_code 200\nprobe_success 1\n' });
    await Promise.all([first, second]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('uses L2 and L3 results to produce one composite status', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'jenkins-mgbx', name: 'Jenkins mgbx', environmentId: 'mgbx', category: 'jenkins', url: 'http://jenkins/login', module: 'http_reachable' },
    ]);
    providers.targetKeys.mockResolvedValue(new Set(['jenkins-mgbx']));
    providers.latest.mockResolvedValue(new Map([['jenkins-mgbx', {
      L2: { targetKey: 'jenkins-mgbx', layer: 'L2', status: 'PASS', reasonCode: 'OK', summary: 'identity ok', durationMs: 10, metadata: null, checkedAt: new Date().toISOString() },
      L3: { targetKey: 'jenkins-mgbx', layer: 'L3', status: 'FAIL', reasonCode: 'BUSINESS_CHECK_FAILED', summary: 'catalog failed', durationMs: 20, metadata: null, checkedAt: new Date().toISOString() },
    }]]));
    (axios.get as jest.Mock).mockResolvedValue({ data: 'probe_duration_seconds 0.1\nprobe_http_status_code 403\nprobe_success 1\n' });
    const result = await service.list();
    expect(result.items[0]).toMatchObject({ healthy: false, overallStatus: 'BUSINESS_FAILED', verificationDepth: 'L3' });
    expect(result.summary).toMatchObject({ healthy: 0, unhealthy: 1, checking: 0 });
  });
});
