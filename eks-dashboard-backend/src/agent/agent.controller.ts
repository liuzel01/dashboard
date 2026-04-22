import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AgentConfigService } from './agent-config.service';
import { AgentConnectionService } from './agent-connection.service';
import { AgentQueryService } from './agent-query.service';
import { AgentAggregateQueryDto } from './dto/agent-aggregate-query.dto';

@Controller()
export class AgentController {
  constructor(
    private readonly configService: AgentConfigService,
    private readonly connectionService: AgentConnectionService,
    private readonly queryService: AgentQueryService,
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
  async configSummary(
    @Headers('x-environment-id') environmentId?: string,
    @Headers('x-agent-token') token?: string,
  ) {
    this.checkAgentToken(token);
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

  @Post('v1/query/aggregate')
  async aggregate(
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
    @Body(new ValidationPipe()) body: AgentAggregateQueryDto,
  ) {
    this.checkAgentToken(token);
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.aggregate(envId, body.identifier, body.type, body.tenantId);
  }

  private checkAgentToken(token?: string) {
    const expected = this.configService.getAgentSharedToken();
    if (!expected) return;
    if (token === expected) return;
    throw new UnauthorizedException('Invalid X-Agent-Token');
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
