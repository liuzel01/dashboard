/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import axios from 'axios';
import { ForbiddenException } from '@nestjs/common';
import { BytebaseService } from './bytebase.service';

jest.mock('axios');

describe('BytebaseService', () => {
  const db = { query: jest.fn() };
  const auth = {
    verifyToken: jest.fn(async () => ({
      sub: 1,
      username: 'admin',
      source: 'local',
    })),
  };
  const access = {
    getMe: jest.fn(async () => ({
      id: 1,
      username: 'admin',
      permissions: [
        'menu:bytebase',
        'bytebase:catalog:read',
        'bytebase:config:manage',
      ],
    })),
    ensureUserByUsername: jest.fn(),
  };
  const siteConf = { getString: jest.fn() };
  const mfa = { verifyForUser: jest.fn() };
  let service: BytebaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BytebaseService(
      db as any,
      auth as any,
      access as any,
      siteConf as any,
      mfa as any,
    );
  });

  it('reports JIT as unsupported without calling Bytebase or an admin fallback', async () => {
    db.query.mockResolvedValueOnce([
      {
        environment_id: 'hashex',
        executor_key: 'hashex-bytebase',
        enabled: 1,
        base_url_conf_key: 'url',
        catalog_email_conf_key: 'ce',
        catalog_key_conf_key: 'ck',
        reader_email_conf_key: 're',
        reader_key_conf_key: 'rk',
        submitter_email_conf_key: 'se',
        submitter_key_conf_key: 'sk',
        deployer_email_conf_key: 'de',
        deployer_key_conf_key: 'dk',
        capabilities_json: '["CATALOG"]',
      },
    ]);
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'url' ? 'https://bytebase.example.com' : 'configured',
    );
    await expect(
      service.jitCapability('Bearer token', 'hashex'),
    ).resolves.toMatchObject({ supported: false, status: 'UNSUPPORTED' });
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('requires Dashboard permission before any Bytebase configuration lookup', async () => {
    access.getMe.mockResolvedValueOnce({
      id: 1,
      username: 'user',
      permissions: ['menu:bytebase'],
    });
    await expect(
      service.catalog('Bearer token', 'hashex'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('creates the Bytebase issue as a draft so submission cannot auto-deploy', async () => {
    access.getMe.mockResolvedValueOnce({
      id: 2,
      username: 'developer',
      permissions: ['bytebase:change:submit'],
    });
    db.query
      .mockResolvedValueOnce([
        {
          environment_id: 'hashex',
          executor_key: 'hashex-bytebase',
          enabled: 1,
          base_url_conf_key: 'url',
          catalog_email_conf_key: 'ce',
          catalog_key_conf_key: 'ck',
          reader_email_conf_key: 're',
          reader_key_conf_key: 'rk',
          submitter_email_conf_key: 'se',
          submitter_key_conf_key: 'sk',
          deployer_email_conf_key: 'de',
          deployer_key_conf_key: 'dk',
        },
      ])
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'url' ? 'https://bytebase.example.com' : 'configured',
    );
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'token' },
    });
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({
        status: 200,
        data: { databases: [{ name: 'instances/i/databases/d' }] },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/sheets/1' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/plans/1' },
      })
      .mockResolvedValueOnce({ status: 200, data: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/issues/1' },
      });

    await expect(
      service.createChange('Bearer dashboard', {
        environmentId: 'hashex',
        project: 'projects/p',
        database: 'instances/i/databases/d',
        title: 'safe change',
        statement: 'SELECT 1',
      }),
    ).resolves.toMatchObject({ status: 'AWAITING_ADMIN_CONFIRMATION' });

    expect(axios.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://bytebase.example.com/v1/projects/p/issues',
        data: expect.objectContaining({ draft: true }),
      }),
    );
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining("status='AWAITING_ADMIN_CONFIRMATION'"),
      ['projects/p/issues/1', 'projects/p/plans/1', expect.any(String)],
    );
  });

  it('submits the draft and starts its first rollout stage after one admin MFA confirmation', async () => {
    access.getMe.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      permissions: ['bytebase:rollout:execute'],
    });
    db.query
      .mockResolvedValueOnce([
        {
          environment_id: 'hashex',
          executor_key: 'hashex-bytebase',
          enabled: 1,
          base_url_conf_key: 'url',
          catalog_email_conf_key: 'ce',
          catalog_key_conf_key: 'ck',
          reader_email_conf_key: 're',
          reader_key_conf_key: 'rk',
          submitter_email_conf_key: 'se',
          submitter_key_conf_key: 'sk',
          deployer_email_conf_key: 'de',
          deployer_key_conf_key: 'dk',
        },
      ])
      .mockResolvedValueOnce([
        {
          request_id: 'request-1',
          status: 'AWAITING_ADMIN_CONFIRMATION',
          issue_name: 'projects/p/issues/1',
          plan_name: 'projects/p/plans/1',
          database_name: 'instances/i/databases/d',
          sql_sha256:
            'e004ebd5b5532a4b85984a62f8ad48a81aa3460c1ca07701f386135d72cdecf5',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'url' ? 'https://bytebase.example.com' : 'configured',
    );
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'token' },
    });
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          planCheckRunStatusCount: { SUCCESS: 2, DONE: 1 },
          specs: [
            {
              changeDatabaseConfig: {
                targets: ['instances/i/databases/d'],
                sheet: 'projects/p/sheets/1',
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          name: 'projects/p/issues/1',
          plan: 'projects/p/plans/1',
          draft: true,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { content: Buffer.from('SELECT 1').toString('base64') },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/issues/1', draft: false },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          name: 'projects/p/plans/1/rollout',
          stages: [
            {
              name: 'projects/p/plans/1/rollout/stages/prod',
              tasks: [
                {
                  name: 'projects/p/plans/1/rollout/stages/prod/tasks/1',
                  status: 'NOT_STARTED',
                },
              ],
            },
          ],
        },
      });
    (axios.request as jest.Mock).mockResolvedValueOnce({ status: 200, data: {} });

    await expect(
      service.createRollout('Bearer dashboard', {
        environmentId: 'hashex',
        plan: 'projects/p/plans/1',
        mfaCode: '123456',
      }),
    ).resolves.toMatchObject({ status: 'ROLLOUT_RUNNING', taskCount: 1 });

    expect(mfa.verifyForUser).toHaveBeenCalledWith(1, '123456');
    expect(axios.request).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: 'PATCH',
        url: 'https://bytebase.example.com/v1/projects/p/issues/1?updateMask=draft',
        data: { name: 'projects/p/issues/1', draft: false },
      }),
    );
    expect(axios.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://bytebase.example.com/v1/projects/p/plans/1/rollout/stages/prod/tasks:batchRun',
      }),
    );
  });

  it('starts only the first runnable Bytebase rollout stage after admin MFA verification', async () => {
    access.getMe.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      permissions: ['bytebase:rollout:execute'],
    });
    db.query
      .mockResolvedValueOnce([
        {
          environment_id: 'hashex',
          executor_key: 'hashex-bytebase',
          enabled: 1,
          base_url_conf_key: 'url',
          catalog_email_conf_key: 'ce',
          catalog_key_conf_key: 'ck',
          reader_email_conf_key: 're',
          reader_key_conf_key: 'rk',
          submitter_email_conf_key: 'se',
          submitter_key_conf_key: 'sk',
          deployer_email_conf_key: 'de',
          deployer_key_conf_key: 'dk',
        },
      ])
      .mockResolvedValueOnce([
        {
          request_id: '11111111-1111-4111-8111-111111111111',
          environment_id: 'hashex',
          status: 'ROLLOUT_READY',
          issue_name: 'projects/p/issues/1',
          plan_name: 'projects/p/plans/1',
          rollout_name: 'projects/p/plans/1/rollout',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 });
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'url' ? 'https://bytebase.example.com' : 'configured',
    );
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'token' },
    });
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          name: 'projects/p/plans/1/rollout',
          stages: [
            {
              name: 'projects/p/plans/1/rollout/stages/prod',
              tasks: [
                {
                  name: 'projects/p/plans/1/rollout/stages/prod/tasks/1',
                  status: 'NOT_STARTED',
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({ status: 200, data: {} });

    await expect(
      service.createRollout('Bearer dashboard', {
        environmentId: 'hashex',
        plan: 'projects/p/plans/1',
        mfaCode: '123456',
      }),
    ).resolves.toMatchObject({ status: 'ROLLOUT_RUNNING', taskCount: 1 });

    expect(mfa.verifyForUser).toHaveBeenCalledWith(1, '123456');
    expect(axios.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://bytebase.example.com/v1/projects/p/plans/1/rollout/stages/prod/tasks:batchRun',
        data: {
          parent: 'projects/p/plans/1/rollout/stages/prod',
          tasks: ['projects/p/plans/1/rollout/stages/prod/tasks/1'],
        },
      }),
    );
  });

  it('lets an admin cancel a draft issue without creating a rollout', async () => {
    access.getMe.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      permissions: ['bytebase:rollout:execute'],
    });
    db.query
      .mockResolvedValueOnce([
        {
          request_id: 'request-1',
          environment_id: 'hashex',
          status: 'AWAITING_ADMIN_CONFIRMATION',
          issue_name: 'projects/p/issues/1',
          plan_name: 'projects/p/plans/1',
        },
      ])
      .mockResolvedValueOnce([
        {
          environment_id: 'hashex',
          executor_key: 'hashex-bytebase',
          enabled: 1,
          base_url_conf_key: 'url',
          catalog_email_conf_key: 'ce',
          catalog_key_conf_key: 'ck',
          reader_email_conf_key: 're',
          reader_key_conf_key: 'rk',
          submitter_email_conf_key: 'se',
          submitter_key_conf_key: 'sk',
          deployer_email_conf_key: 'de',
          deployer_key_conf_key: 'dk',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 });
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'url' ? 'https://bytebase.example.com' : 'configured',
    );
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'token' },
    });
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/issues/1', draft: true },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/plans/1', state: 'DELETED' },
      });

    await expect(
      service.cancelRequest('Bearer dashboard', 'request-1', {
        mfaCode: '123456',
        reason: 'no longer needed',
      }),
    ).resolves.toEqual({
      requestId: 'request-1',
      status: 'CANCELLED',
      bestEffort: false,
    });

    expect(mfa.verifyForUser).toHaveBeenCalledWith(1, '123456');
    expect(axios.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        url: 'https://bytebase.example.com/v1/projects/p/plans/1?updateMask=state',
        data: { name: 'projects/p/plans/1', state: 'DELETED' },
      }),
    );
  });

  it('extracts failed task-run diagnostics without returning executed statements', () => {
    const result = (service as any).summarizeTaskRun(
      {
        name: 'projects/p/plans/1/rollout/stages/prod/tasks/1/taskRuns/2',
        status: 'FAILED',
        detail: 'migration failed',
      },
      [
        {
          type: 'TRANSACTION_CONTROL',
          transactionControl: { type: 'BEGIN' },
        },
        {
          type: 'COMMAND_EXECUTE',
          commandExecute: {
            statement: 'UPDATE secret_table SET password="secret"',
            response: { error: 'Duplicate entry 1 for key PRIMARY' },
          },
        },
        {
          type: 'TRANSACTION_CONTROL',
          transactionControl: { type: 'ROLLBACK' },
        },
      ],
    );

    expect(result.errors).toEqual([
      'migration failed',
      'Duplicate entry 1 for key PRIMARY',
    ]);
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'TRANSACTION_CONTROL',
          action: 'BEGIN',
        }),
        expect.objectContaining({
          type: 'COMMAND_EXECUTE',
          status: 'ERROR',
          error: 'Duplicate entry 1 for key PRIMARY',
        }),
        expect.objectContaining({
          type: 'TRANSACTION_CONTROL',
          action: 'ROLLBACK',
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('secret_table');
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('reconciles a completed rollout without issuing another write request', async () => {
    db.query
      .mockResolvedValueOnce([
        {
          request_id: 'request-1',
          environment_id: 'hashex',
          status: 'ROLLOUT_RUNNING',
          issue_name: 'projects/p/issues/1',
          plan_name: 'projects/p/plans/1',
        },
      ])
      .mockResolvedValueOnce([
        {
          environment_id: 'hashex',
          executor_key: 'hashex-bytebase',
          enabled: 1,
          base_url_conf_key: 'url',
          catalog_email_conf_key: 'ce',
          catalog_key_conf_key: 'ck',
          reader_email_conf_key: 're',
          reader_key_conf_key: 'rk',
          submitter_email_conf_key: 'se',
          submitter_key_conf_key: 'sk',
          deployer_email_conf_key: 'de',
          deployer_key_conf_key: 'dk',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 });
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'url' ? 'https://bytebase.example.com' : 'configured',
    );
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'token' },
    });
    (axios.request as jest.Mock)
      .mockResolvedValueOnce({
        status: 200,
        data: { status: 'DONE', approvalStatus: 'SKIPPED' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          name: 'projects/p/plans/1/rollout',
          stages: [
            {
              tasks: [
                {
                  name: 'projects/p/plans/1/rollout/stages/e/tasks/1',
                  status: 'DONE',
                },
              ],
            },
          ],
        },
      });

    await expect(service.reconcileRequest('request-1')).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('task_summary_json'),
      expect.arrayContaining(['SUCCEEDED', 'DONE']),
    );
    expect(
      (axios.request as jest.Mock).mock.calls.every(
        ([request]) => request.method === 'GET',
      ),
    ).toBe(true);
  });
});
