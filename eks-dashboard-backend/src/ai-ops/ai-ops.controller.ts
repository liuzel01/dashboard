import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { AiOpsService } from './ai-ops.service';
import { SqlPreviewDto } from './dto/sql-preview.dto';
import { SqlExecuteDto } from './dto/sql-execute.dto';
import { CloudWatchEventDto } from './dto/cloudwatch-event.dto';
import { SlowQueryEventDto } from './dto/slow-query-event.dto';

@Controller('ai-ops')
export class AiOpsController {
  constructor(private readonly service: AiOpsService) {}

  private ensureEnvironmentHeader(environmentId: string | undefined) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('sql/preview')
  async previewSql(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Body(new ValidationPipe({ transform: true })) body: SqlPreviewDto,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.previewSql(environmentId, actor, body);
  }

  @Post('sql/execute')
  async executeSql(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Body(new ValidationPipe({ transform: true })) body: SqlExecuteDto,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    await this.service.resolveActorFromAuthorization(authorization);
    void body;
    throw new HttpException(
      'SQL execute is disabled in dashboard. Please run SQL in external system (for example: abd.com).',
      HttpStatus.GONE,
    );
  }

  @Get('audit/sql')
  async getSqlAudit(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    const pageNum = page ? Number(page) : 1;
    const sizeNum = size ? Number(size) : 20;
    return this.service.listSqlAudit(environmentId, actor, pageNum, sizeNum);
  }

  @Get('health/llm')
  async checkLlmHealth(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.checkLlmHealth(environmentId, actor);
  }

  @Post('events/cloudwatch')
  async ingestCloudWatch(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Headers('x-aiops-ingest-token') ingestToken: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: false })) payload: CloudWatchEventDto,
  ) {
    return this.service.ingestCloudWatchEvent(environmentId, ingestToken, payload);
  }

  @Post('events/slow-query')
  async ingestSlowQuery(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Headers('x-aiops-ingest-token') ingestToken: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: false })) payload: SlowQueryEventDto,
  ) {
    return this.service.ingestSlowQueryEvent(environmentId, ingestToken, payload);
  }
}
