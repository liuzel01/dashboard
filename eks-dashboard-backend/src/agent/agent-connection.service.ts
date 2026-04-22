import { Injectable, Logger } from '@nestjs/common';
import { AgentConfigService } from './agent-config.service';
import { AgentDecryptService } from './agent-decrypt.service';
import { AgentResolvedConnectionConfig } from './agent.types';

interface CacheEntry {
  resolved: AgentResolvedConnectionConfig;
  expiresAt: number;
}

@Injectable()
export class AgentConnectionService {
  private readonly logger = new Logger(AgentConnectionService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly configService: AgentConfigService,
    private readonly decryptService: AgentDecryptService,
  ) {}

  async getResolvedConnectionConfig(environmentId?: string) {
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    const now = Date.now();
    const cached = this.cache.get(envId);
    if (cached && cached.expiresAt > now) {
      return cached.resolved;
    }

    const raw = this.configService.getRawConnectionConfig();
    const decryptProfile = this.configService.resolveDecryptProfile(envId);
    const timeoutMs = this.configService.getKmsDecryptTimeoutMs();
    const resolved = await this.decryptService.decryptConfig(
      raw,
      decryptProfile,
      timeoutMs,
    );
    const ttlMs = this.configService.getCacheTtlMs();
    this.cache.set(envId, { resolved, expiresAt: now + ttlMs });

    this.logger.log(
      `[AgentConfig] resolved and cached env=${envId} provider=${decryptProfile.provider} ttlMs=${ttlMs}`,
    );
    return resolved;
  }

  invalidate(environmentId?: string) {
    if (environmentId) {
      this.cache.delete(environmentId);
      return;
    }
    this.cache.clear();
  }

  getCacheState(environmentId?: string) {
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    const cached = this.cache.get(envId);
    if (!cached) return { environmentId: envId, cached: false };
    return {
      environmentId: envId,
      cached: true,
      expiresAt: new Date(cached.expiresAt).toISOString(),
      ttlMsLeft: Math.max(0, cached.expiresAt - Date.now()),
    };
  }
}

