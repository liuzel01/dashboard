import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { AiOpsService } from './ai-ops.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const actor = {
  userId: 1,
  username: 'tester',
  permissions: ['menu:ai-ops', 'aiops:sql:generate'],
};

const envConfig = {
  id: 'test-env',
  database: {
    aiops: {
      whitelist_tables: ['spot.*'],
      whitelist_databases: ['spot'],
      default_limit: 200,
      max_limit: 1000,
      timeout_ms: 5000,
    },
  },
};

const createService = () => {
  const configValues: Record<string, string> = {
    AIOPS_LLM_PROVIDER: 'openclaw',
    AIOPS_OPENCLAW_BASE_URL: 'http://openclaw.local/v1',
    AIOPS_OPENCLAW_TOKEN: 'test-token',
    AIOPS_OPENCLAW_MODEL: 'openclaw/default',
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const database = {
    runQuery: jest.fn(async (_environmentId: string, sql: string) => {
      if (sql.includes('information_schema.COLUMNS')) {
        return [[
          {
            tableSchema: 'spot',
            tableName: 'users',
            columnName: 'uid',
            ordinalPosition: 1,
          },
          {
            tableSchema: 'spot',
            tableName: 'users',
            columnName: 'email',
            ordinalPosition: 2,
          },
        ]];
      }
      return [[]];
    }),
  };
  const platformDb = {
    query: jest.fn(async () => ({ insertId: 1, affectedRows: 1 })),
  };
  const authService = {
    verifyToken: jest.fn(),
  };
  const accessControl = {
    ensureUserByUsername: jest.fn(),
    getMe: jest.fn(),
  };
  const environments = {
    getEnvironmentById: jest.fn(() => envConfig),
  };

  const service = new AiOpsService(
    config as any,
    database as any,
    platformDb as any,
    authService as any,
    accessControl as any,
    environments as any,
  );

  return {
    service,
    database,
    platformDb,
    config,
    environments,
  };
};

describe('AiOpsService previewSql security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds LIMIT and execution hint for preview SQL input', async () => {
    const { service } = createService();
    const result = await service.previewSql('test-env', actor as any, {
      sql: 'SELECT uid FROM spot.users',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.executedSql).toContain('MAX_EXECUTION_TIME(5000)');
    expect(result.executedSql).toContain('FROM spot.users LIMIT 200');
    expect(result.source).toBe('sql');
  });

  it('rejects disallowed table by whitelist', async () => {
    const { service } = createService();
    await expect(
      service.previewSql('test-env', actor as any, {
        sql: 'SELECT uid FROM tiger.users LIMIT 1',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('retries generation when SQL is invalid and succeeds after rewrite', async () => {
    const { service } = createService();
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'SELECT * FROM users LIMIT 1' } }],
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'SELECT uid FROM spot.users LIMIT 1' } }],
        },
      } as any);

    const result = await service.previewSql('test-env', actor as any, {
      question: '查询用户 uid',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.executedSql).toContain('FROM spot.users LIMIT 1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('fails after max retries when model keeps generating unqualified table', async () => {
    const { service } = createService();
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'SELECT * FROM users LIMIT 1' } }],
      },
    } as any);

    await expect(
      service.previewSql('test-env', actor as any, {
        question: '查询用户',
      } as any),
    ).rejects.toThrow(BadRequestException);
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });
});
