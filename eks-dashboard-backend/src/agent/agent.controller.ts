import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AgentConfigService } from './agent-config.service';
import { AgentConnectionService } from './agent-connection.service';
import { AgentQueryService } from './agent-query.service';
import { AgentIngressService } from './agent-ingress.service';
import { AgentAggregateQueryDto } from './dto/agent-aggregate-query.dto';
import { AgentCloneIngressDto } from './dto/agent-clone-ingress.dto';
import { AgentResolveIngressSourceDto } from './dto/agent-resolve-ingress-source.dto';
import { AgentListIngressSourceCandidatesDto } from './dto/agent-list-ingress-source-candidates.dto';

@Controller()
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly configService: AgentConfigService,
    private readonly connectionService: AgentConnectionService,
    private readonly queryService: AgentQueryService,
    private readonly ingressService: AgentIngressService,
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
    @Headers('x-request-id') requestId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-username') username: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
    @Body(new ValidationPipe()) body: AgentAggregateQueryDto,
  ) {
    this.checkAgentToken(token);
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    this.logger.log(
      `[AgentQuery] aggregate env=${envId} type=${body.type} requestId=${requestId || 'none'} userId=${userId || 'none'} username=${username || 'none'}`,
    );
    return this.queryService.aggregate(envId, body.identifier, body.type, body.tenantId);
  }

  @Get('v1/query/trader/:uid')
  async getTraderInfo(
    @Param('uid') uid: string,
    @Query('tenantId') tenantId: string | undefined,
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.getTraderInfoByUserUid(envId, uid, Number(tenantId));
  }

  @Patch('v1/query/users/:uid')
  async updateUser(
    @Param('uid') uid: string,
    @Body() body: { tenantId?: number; email?: string | null; tel?: string; tel_country_code?: string | null },
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (body.tenantId === undefined) {
      throw new BadRequestException('tenantId is required in body');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.updateUser(envId, uid, body.tenantId, body);
  }

  @Post('v1/query/users/:uid/deactivate')
  async deactivateUser(
    @Param('uid') uid: string,
    @Body() body: { tenantId?: number },
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (body.tenantId === undefined) {
      throw new BadRequestException('tenantId is required in body');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.deactivateUser(envId, uid, body.tenantId);
  }

  @Get('v1/query/otc-merchant/:uid')
  async getOtcMerchantInfo(
    @Param('uid') uid: string,
    @Query('tenantId') tenantId: string | undefined,
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.getOtcMerchantInfoByUserUid(envId, uid, Number(tenantId));
  }

  @Patch('v1/query/otc-merchant/:uid/name')
  async updateOtcMerchantName(
    @Param('uid') uid: string,
    @Body() body: { name?: string; tenantId?: number },
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (body.name === undefined) {
      throw new BadRequestException('name is required in body');
    }
    if (body.tenantId === undefined) {
      throw new BadRequestException('tenantId is required in body');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.updateOtcMerchantNameByUserUid(
      envId,
      uid,
      body.tenantId,
      body.name,
    );
  }

  @Get('v1/query/redis-key')
  async getRedisKey(
    @Query('key') key: string | undefined,
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (!key) {
      throw new BadRequestException('Query parameter "key" is required.');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.getRedisKey(envId, key);
  }

  @Post('v1/query/redis-key')
  async createRedisKey(
    @Body() body: { key?: string; value?: string; ttlSeconds?: number },
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (!body.key) {
      throw new BadRequestException('Body field "key" is required.');
    }
    if (body.value === undefined) {
      throw new BadRequestException('Body field "value" is required.');
    }
    if (
      body.ttlSeconds !== undefined &&
      (!Number.isFinite(body.ttlSeconds) || body.ttlSeconds <= 0)
    ) {
      throw new BadRequestException(
        'Body field "ttlSeconds" must be a positive number when provided.',
      );
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.createRedisKey(
      envId,
      body.key,
      body.value,
      body.ttlSeconds,
    );
  }

  @Delete('v1/query/redis-key')
  async deleteRedisKey(
    @Query('key') key: string | undefined,
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (!key) {
      throw new BadRequestException('Query parameter "key" is required.');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.deleteRedisKey(envId, key);
  }

  @Post('v1/ingress/source-candidates')
  async listIngressSourceCandidates(
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-username') username: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: AgentListIngressSourceCandidatesDto,
  ) {
    this.checkAgentToken(token);
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    this.logger.log(
      `[AgentIngress] source-candidates env=${envId} requestId=${requestId || 'none'} userId=${userId || 'none'} username=${username || 'none'}`,
    );
    return this.ingressService.listSourceCandidates({
      environmentId: envId,
      namespace: body.namespace,
      keyword: body.keyword,
      requestId,
      userId,
      username,
    });
  }

  @Post('v1/ingress/resolve-source')
  async resolveIngressSource(
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-username') username: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: AgentResolveIngressSourceDto,
  ) {
    this.checkAgentToken(token);
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    this.logger.log(
      `[AgentIngress] resolve-source env=${envId} requestId=${requestId || 'none'} userId=${userId || 'none'} username=${username || 'none'}`,
    );
    return this.ingressService.resolveSource({
      environmentId: envId,
      namespace: body.namespace,
      lineUrl: body.lineUrl,
      keyword: body.keyword,
      requestId,
      userId,
      username,
    });
  }

  @Post('v1/ingress/clone')
  async cloneIngress(
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-username') username: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: AgentCloneIngressDto,
  ) {
    this.checkAgentToken(token);
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    this.logger.log(
      `[AgentIngress] clone env=${envId} requestId=${requestId || 'none'} userId=${userId || 'none'} username=${username || 'none'}`,
    );
    return this.ingressService.cloneIngress({
      environmentId: envId,
      namespace: body.namespace,
      sourceIngressName: body.sourceIngressName,
      newHost: body.newHost,
      requestId,
      userId,
      username,
    });
  }

  @Patch('v1/query/trader/:uid/nick')
  async updateTraderNick(
    @Param('uid') uid: string,
    @Body() body: { nick_name?: string; tenantId?: number },
    @Headers('x-environment-id') environmentId: string | undefined,
    @Headers('x-agent-token') token: string | undefined,
  ) {
    this.checkAgentToken(token);
    if (body.nick_name === undefined) {
      throw new BadRequestException('nick_name is required in body');
    }
    if (body.tenantId === undefined) {
      throw new BadRequestException('tenantId is required in body');
    }
    const envId = environmentId || this.configService.getAgentEnvironmentId();
    return this.queryService.updateTraderNickName(
      envId,
      uid,
      body.nick_name,
      body.tenantId,
    );
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
