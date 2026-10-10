import { parseSpotPublishCatalog } from './cicd-spot-publish.service';
import axios from 'axios';
import { CicdSpotPublishService } from './cicd-spot-publish.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const catalogHtml = `<input name="registry" value="registry.example.com" />
  <table><tbody>
    <tr><td>service-a</td><td>ssh://git/repo-a.git</td><td></td><td></td><td><input type="text" value="icoin" /></td></tr>
  </tbody></table>`;

const createService = () => {
  const db = { query: jest.fn() };
  const siteConf = {
    getString: jest.fn(async (key: string) => {
      if (key.endsWith('signin_url')) return 'https://publish.example.com/signin';
      if (key.endsWith('username')) return 'bot';
      if (key.endsWith('password')) return 'secret';
      return '';
    }),
    getNumber: jest.fn().mockResolvedValue(120_000),
  };
  return {
    service: new CicdSpotPublishService(db as never, siteConf as never),
    db,
  };
};

describe('spot publish catalog parser', () => {
  it('extracts controlled services and skips placeholders', () => {
    const html = `<input name="registry" value="registry.example.com" />
      <table><tbody>
        <tr><td>service-a</td><td>ssh://git/repo-a.git</td><td></td><td></td><td><input type="text" value="icoin" /></td></tr>
        <tr><td>_</td><td>ssh://git/placeholder.git</td><td></td><td></td><td><input type="text" value="icoin" /></td></tr>
      </tbody></table>`;
    expect(parseSpotPublishCatalog(html)).toEqual([
      {
        name: 'service-a',
        repo: 'ssh://git/repo-a.git',
        defaultRef: 'icoin',
        registries: ['registry.example.com'],
      },
    ]);
  });

  it('authenticates once and caches the controlled service catalog', async () => {
    const { service } = createService();
    mockedAxios.post.mockResolvedValue({ status: 200, data: catalogHtml });

    const first = await service.catalog();
    const second = await service.catalog();

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://publish.example.com/signin',
      expect.stringContaining('username=bot'),
      expect.objectContaining({ responseType: 'text', maxRedirects: 0 }),
    );
  });

  it('marks a claimed external task successful with its image tag', async () => {
    const { service, db } = createService();
    db.query
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([
        {
          id: 9,
          run_id: 'run-1',
          service_key: 'service-a',
          git_ref: 'icoin',
          registry: 'registry.example.com',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });
    jest.spyOn(service, 'catalog').mockResolvedValue([
      {
        name: 'service-a',
        repo: 'ssh://git/repo-a.git',
        defaultRef: 'icoin',
        registries: ['registry.example.com'],
      },
    ]);
    jest
      .spyOn(
        service as unknown as {
          execute(...args: unknown[]): Promise<{ success: boolean; tag: string }>;
        },
        'execute',
      )
      .mockResolvedValue({ success: true, tag: 'service-a:20261010' });

    await service.work();

    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('SET t.status=?'),
      ['SUCCESS', 'service-a:20261010', 'SUCCESS', null, 9],
    );
  });

  it('marks a claimed external task UNKNOWN when the remote result is uncertain', async () => {
    const { service, db } = createService();
    db.query
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([
        {
          id: 9,
          run_id: 'run-1',
          service_key: 'service-a',
          git_ref: 'icoin',
          registry: 'registry.example.com',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });
    jest.spyOn(service, 'catalog').mockRejectedValue(new Error('remote timeout'));

    await service.work();

    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET t.status='UNKNOWN'"),
      expect.arrayContaining(['remote timeout']),
    );
  });
});
