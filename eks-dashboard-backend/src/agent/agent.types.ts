export type DecryptProvider = 'noop' | 'kms';

export interface AgentDecryptProfile {
  provider: DecryptProvider;
  region?: string;
  kmsKeyAlias?: string;
  kmsContext?: Record<string, string>;
  forceKmsForAll?: boolean;
  valuePrefix?: string;
}

export interface AgentRawConnectionConfig {
  mysql: {
    url: string;
    username: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    database: number;
    ssl: boolean;
    password: string;
  };
  mongo: {
    uri: string;
  };
}

export interface AgentResolvedConnectionConfig extends AgentRawConnectionConfig {}

export class AgentError extends Error {
  constructor(
    public readonly code:
      | 'CONFIG_KEY_MISSING'
      | 'CONFIG_PARSE_FAILED'
      | 'DECRYPT_FAILED',
    message: string,
  ) {
    super(message);
  }
}

