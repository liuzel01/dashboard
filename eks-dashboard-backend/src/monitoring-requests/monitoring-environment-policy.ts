export type MonitoringEnvironmentPolicy = {
  environmentId: string;
  label: string;
  targetBranch: string;
  repositoryEnvironmentPath: string;
  executorKey: string;
  executionEnabled: boolean;
};

export const MONITORING_ENVIRONMENT_POLICIES: readonly MonitoringEnvironmentPolicy[] =
  [
    {
      environmentId: 'hashex',
      label: 'Hash',
      targetBranch: 'hash-jenkins',
      repositoryEnvironmentPath: 'hash',
      executorKey: 'hash-jenkins',
      executionEnabled: true,
    },
    {
      environmentId: 'mgbx',
      label: 'MGBX',
      targetBranch: 'jenkins-mega',
      repositoryEnvironmentPath: 'mgbx',
      executorKey: 'mgbx-jenkins',
      executionEnabled: false,
    },
    {
      environmentId: 'icoin',
      label: 'iCoin',
      targetBranch: 'icoin-jenkins',
      repositoryEnvironmentPath: 'icoin',
      executorKey: 'icoin-jenkins',
      executionEnabled: false,
    },
    {
      environmentId: 'tb',
      label: 'VLink',
      targetBranch: 'vlink-jenkins',
      repositoryEnvironmentPath: 'vlink',
      executorKey: 'vlink-jenkins',
      executionEnabled: false,
    },
  ] as const;

export function getMonitoringEnvironmentPolicy(environmentId: string) {
  return MONITORING_ENVIRONMENT_POLICIES.find(
    (item) => item.environmentId === String(environmentId || '').trim(),
  );
}

export function requireMonitoringEnvironmentPolicy(
  environmentId: string,
  targetBranch: string,
) {
  const policy = getMonitoringEnvironmentPolicy(environmentId);
  if (!policy) throw new Error(`不支持的监控目标环境：${environmentId}`);
  if (policy.targetBranch !== String(targetBranch || '').trim()) {
    throw new Error(
      `环境 ${environmentId} 仅允许目标分支 ${policy.targetBranch}`,
    );
  }
  return policy;
}
