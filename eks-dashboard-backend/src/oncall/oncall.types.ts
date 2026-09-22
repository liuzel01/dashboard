export type AlertmanagerAlert = {
  status?: string;
  labels?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  startsAt?: string;
  endsAt?: string;
  fingerprint?: string;
  generatorURL?: string;
};

export type AlertmanagerPayload = {
  version?: string;
  groupKey?: string;
  status?: string;
  receiver?: string;
  groupLabels?: Record<string, unknown>;
  commonLabels?: Record<string, unknown>;
  commonAnnotations?: Record<string, unknown>;
  externalURL?: string;
  alerts?: AlertmanagerAlert[];
};

export type OncallActor = {
  userId: number;
  username: string;
  displayName: string;
  permissions: string[];
};
