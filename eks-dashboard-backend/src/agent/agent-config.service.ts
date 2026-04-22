import { Injectable, Logger } from '@nestjs/common';
import {
  AgentDecryptProfile,
  AgentError,
  AgentRawConnectionConfig,
} from './agent.types';

interface DecryptProfileConfigMap {
  [environmentId: string]: Partial<AgentDecryptProfile>;
}

@Injectable()
export class AgentConfigService {
  private readonly logger = new Logger(AgentConfigService.name);

  getAgentEnvironmentId() {
    return process.env.AGENT_ENVIRONMENT_ID || 'unknown';
  }

  getCacheTtlMs() {
    const raw = Number(process.env.CONFIG_CACHE_TTL_MS || 300_000);
    return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
  }

  getKmsDecryptTimeoutMs() {
    const raw = Number(process.env.AGENT_KMS_DECRYPT_TIMEOUT_MS || 8_000);
    return Number.isFinite(raw) && raw > 0 ? raw : 8_000;
  }

  getRawConnectionConfig(): AgentRawConnectionConfig {
    const mysqlUrl = this.pickValue(['DB_MYSQL_URL', 'datasource.url']);
    const mysqlUser = this.pickValue(['DB_MYSQL_USER', 'datasource.username']);
    const mysqlPassword = this.pickValue([
      'DB_MYSQL_PASSWORD',
      'datasource.password',
    ]);

    const redisHost = this.pickValue(['REDIS_HOST', 'redis.host']);
    const redisPort = this.pickValue(['REDIS_PORT', 'redis.port']);
    const redisDatabase = this.pickValue(['REDIS_DATABASE', 'redis.database']);
    const redisSsl = this.pickValue(['REDIS_SSL', 'redis.ssl']);
    const redisPassword = this.pickValue(['REDIS_PASSWORD', 'redis.password']);

    const mongoUri = this.pickValue(['MONGO_URI', 'mongo.uri']);

    return {
      mysql: {
        url: mysqlUrl,
        username: mysqlUser,
        password: mysqlPassword,
      },
      redis: {
        host: redisHost,
        port: this.parseNumber(redisPort, 'redis.port'),
        database: this.parseNumber(redisDatabase, 'redis.database'),
        ssl: String(redisSsl).toLowerCase() === 'true',
        password: redisPassword,
      },
      mongo: {
        uri: mongoUri,
      },
    };
  }

  resolveDecryptProfile(environmentId: string): AgentDecryptProfile {
    const fromMap = this.getProfileFromEnvMap(environmentId);
    const defaultProfile = this.getDefaultDecryptProfile();
    return {
      ...defaultProfile,
      ...fromMap,
      kmsContext: {
        ...(defaultProfile.kmsContext || {}),
        ...((fromMap && fromMap.kmsContext) || {}),
      },
    };
  }

  private getDefaultDecryptProfile(): AgentDecryptProfile {
    const provider = (process.env.AGENT_DECRYPT_PROVIDER || 'noop').toLowerCase();
    return {
      provider: provider === 'kms' ? 'kms' : 'noop',
      region: process.env.AWS_REGION || undefined,
      kmsKeyAlias: process.env.KMS_KEY_ALIAS || undefined,
      kmsContext: this.parseContextJson(process.env.KMS_CONTEXT),
      forceKmsForAll: this.parseBoolean(process.env.AGENT_KMS_FORCE),
      valuePrefix: process.env.AGENT_KMS_VALUE_PREFIX || 'kms://',
    };
  }

  private getProfileFromEnvMap(environmentId: string): Partial<AgentDecryptProfile> {
    const raw = process.env.AGENT_DECRYPT_ENV_CONFIGS;
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as DecryptProfileConfigMap;
      const profile = parsed?.[environmentId];
      if (!profile || typeof profile !== 'object') return {};
      return {
        provider: profile.provider === 'kms' ? 'kms' : 'noop',
        region: profile.region,
        kmsKeyAlias: profile.kmsKeyAlias,
        kmsContext: profile.kmsContext,
        forceKmsForAll: Boolean(profile.forceKmsForAll),
        valuePrefix: profile.valuePrefix,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to parse AGENT_DECRYPT_ENV_CONFIGS, use default profile only: ${String(
          error,
        )}`,
      );
      return {};
    }
  }

  private parseContextJson(raw?: string): Record<string, string> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const context: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed || {})) {
        context[key] = String(value);
      }
      return context;
    } catch (error) {
      this.logger.warn(`Failed to parse KMS_CONTEXT: ${String(error)}`);
      return {};
    }
  }

  private parseBoolean(raw?: string) {
    return String(raw || '')
      .trim()
      .toLowerCase() === 'true';
  }

  private pickValue(keys: string[]): string {
    for (const key of keys) {
      const value = process.env[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value);
      }
    }
    throw new AgentError(
      'CONFIG_KEY_MISSING',
      `Missing required config value. tried keys: ${keys.join(', ')}`,
    );
  }

  private parseNumber(raw: string, key: string) {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new AgentError(
        'CONFIG_PARSE_FAILED',
        `Invalid numeric config value for key "${key}": ${raw}`,
      );
    }
    return value;
  }
}
