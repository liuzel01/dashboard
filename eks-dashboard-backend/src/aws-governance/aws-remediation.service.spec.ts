import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AwsRemediationService } from './aws-remediation.service';

describe('AwsRemediationService', () => {
  const actor = {
    userId: 7,
    username: 'requester',
    displayName: 'Requester',
    roleIds: [1],
    permissions: [],
  };
  const siteConf = {
    getString: jest.fn(async (key: string) =>
      key.endsWith('allowed_tag_keys')
        ? '["environment","owner"]'
        : 'arn:aws:iam::290368114919:role/test',
    ),
  };
  const mfa = { verifyForUser: jest.fn() };

  const serviceWith = (query: jest.Mock) =>
    new AwsRemediationService(
      { query } as never,
      mfa as never,
      siteConf as never,
      { createAssumeRoleCredentials: jest.fn() } as never,
    );

  const input = {
    desiredTags: { environment: 'hashex', owner: 'platform' },
    reason: '补齐治理标签',
    rollbackPlan: '恢复执行前标签',
    maintenanceStart: '2026-10-21T00:00:00.000Z',
    maintenanceEnd: '2026-10-21T01:00:00.000Z',
    clientRequestId: 'request-1',
  };

  it('rejects arbitrary tag keys before creating a task', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 1,
          cloud_account_id: 1,
          environment_id: 'hashex',
          rule_key: 'required-tags-missing',
          resource_type: 'ec2:instance',
          resource_id: 'i-test',
          region: 'ap-east-1',
          status: 'OPEN',
        },
      ]);
    await expect(
      serviceWith(query).create(actor, 1, 1, {
        ...input,
        desiredTags: { Name: 'forbidden' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported finding types', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 1,
          cloud_account_id: 1,
          environment_id: 'hashex',
          rule_key: 'required-tags-missing',
          resource_type: 'eks:cluster',
          resource_id: 'cluster',
          region: 'ap-east-1',
          status: 'OPEN',
        },
      ]);
    await expect(
      serviceWith(query).create(actor, 1, 1, input),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces dual-person approval', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 9,
        cloud_account_id: 1,
        requested_by_user_id: 7,
        status: 'PENDING_APPROVAL',
      },
    ]);
    await expect(
      serviceWith(query).approve(actor, 9, 1, {
        mfaCode: '123456',
        clientRequestId: 'approve-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mfa.verifyForUser).toHaveBeenCalledWith(7, '123456');
  });

  it('accepts only DryRunOperation as a successful AWS preflight', async () => {
    const service = serviceWith(jest.fn());
    const accepted = {
      send: jest.fn().mockRejectedValue({ name: 'DryRunOperation' }),
    };
    await expect(
      (service as any).dryRun(accepted, {}),
    ).resolves.toBeUndefined();
    const denied = {
      send: jest.fn().mockRejectedValue({ name: 'UnauthorizedOperation' }),
    };
    await expect((service as any).dryRun(denied, {})).rejects.toMatchObject({
      name: 'UnauthorizedOperation',
    });
  });
});
