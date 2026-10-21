import {
  AWS_DETECTION_RULES,
  findingFingerprint,
  findingStatusOnMatch,
  ruleChecksum,
  shouldAutoResolveFinding,
} from './aws-detection.rules';
import type { AwsInventoryResource } from './aws-governance.types';

const resource = (
  resourceType: string,
  normalized: Record<string, unknown>,
): AwsInventoryResource => ({
  region: 'ap-east-1',
  resourceType,
  resourceId: 'resource-1',
  normalized,
  normalizedHash: 'hash',
});

describe('AWS deterministic detection rules', () => {
  it('detects a public sensitive security group rule', () => {
    const rule = AWS_DETECTION_RULES.find(
      (item) => item.key === 'security-group-public-sensitive-port',
    )!;
    const match = rule.evaluate(
      resource('ec2:security-group', {
        ingress: [
          {
            protocol: 'tcp',
            fromPort: 22,
            toPort: 22,
            ipv4Ranges: ['0.0.0.0/0'],
          },
        ],
      }),
      { acmExpiryDays: 30 },
    );
    expect(match).not.toBeNull();
  });

  it('does not flag a sensitive port restricted to a private CIDR', () => {
    const rule = AWS_DETECTION_RULES.find(
      (item) => item.key === 'security-group-public-sensitive-port',
    )!;
    const match = rule.evaluate(
      resource('ec2:security-group', {
        ingress: [
          {
            protocol: 'tcp',
            fromPort: 22,
            toPort: 22,
            ipv4Ranges: ['10.0.0.0/8'],
          },
        ],
      }),
      { acmExpiryDays: 30 },
    );
    expect(match).toBeNull();
  });

  it('generates a stable fingerprint and version checksum', () => {
    const item = resource('ec2:volume', { encrypted: false });
    expect(
      findingFingerprint('ebs-volume-unencrypted', '290368114919', item),
    ).toBe(
      findingFingerprint('ebs-volume-unencrypted', '290368114919', {
        ...item,
        normalized: { encrypted: true },
      }),
    );
    expect(ruleChecksum(AWS_DETECTION_RULES[0])).toHaveLength(64);
  });

  it('resolves a missing finding only after a complete collection', () => {
    expect(shouldAutoResolveFinding('OPEN', false, true)).toBe(true);
    expect(shouldAutoResolveFinding('OPEN', false, false)).toBe(false);
    expect(shouldAutoResolveFinding('ACCEPTED_RISK', false, true)).toBe(false);
  });

  it('reopens resolved findings and expired risk acceptances when matched again', () => {
    expect(findingStatusOnMatch('RESOLVED', null)).toBe('REOPENED');
    expect(
      findingStatusOnMatch('ACCEPTED_RISK', '2026-01-01T00:00:00.000Z'),
    ).toBe('REOPENED');
    expect(
      findingStatusOnMatch('ACCEPTED_RISK', '2099-01-01T00:00:00.000Z'),
    ).toBe('ACCEPTED_RISK');
  });
});
