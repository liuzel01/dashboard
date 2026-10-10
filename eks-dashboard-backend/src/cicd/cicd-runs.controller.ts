import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
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
  @IsOptional() @IsString() @MaxLength(32) confirmation?: string;
}

class ListRunsDto {
  @IsOptional() @IsString() @Matches(IDENTIFIER) environmentId?: string;
}

class LogQueryDto {
  @IsOptional() @Type(() => Number) @Min(0) @Max(10_000_000) start = 0;
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

  @Post(':runId/cancel')
  cancel(
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
  ) {
    return this.service.cancel(authorization, runId);
  }
}
