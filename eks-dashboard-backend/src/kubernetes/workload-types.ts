export const WORKLOAD_TYPES = [
  'deployment',
  'statefulset',
  'daemonset',
] as const;

export type WorkloadType = (typeof WORKLOAD_TYPES)[number];

export type WorkloadCapabilities = {
  logs: boolean;
  restart: boolean;
  imageHistory: boolean;
  imageRollback: boolean;
  rolloutTracking: boolean;
};

type WorkloadTypeDefinition = {
  label: string;
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
  capabilities: WorkloadCapabilities;
};

export const WORKLOAD_TYPE_DEFINITIONS: Record<
  WorkloadType,
  WorkloadTypeDefinition
> = {
  deployment: {
    label: 'Deployment',
    kind: 'Deployment',
    capabilities: {
      logs: true,
      restart: true,
      imageHistory: true,
      imageRollback: true,
      rolloutTracking: true,
    },
  },
  statefulset: {
    label: 'StatefulSet',
    kind: 'StatefulSet',
    capabilities: {
      logs: true,
      restart: false,
      imageHistory: false,
      imageRollback: false,
      rolloutTracking: false,
    },
  },
  daemonset: {
    label: 'DaemonSet',
    kind: 'DaemonSet',
    capabilities: {
      logs: true,
      restart: false,
      imageHistory: false,
      imageRollback: false,
      rolloutTracking: false,
    },
  },
};

export const resolveWorkloadType = (value?: string): WorkloadType => {
  const normalized = String(value || 'deployment')
    .trim()
    .toLowerCase();
  if ((WORKLOAD_TYPES as readonly string[]).includes(normalized))
    return normalized as WorkloadType;
  throw new Error(`Unsupported workload type: ${value || '-'}.`);
};

export const listWorkloadTypes = () =>
  WORKLOAD_TYPES.map((value) => ({
    value,
    ...WORKLOAD_TYPE_DEFINITIONS[value],
  }));
