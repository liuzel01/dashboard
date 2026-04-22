import { Controller, Get, Headers } from '@nestjs/common';
import { AgentConfigService } from './agent-config.service';
import { AgentConnectionService } from './agent-connection.service';

@Controller()
export class AgentController {
  constructor(
    private readonly configService: AgentConfigService,
    private readonly connectionService: AgentConnectionService,
  ) {}

  @Get('healthz')
  healthz() {
    return {
      status: 'ok',
      environmentId: this.configService.getAgentEnvironmentId(),
      now: new Date().toISOString(),
    };
  }

  @Get('v1/config/summary')
  async configSummary(@Headers('x-environment-id') environmentId?: string) {
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    const resolved = await this.connectionService.getResolvedConnectionConfig(envId);
    const profile = this.configService.resolveDecryptProfile(envId);
    const mysqlHost = this.extractHostFromJdbcUrl(resolved.mysql.url);

    return {
      environmentId: envId,
      decryptProvider: profile.provider,
      mysql: {
        host: mysqlHost,
        username: this.maskValue(resolved.mysql.username),
        password: this.maskValue(resolved.mysql.password),
      },
      redis: {
        host: resolved.redis.host,
        port: resolved.redis.port,
        database: resolved.redis.database,
        ssl: resolved.redis.ssl,
        password: this.maskValue(resolved.redis.password),
      },
      mongo: {
        uri: this.maskMongoUri(resolved.mongo.uri),
      },
      cache: this.connectionService.getCacheState(envId),
    };
  }

  private maskValue(value: string) {
    if (!value) return value;
    if (value.length <= 4) return '****';
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  private extractHostFromJdbcUrl(url: string) {
    if (!url) return '';
    const matched = url.match(/^jdbc:mysql:\/\/([^/?]+)/i);
    return matched ? matched[1] : '';
  }

  private maskMongoUri(uri: string) {
    if (!uri) return uri;
    return uri.replace(
      /^mongodb:\/\/([^:]+):([^@]+)@/i,
      (_all, user) => `mongodb://${user}:***@`,
    );
  }
}

