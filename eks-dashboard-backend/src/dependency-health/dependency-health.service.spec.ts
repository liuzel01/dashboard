import axios from 'axios';
import { DependencyHealthService } from './dependency-health.service';

jest.mock('axios');

describe('DependencyHealthService', () => {
  const siteConf = {
    getJson: jest.fn(),
    getString: jest.fn(async () => 'http://127.0.0.1:9115'),
    getNumber: jest.fn(async () => 12000),
  };
  const service = new DependencyHealthService(siteConf as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns targets from every environment and parses blackbox metrics', async () => {
    siteConf.getJson.mockResolvedValue([
      { key: 'jenkins-mgbx', name: 'Jenkins mgbx', environmentId: 'mgbx', category: 'jenkins', url: 'http://jenkins/login' },
      { key: 'jenkins-icoin', name: 'Jenkins icoin', environmentId: 'icoin', category: 'jenkins', url: 'http://icoin/login' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({ data: 'probe_duration_seconds 0.125\nprobe_http_status_code 200\nprobe_success 1\n' });
    const result = await service.list();
    expect(result.summary).toEqual({ total: 2, healthy: 2, unhealthy: 0 });
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
});
