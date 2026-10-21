import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AwsAccessService } from './aws-access.service';

const actor = {
  userId: 7,
  username: 'user@example.com',
  displayName: 'User',
  roleIds: [4],
  permissions: ['menu:aws-access', 'aws-access:session:start'],
};

const createService = (query: jest.Mock) => {
  const db = {
    query,
    withTransaction: jest.fn((fn) => fn({ execute: query })),
  };
  const mfa = { verifyForUser: jest.fn() };
  const audit = { record: jest.fn() };
  const siteConf = {
    getBoolean: jest.fn().mockResolvedValue(true),
    getNumber: jest.fn().mockResolvedValue(120),
    getString: jest.fn(),
  };
  const credentials = { createAssumeRoleCredentials: jest.fn() };
  return {
    service: new AwsAccessService(
      db as never,
      mfa as never,
      audit as never,
      siteConf as never,
      credentials as never,
    ),
    db,
    mfa,
    siteConf,
  };
};

describe('AwsAccessService', () => {
  it('rejects preparing a grant owned by another user', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 10,
        grantee_user_id: 8,
        status: 'ACTIVE',
        valid_until: '2099-01-01 00:00:00.000',
      },
    ]);
    const { service } = createService(query);

    await expect(service.prepareSession(actor, 10)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a previously consumed one-time ticket', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 20,
        grant_id: 10,
        grantee_user_id: 7,
        status: 'CONSUMED',
      },
    ]);
    const { service } = createService(query);

    await expect(
      service.consumeSession(actor, 'ticket'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies a ticket bound to a stale grant hash', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 20,
          grant_id: 10,
          grantee_user_id: 7,
          status: 'PREPARED',
          expires_at: '2099-01-01 00:00:00.000',
          grant_hash: 'old',
          current_grant_hash: 'new',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ insertId: 2 });
    const { service } = createService(query);

    await expect(
      service.consumeSession(actor, 'ticket'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query.mock.calls[1][1]).toEqual(['STALE_GRANT_HASH', 20]);
  });

  it('requires an allowlisted permission template after MFA verification', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 1,
        environment_id: 'hashex',
        account_id: '290368114919',
        default_regions_json: '["ap-east-1"]',
      },
    ]);
    const { service, mfa } = createService(query);

    await expect(
      service.createGrant(
        { ...actor, permissions: ['aws-access:grant:manage'] },
        {
          granteeUserId: 7,
          cloudAccountId: 1,
          permissionTemplateKey: 'HUMAN_WRITE',
          regions: ['ap-east-1'],
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          reason: 'test',
          mfaCode: '123456',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mfa.verifyForUser).toHaveBeenCalledWith(7, '123456');
  });

  it('expires active grants and prepared tickets exactly once', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 10, grant_hash: 'grant-hash' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ insertId: 2 })
      .mockResolvedValueOnce([
        { id: 20, grant_id: 10, grant_hash: 'grant-hash' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 3 })
      .mockResolvedValueOnce({ insertId: 4 });
    const { service } = createService(query);

    await service.expire();

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("status='EXPIRED'"),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes('aws_access_grant_events'),
      ),
    ).toHaveLength(2);
  });
});
