import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OncallService } from './oncall.service';

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

@Controller('oncall')
export class OncallController {
  constructor(private readonly service: OncallService) {}

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
}
