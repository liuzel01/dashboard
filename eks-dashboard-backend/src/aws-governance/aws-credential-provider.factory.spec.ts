import { AwsCredentialProviderFactory } from './aws-credential-provider.factory';
import type { AwsCloudAccount } from './aws-governance.types';

describe('AwsCredentialProviderFactory', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalGovernanceProfile = process.env.AWS_GOVERNANCE_SOURCE_PROFILE;
  const originalAwsProfile = process.env.AWS_PROFILE;
  const account: AwsCloudAccount = {
    id: 1,
    environmentId: 'hashex',
    accountId: '290368114919',
    displayName: 'Hashex AWS',
    partition: 'aws',
    defaultRegions: ['ap-east-1'],
    platformAuditRoleArn:
      'arn:aws:iam::290368114919:role/DashboardHashexPlatformAuditRole',
    enabled: true,
  };

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalGovernanceProfile === undefined) {
      delete process.env.AWS_GOVERNANCE_SOURCE_PROFILE;
    } else {
      process.env.AWS_GOVERNANCE_SOURCE_PROFILE = originalGovernanceProfile;
    }
    if (originalAwsProfile === undefined) {
      delete process.env.AWS_PROFILE;
    } else {
      process.env.AWS_PROFILE = originalAwsProfile;
    }
  });

  it('requires an explicit local profile instead of falling back to EC2 metadata', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AWS_GOVERNANCE_SOURCE_PROFILE;
    delete process.env.AWS_PROFILE;

    expect(() =>
      new AwsCredentialProviderFactory().createPlatformAuditClients(
        account,
        'ap-east-1',
      ),
    ).toThrow('AWS_GOVERNANCE_SOURCE_PROFILE');
  });

  it('accepts the dedicated local governance profile', () => {
    process.env.NODE_ENV = 'development';
    process.env.AWS_GOVERNANCE_SOURCE_PROFILE = 'megadev';
    delete process.env.AWS_PROFILE;

    const clients =
      new AwsCredentialProviderFactory().createPlatformAuditClients(
        account,
        'ap-east-1',
      );

    expect(clients.sts).toBeDefined();
    expect(clients.ec2).toBeDefined();
  });

  it('does not require a local profile in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AWS_GOVERNANCE_SOURCE_PROFILE;
    delete process.env.AWS_PROFILE;

    const clients =
      new AwsCredentialProviderFactory().createPlatformAuditClients(
        account,
        'ap-east-1',
      );

    expect(clients.sts).toBeDefined();
  });
});
