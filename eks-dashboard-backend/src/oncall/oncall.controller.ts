import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OncallService } from './oncall.service';
import type { AlertmanagerPayload } from './oncall.types';

const validation = new ValidationPipe({ transform: true, whitelist: true });

class ListAlertsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(['FIRING', 'ACKED', 'RESOLVED']) status?: string;
  @IsOptional() @IsString() @MaxLength(64) environmentId?: string;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

class AcknowledgeAlertDto {
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

class ListRosterDto {
  @IsOptional() @IsString() @MaxLength(64) environmentId?: string;
}

class UpsertRosterDto {
  @IsString() @MaxLength(64) environmentId!: string;
  @IsIn(['L1', 'L2', 'OWNER']) level!: string;
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsString() @MaxLength(255) displayName?: string;
  @IsOptional() @IsString() @MaxLength(80) activeFrom?: string;
  @IsOptional() @IsString() @MaxLength(80) activeUntil?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@Controller('oncall')
export class OncallController {
  constructor(private readonly service: OncallService) {}

  /** Used exclusively as the Internal ALB target-group health check. */
  @Get('health')
  health() {
    return { status: 'ok', service: 'dashboard-oncall' };
  }

  @Post('alertmanager')
  async receiveAlertmanager(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, unknown>,
    @Body() body: AlertmanagerPayload,
  ) {
    this.service.assertWebhookAuthorization(authorization);
    const forwarded = headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null;
    return this.service.receiveAlertmanagerWebhook(body, {
      ip,
      userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : null,
      traceId: typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : null,
    });
  }

  @Get('alerts')
  async list(@Headers('authorization') authorization: string | undefined, @Query(validation) query: ListAlertsDto) {
    return this.service.listAlerts(await this.service.resolveActor(authorization), query);
  }

  @Get('alerts/:id')
  async get(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) throw new BadRequestException('Invalid oncall alert id');
    return this.service.getAlert(await this.service.resolveActor(authorization), numericId);
  }

  @Post('alerts/:id/ack')
  async acknowledge(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body(validation) body: AcknowledgeAlertDto,
  ) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) throw new BadRequestException('Invalid oncall alert id');
    return this.service.acknowledgeAlert(await this.service.resolveActor(authorization), numericId, body.comment);
  }

  @Get('roster')
  async roster(@Headers('authorization') authorization: string | undefined, @Query(validation) query: ListRosterDto) {
    return this.service.listRoster(await this.service.resolveActor(authorization), query.environmentId);
  }

  @Post('roster')
  async saveRoster(@Headers('authorization') authorization: string | undefined, @Body(validation) body: UpsertRosterDto) {
    return this.service.upsertRoster(await this.service.resolveActor(authorization), body);
  }

  @Delete('roster/:id')
  async removeRoster(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) throw new BadRequestException('Invalid Oncall roster id');
    return this.service.deleteRoster(await this.service.resolveActor(authorization), numericId);
  }
}
