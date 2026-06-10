import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AiOpsService } from './ai-ops.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const actor = {
  userId: 1,
  username: 'tester',
  permissions: ['menu:ai-ops', 'aiops:sql:generate'],
  roles: [{ name: '运维' }],
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

const createService = (overrides?: Record<string, string>) => {
  const configValues: Record<string, string> = {
    AIOPS_LLM_PROVIDER: 'openclaw',
    AIOPS_OPENCLAW_BASE_URL: 'http://openclaw.local/v1',
    AIOPS_OPENCLAW_TOKEN: 'test-token',
    AIOPS_OPENCLAW_MODEL: 'openclaw/default',
    ...(overrides || {}),
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
  const siteConf = {
    getNumber: jest.fn(async (key: string, fallback: number) => fallback),
  };

  const service = new AiOpsService(
    config as any,
    database as any,
    platformDb as any,
    authService as any,
    accessControl as any,
    environments as any,
    siteConf as any,
  );

  return {
    service,
    database,
    platformDb,
    config,
    environments,
    siteConf,
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
    expect(result.sqlType).toBe('read');
    expect(result.riskLevel).toBe('low');
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

  it('keeps executeSql disabled at service layer', async () => {
    const { service } = createService();
    await expect(
      service.executeSql('test-env', actor as any, {
        sql: 'SELECT 1',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows write SQL preview generation', async () => {
    const { service } = createService();
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: "DELETE FROM spot.tbl_tx_mock WHERE user_id = 1 AND id = '2'" } }],
      },
    } as any);

    const result = await service.previewSql('test-env', actor as any, {
      question: '删除 user_id=1 且 id=2 的模拟交易记录',
    } as any);

    expect(result.ok).toBe(true);
    expect(result.executedSql).toContain('DELETE FROM spot.tbl_tx_mock');
    expect(result.appliedLimit).toBeNull();
    expect(result.sqlType).toBe('write');
    expect(result.riskLevel).toBe('high');
  });

  it('injects few-shot context when csv is configured', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiops-fewshot-'));
    const csvPath = path.join(dir, 'nl2sql_fewshot_cases.csv');
    await fs.writeFile(
      csvPath,
      [
        'case_id,priority,business_domain,intent_type,user_question,expected_sql,expected_output_shape,must_conditions,forbidden_patterns,allowed_databases,allowed_tables,default_limit,max_limit,time_range_hint,review_status,owner,reviewer,last_updated,notes',
        'CASE_001,P0,user,lookup,查询用户uid,SELECT uid FROM spot.users WHERE uid = 1 LIMIT 1,,, ,spot,spot.users,,,none,approved,,,,',
      ].join('\n'),
      'utf8',
    );

    try {
      const { service } = createService({
        AIOPS_NL2SQL_FEWSHOT_CASES_PATH: csvPath,
      });
      mockedAxios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'SELECT uid FROM spot.users WHERE uid = 1 LIMIT 1' } }],
        },
      } as any);

      const result = await service.previewSql('test-env', actor as any, {
        question: '查询 uid = 1 的用户',
      } as any);

      expect(result.ok).toBe(true);
      const payload = mockedAxios.post.mock.calls[0]?.[1] as
        | { messages?: Array<{ role: string; content: string }> }
        | undefined;
      const messages = payload?.messages || [];
      const joined = messages.map((m) => m.content).join('\n');
      expect(joined).toContain('Few-shot SQL examples');
      expect(joined).toContain('CASE_001');
      expect(joined).toContain('SELECT uid FROM spot.users');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('lists sql audit only for current user when actor is non-admin', async () => {
    const { service, platformDb } = createService();
    platformDb.query.mockReset();
    platformDb.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    await service.listSqlAudit('test-env', actor as any, 1, 20);

    const listCall = platformDb.query.mock.calls[0];
    const totalCall = platformDb.query.mock.calls[1];
    expect(String(listCall[0])).toContain('environment_id = ? AND actor_user_id = ?');
    expect(listCall[1]).toEqual(['test-env', 1, 20, 0]);
    expect(String(totalCall[0])).toContain('environment_id = ? AND actor_user_id = ?');
    expect(totalCall[1]).toEqual(['test-env', 1]);
  });

  it('lists sql audit for all users when actor has admin role', async () => {
    const { service, platformDb } = createService();
    platformDb.query.mockReset();
    platformDb.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const adminActor = {
      ...actor,
      userId: 99,
      username: 'admin-user',
      roles: [{ name: 'admin' }],
    };
    await service.listSqlAudit('test-env', adminActor as any, 1, 20);

    const listCall = platformDb.query.mock.calls[0];
    const totalCall = platformDb.query.mock.calls[1];
    expect(String(listCall[0])).toContain('WHERE environment_id = ?');
    expect(String(listCall[0])).not.toContain('AND actor_user_id = ?');
    expect(listCall[1]).toEqual(['test-env', 20, 0]);
    expect(String(totalCall[0])).toContain('WHERE environment_id = ?');
    expect(totalCall[1]).toEqual(['test-env']);
  });
});
