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
      aws_region: env.aws_region,
      aws_profile: env.aws_profile,
      aws_access_key_id: env.aws_access_key_id,
      kubeContext: env.kubeContext,
    }));
  }

  @Get('config/:id')
  async findConfig(@Param('id') id: string) {
    const env = await this.environmentsService.getEnvironmentConfigById(id);
    if (!env) throw new NotFoundException(`Environment "${id}" not found`);
    return env;
  }

  @Post('config')
  async createConfig(
    @Body(new ValidationPipe({ transform: true })) body: CreateEnvironmentConfigDto,
  ) {
    await this.environmentsService.upsertEnvironmentConfig({
      id: body.id,
      name: body.name,
      aws_region: body.aws_region,
      aws_access_key_id: body.aws_access_key_id,
      aws_secret_access_key: body.aws_secret_access_key,
      aws_profile: body.aws_profile,
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
