import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CICD_ACTION_TYPES } from './cicd-catalog.policy';
import type { CicdActionType } from './cicd-catalog.policy';
import { CicdRunsService } from './cicd-runs.service';

const validation = new ValidationPipe({ transform: true, whitelist: true });
const IDENTIFIER = /^[a-z][a-z0-9-]{1,127}$/;

class TriggerRunDto {
  @IsString() @Matches(IDENTIFIER) environmentId!: string;
  @IsIn(CICD_ACTION_TYPES) actionType!: CicdActionType;
  @IsString() @MaxLength(255) jobName!: string;
  @IsUUID() clientRequestId!: string;
  @IsOptional() @IsObject() parameters?: Record<string, unknown>;
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Google 验证码必须为 6 位数字' })
  otpCode?: string;
}

class ListRunsDto {
  @IsOptional() @IsString() @Matches(IDENTIFIER) environmentId?: string;
}

class LogQueryDto {
  @IsOptional() @Type(() => Number) @Min(0) @Max(10_000_000) start = 0;
}

class CreateLogShareDto {
  @Type(() => Number) @Min(1) @Max(168) expiresInHours!: number;
  @IsString() @Matches(/^\d{6}$/) otpCode!: string;
}

@Controller('cicd/runs')
export class CicdRunsController {
  constructor(private readonly service: CicdRunsService) {}

  @Post()
  trigger(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: TriggerRunDto,
  ) {
    return this.service.trigger(authorization, body);
  }

  @Get()
  list(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListRunsDto,
  ) {
    return this.service.list(authorization, query.environmentId);
  }

  @Post(':runId/refresh')
  refresh(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
  ) {
    return this.service.refresh(authorization, runId);
  }

  @Get(':runId/log')
  log(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
    @Query(validation) query: LogQueryDto,
  ) {
    return this.service.log(authorization, runId, query.start);
  }

  @Get('public-log-shares/:token')
  async openLogShare(@Param('token') token: string, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(302, await this.service.openLogShare(token));
  }

  @Get(':runId/log-shares')
  logShares(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
  ) {
    return this.service.listLogShares(authorization, runId);
  }

  @Post(':runId/log-shares')
  createLogShare(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
    @Body(validation) body: CreateLogShareDto,
  ) {
    return this.service.createLogShare(authorization, runId, body);
  }

  @Post(':runId/log-shares/:shareId/revoke')
  revokeLogShare(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.service.revokeLogShare(authorization, runId, shareId);
  }

  @Post(':runId/cancel')
  cancel(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
  ) {
    return this.service.cancel(authorization, runId);
  }
}
