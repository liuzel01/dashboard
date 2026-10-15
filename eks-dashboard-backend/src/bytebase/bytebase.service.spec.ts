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

  it('submits the draft only after admin MFA confirmation', async () => {
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
        data: { planCheckRunStatusCount: { SUCCESS: 2, DONE: 1 } },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: 'projects/p/issues/1', draft: false },
      });

    await expect(
      service.createRollout('Bearer dashboard', {
        environmentId: 'hashex',
        plan: 'projects/p/plans/1',
        mfaCode: '123456',
      }),
    ).resolves.toMatchObject({ status: 'RELEASE_CONFIRMED' });

    expect(mfa.verifyForUser).toHaveBeenCalledWith(1, '123456');
    expect(axios.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        url: 'https://bytebase.example.com/v1/projects/p/issues/1?updateMask=draft',
        data: { name: 'projects/p/issues/1', draft: false },
      }),
    );
    expect(
      (axios.request as jest.Mock).mock.calls.some(
        ([request]) =>
          request.method === 'POST' && request.url.endsWith('/rollout'),
      ),
    ).toBe(false);
  });
});
