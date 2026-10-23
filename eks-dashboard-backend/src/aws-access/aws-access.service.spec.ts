import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AWS_GLOBAL_SERVICE_ACTIONS,
  AwsAccessService,
  buildAwsAccessSessionPolicy,
} from './aws-access.service';

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
    getJson: jest.fn().mockImplementation(async (key: string) =>
      key.endsWith('security_group_write_scope')
        ? ['arn:aws:ec2:ap-east-1:290368114919:security-group/*']
        : [
            { resourceAccount: '290368114919', bucket: '*', prefix: '*' },
          ],
    ),
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
  it('returns a disabled environment configuration instead of falling back to hashex', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);
    const { service } = createService(query);

    const result = await service.configuration(actor, 'mgbx');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('environment_id=?'),
      ['mgbx'],
    );
    expect(result).toMatchObject({
      enabled: false,
      account: null,
      templates: [],
      regions: [],
    });
    expect(result.unavailableReason).toContain('mgbx');
  });

  it('filters the grant list by the selected environment', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);
    const { service } = createService(query);

    await service.listGrants(
      { ...actor, permissions: ['aws-access:grant:read-all'] },
      'mgbx',
    );

    expect(query.mock.calls[0][0]).toContain('WHERE g.environment_id=?');
    expect(query.mock.calls[0][1]).toEqual(['mgbx']);
  });

  it('exposes a clear, bounded contract for the human read template', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 1,
        environment_id: 'hashex',
        account_id: '290368114919',
        display_name: 'hashex',
        default_regions_json: '["ap-east-1"]',
      },
    ]);
    const { service, siteConf } = createService(query);
    siteConf.getString.mockImplementation(async (key: string) => {
      const roles: Record<string, string> = {
        'aws_access.hashex.human_read_role_arn':
          'arn:aws:iam::290368114919:role/DashboardHashexHumanReadRole',
        'aws_access.hashex.human_tag_write_role_arn':
          'arn:aws:iam::290368114919:role/DashboardHashexHumanTagWriteRole',
        'aws_access.hashex.human_security_group_write_role_arn':
          'arn:aws:iam::290368114919:role/DashboardHashexHumanSecurityGroupWriteRole',
        'aws_access.hashex.human_s3_write_role_arn':
          'arn:aws:iam::290368114919:role/DashboardHashexHumanS3WriteRole',
      };
      return roles[key] || '';
    });

    const result = await service.configuration(actor, 'hashex');

    expect(result.templates[0]).toMatchObject({
      key: 'HUMAN_READ',
      name: 'AWS 资源配置受控只读',
      riskLevel: 'LOW',
      maxDurationMinutes: 43200,
      verification: { writeActionsDenied: true },
    });
    expect(result.templates[0].allowedCapabilities.length).toBeGreaterThan(0);
    expect(result.templates[0].deniedCapabilities.length).toBeGreaterThan(0);
    expect(result.templates[0].policyReferences).toContain(
      'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess',
    );
    expect(result.templates[1]).toMatchObject({
      key: 'HUMAN_TAG_WRITE',
      name: 'AWS 治理标签维护',
      riskLevel: 'MEDIUM',
      targetRoleArn:
        'arn:aws:iam::290368114919:role/DashboardHashexHumanTagWriteRole',
    });
    expect(result.templates[2]).toMatchObject({
      key: 'HUMAN_SECURITY_GROUP_WRITE',
      riskLevel: 'HIGH',
      targetRoleArn:
        'arn:aws:iam::290368114919:role/DashboardHashexHumanSecurityGroupWriteRole',
    });
    expect(result.templates[3]).toMatchObject({
      key: 'HUMAN_S3_WRITE',
      riskLevel: 'HIGH',
      targetRoleArn:
        'arn:aws:iam::290368114919:role/DashboardHashexHumanS3WriteRole',
    });
  });

  it('renders template regions from the selected cloud account', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 2,
        environment_id: 'mgbx',
        account_id: '931324892624',
        display_name: 'mgbx',
        default_regions_json: '["ap-southeast-1"]',
      },
    ]);
    const { service, siteConf } = createService(query);
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'aws_access.mgbx.human_tag_write_role_arn'
        ? 'arn:aws:iam::931324892624:role/DashboardMgbxHumanTagWriteRole'
        : key === 'aws_access.mgbx.human_read_role_arn'
          ? 'arn:aws:iam::931324892624:role/DashboardMgbxHumanReadRole'
          : '',
    );

    const result = await service.configuration(actor, 'mgbx');
    const tagTemplate = result.templates.find(
      (template) => template.key === 'HUMAN_TAG_WRITE',
    );

    expect(result.regions).toEqual(['ap-southeast-1']);
    expect(tagTemplate?.notes).toContain(
      '写权限仅适用于 ap-southeast-1 的 EC2 Instance、EBS Volume 和 Security Group。',
    );
  });

  it('exempts global services from the regional deny boundary', () => {
    const policy = buildAwsAccessSessionPolicy(['ap-southeast-1']);
    const regionalDeny = policy.Statement[1];

    expect(regionalDeny).toMatchObject({
      Effect: 'Deny',
      NotAction: AWS_GLOBAL_SERVICE_ACTIONS,
      Condition: {
        StringNotEquals: {
          'aws:RequestedRegion': ['ap-southeast-1'],
        },
      },
    });
    expect(AWS_GLOBAL_SERVICE_ACTIONS).toContain('iam:*');
    expect(AWS_GLOBAL_SERVICE_ACTIONS).toContain('route53:*');
  });

  it('exposes the account-wide read-only template only when configured', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 2,
        environment_id: 'mgbx',
        account_id: '931324892624',
        display_name: 'mgbx',
        default_regions_json: '["ap-southeast-1"]',
      },
    ]);
    const { service, siteConf } = createService(query);
    siteConf.getString.mockImplementation(async (key: string) => {
      const values: Record<string, string> = {
        'aws_access.mgbx.human_read_role_arn':
          'arn:aws:iam::931324892624:role/DashboardMgbxHumanReadRole',
        'aws_access.mgbx.human_account_read_only_role_arn':
          'arn:aws:iam::931324892624:role/DashboardMgbxHumanAccountReadOnlyRole',
        'aws_access.mgbx.human_account_read_only_policy_arn':
          'arn:aws:iam::931324892624:policy/DashboardMgbxHumanAccountReadOnlyGuardrail',
      };
      return values[key] || '';
    });

    const result = await service.configuration(actor, 'mgbx');
    expect(result.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'HUMAN_ACCOUNT_READ_ONLY',
          name: 'AWS 账号资源全面只读',
          riskLevel: 'MEDIUM',
          targetRoleArn:
            'arn:aws:iam::931324892624:role/DashboardMgbxHumanAccountReadOnlyRole',
        }),
      ]),
    );
  });

  it('only marks the temporary admin template grantable for the independent permission holder', async () => {
    const account = {
      id: 2,
      environment_id: 'mgbx',
      account_id: '931324892624',
      display_name: 'mgbx',
      default_regions_json: '["ap-southeast-1"]',
    };
    const query = jest.fn().mockResolvedValue([account]);
    const { service, siteConf } = createService(query);
    siteConf.getString.mockImplementation(async (key: string) =>
      key === 'aws_access.mgbx.human_temporary_admin_role_arn'
        ? 'arn:aws:iam::931324892624:role/DashboardMgbxHumanTemporaryAdminRole'
        : '',
    );

    const ordinaryManager = await service.configuration(
      { ...actor, permissions: ['aws-access:grant:manage'] },
      'mgbx',
    );
    const privilegedManager = await service.configuration(
      {
        ...actor,
        permissions: [
          'aws-access:grant:manage',
          'aws-access:grant:temporary-admin',
        ],
      },
      'mgbx',
    );

    expect(
      ordinaryManager.templates.find(
        (template) => template.key === 'HUMAN_TEMPORARY_ADMIN',
      ),
    ).toMatchObject({ canGrant: false, riskLevel: 'HIGH' });
    expect(
      privilegedManager.templates.find(
        (template) => template.key === 'HUMAN_TEMPORARY_ADMIN',
      ),
    ).toMatchObject({ canGrant: true, riskLevel: 'HIGH' });
  });

  it('rejects temporary admin grants before MFA without the independent permission', async () => {
    const query = jest.fn();
    const { service, mfa } = createService(query);

    await expect(
      service.createGrant(
        { ...actor, permissions: ['aws-access:grant:manage'] },
        'mgbx',
        {
          granteeUserId: 8,
          cloudAccountId: 2,
          permissionTemplateKey: 'HUMAN_TEMPORARY_ADMIN',
          regions: ['ap-southeast-1'],
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          reason: '临时运维处理',
          mfaCode: '123456',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mfa.verifyForUser).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [
      'HUMAN_SECURITY_GROUP_WRITE',
      'human_security_group_write_role_arn',
      'DashboardHashexHumanSecurityGroupWriteRole',
    ],
    [
      'HUMAN_S3_WRITE',
      'human_s3_write_role_arn',
      'DashboardHashexHumanS3WriteRole',
    ],
  ])('binds %s to its dedicated role', async (templateKey, confSuffix, roleName) => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          environment_id: 'hashex',
          account_id: '290368114919',
          default_regions_json: '["ap-east-1"]',
        },
      ])
      .mockResolvedValueOnce([{ id: 8, username: 'writer', status: 'active' }])
      .mockResolvedValueOnce([{ insertId: 31 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const { service, siteConf } = createService(query);
    siteConf.getString.mockImplementation(async (key: string) =>
      key.endsWith(confSuffix)
        ? `arn:aws:iam::290368114919:role/${roleName}`
        : '',
    );

    await service.createGrant(
      { ...actor, permissions: ['aws-access:grant:manage'] },
      'hashex',
      {
        granteeUserId: 8,
        cloudAccountId: 1,
        permissionTemplateKey: templateKey,
        regions: ['ap-east-1'],
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        reason: '受控写入',
        mfaCode: '123456',
      },
    );

    expect(query.mock.calls[2][1][4]).toBe(templateKey);
    expect(query.mock.calls[2][1][5]).toBe(
      `arn:aws:iam::290368114919:role/${roleName}`,
    );
  });

  it('binds a human tag write grant to its dedicated role', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 1,
          environment_id: 'hashex',
          account_id: '290368114919',
          default_regions_json: '["ap-east-1"]',
        },
      ])
      .mockResolvedValueOnce([{ id: 8, username: 'writer', status: 'active' }])
      .mockResolvedValueOnce([{ insertId: 31 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const { service, siteConf } = createService(query);
    siteConf.getString.mockImplementation(async (key: string) =>
      key.endsWith('human_tag_write_role_arn')
        ? 'arn:aws:iam::290368114919:role/DashboardHashexHumanTagWriteRole'
        : '',
    );

    await service.createGrant(
      { ...actor, permissions: ['aws-access:grant:manage'] },
      'hashex',
      {
        granteeUserId: 8,
        cloudAccountId: 1,
        permissionTemplateKey: 'HUMAN_TAG_WRITE',
        regions: ['ap-east-1'],
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        reason: '维护治理标签',
        mfaCode: '123456',
      },
    );

    expect(query.mock.calls[2][1][4]).toBe('HUMAN_TAG_WRITE');
    expect(query.mock.calls[2][1][5]).toBe(
      'arn:aws:iam::290368114919:role/DashboardHashexHumanTagWriteRole',
    );
  });

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
        'hashex',
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
