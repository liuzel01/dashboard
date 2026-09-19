import { Body, Controller, Get, NotFoundException, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { CreateEnvironmentConfigDto, UpdateEnvironmentConfigDto } from './dto/environment-config.dto';

@Controller('environments')
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Get()
  findAll() {
    return this.environmentsService.getEnvironments();
  }

  @Get('config')
  async findAllConfigs() {
    const list = await this.environmentsService.getEnvironmentConfigs();
    return list.map((env) => ({
      id: env.id,
      name: env.name,
      super_admin_url: env.super_admin_url,
      db_gateway_agent_url: env.db_gateway_agent_url,
      aws_region: env.aws_region,
      aws_role_arn: env.aws_role_arn,
      kubeContext: env.kubeContext,
    }));
  }

  @Get('config/:id')
  async findConfig(@Param('id') id: string) {
    const env = await this.environmentsService.getEnvironmentConfigById(id);
    if (!env) throw new NotFoundException(`Environment "${id}" not found`);
    // 历史字段可能仍存在于数据库中，但管理接口不再读取或返回静态凭证/Profile。
    const {
      aws_access_key_id: _awsAccessKeyId,
      aws_secret_access_key: _awsSecretAccessKey,
      aws_profile: _awsProfile,
      ...safeEnv
    } = env;
    return safeEnv;
  }

  @Post('config')
  async createConfig(
    @Body(new ValidationPipe({ transform: true })) body: CreateEnvironmentConfigDto,
  ) {
    await this.environmentsService.upsertEnvironmentConfig({
      id: body.id,
      name: body.name,
      super_admin_url: body.super_admin_url,
      db_gateway_agent_url: body.db_gateway_agent_url,
      aws_region: body.aws_region,
      aws_role_arn: body.aws_role_arn,
      kubeContext: body.kubeContext,
      database: body.database,
      redis: body.redis,
      jumpServer: body.jumpServer,
      tenants: body.tenants,
      platforms: body.platforms,
      alerts: body.alerts,
    });
    return { ok: true };
  }

  @Put('config/:id')
  async updateConfig(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateEnvironmentConfigDto,
  ) {
    const current = await this.environmentsService.getEnvironmentConfigById(id);
    if (!current) {
      throw new NotFoundException(`Environment "${id}" not found`);
    }
    await this.environmentsService.upsertEnvironmentConfig({
      ...current,
      ...body,
      id,
      name: body.name ?? current.name,
      aws_region: body.aws_region ?? current.aws_region,
    });
    return { ok: true };
  }

  @Get(':id/tenants')
  findTenants(@Param('id') id: string) {
    return this.environmentsService.getTenantsForEnvironment(id);
  }
}
