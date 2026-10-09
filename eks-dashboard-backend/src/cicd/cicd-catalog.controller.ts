import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CICD_ACTION_TYPES } from './cicd-catalog.policy';
import type { CicdActionType } from './cicd-catalog.policy';
import { CicdCatalogService } from './cicd-catalog.service';

const validation = new ValidationPipe({ transform: true, whitelist: true });
const IDENTIFIER = /^[a-z][a-z0-9-]{1,127}$/;

class CatalogQueryDto {
  @IsString() @Matches(IDENTIFIER) environmentId!: string;
  @IsIn(CICD_ACTION_TYPES) actionType!: CicdActionType;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

class JobDetailQueryDto extends CatalogQueryDto {
  @IsString() @MaxLength(255) jobName!: string;
}

@Controller('cicd')
export class CicdCatalogController {
  constructor(private readonly service: CicdCatalogService) {}

  @Get('environment-bindings')
  bindings(@Headers('authorization') authorization?: string) {
    return this.service.listEnvironmentBindings(authorization);
  }

  @Get('jobs')
  jobs(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: CatalogQueryDto,
  ) {
    return this.service.listJobs(
      authorization,
      query.environmentId,
      query.actionType,
      query.keyword,
    );
  }

  @Get('discovered-jobs')
  discoveredJobs(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: CatalogQueryDto,
  ) {
    return this.service.discoverJobs(
      authorization,
      query.environmentId,
      query.actionType,
      query.keyword,
    );
  }

  @Get('job-detail')
  jobDetail(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: JobDetailQueryDto,
  ) {
    return this.service.getDiscoveredJobDetail(
      authorization,
      query.environmentId,
      query.actionType,
      query.jobName,
    );
  }

  @Get('executors')
  executors(@Headers('authorization') authorization?: string) {
    return this.service.listExecutors(authorization);
  }

  @Get('executors/:executorKey/diagnostics')
  diagnostics(
    @Headers('authorization') authorization: string | undefined,
    @Param('executorKey') executorKey: string,
  ) {
    return this.service.diagnose(authorization, executorKey);
  }

  @Get('reconciliation')
  reconciliation(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: CatalogQueryDto,
  ) {
    return this.service.reconcile(
      authorization,
      query.environmentId,
      query.actionType,
    );
  }
}
