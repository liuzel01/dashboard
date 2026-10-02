import {
  getMonitoringEnvironmentPolicy,
  getMonitoringEnvironmentPolicyByExecutorKey,
  requireMonitoringEnvironmentPolicy,
} from './monitoring-environment-policy';

describe('monitoring environment policy', () => {
  it.each([
    ['hashex', 'hash-jenkins', true],
    ['mgbx', 'jenkins-mega', false],
    ['icoin', 'icoin-jenkins', false],
    ['tb', 'vlink-jenkins', false],
  ])(
    'maps %s to its only controlled branch',
    (environmentId, targetBranch, executionEnabled) => {
      expect(
        requireMonitoringEnvironmentPolicy(environmentId, targetBranch),
      ).toMatchObject({ targetBranch, executionEnabled });
    },
  );

  it('rejects a cross-environment branch', () => {
    expect(() =>
      requireMonitoringEnvironmentPolicy('mgbx', 'hash-jenkins'),
    ).toThrow('仅允许目标分支 jenkins-mega');
  });

  it('does not expose unknown environments', () => {
    expect(getMonitoringEnvironmentPolicy('unknown')).toBeUndefined();
  });

  it('resolves the Hash Jenkins executor and controlled job', () => {
    expect(
      getMonitoringEnvironmentPolicyByExecutorKey('hash-jenkins'),
    ).toMatchObject({
      environmentId: 'hashex',
      jenkinsJobName: 'platform-bootstrap-hash',
      executionEnabled: true,
    });
  });
});
