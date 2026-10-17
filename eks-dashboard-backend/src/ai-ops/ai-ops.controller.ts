import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpCode,
  HttpStatus,
  Post,
  Param,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { AiOpsService } from './ai-ops.service';
import { SqlPreviewDto } from './dto/sql-preview.dto';
import { SqlExecuteDto } from './dto/sql-execute.dto';
import { CloudWatchEventDto } from './dto/cloudwatch-event.dto';
import { SlowQueryEventDto } from './dto/slow-query-event.dto';
import { LogSearchDto } from './dto/log-search.dto';
import { AiOpsLogService } from './ai-ops-log.service';
import { AiOpsInvestigationService } from './ai-ops-investigation.service';
import { LogInvestigationDto } from './dto/log-investigation.dto';
import { AiOpsAlertInvestigationService } from './ai-ops-alert-investigation.service';
import type { AlertmanagerPayload } from '../oncall/oncall.types';

@Controller('ai-ops')
export class AiOpsController {
  constructor(
    private readonly service: AiOpsService,
    private readonly logService: AiOpsLogService,
    private readonly investigationService: AiOpsInvestigationService,
    private readonly alertInvestigationService: AiOpsAlertInvestigationService,
  ) {}

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
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
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
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
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
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.service.checkLlmHealth(environmentId, actor);
  }

  @Get('llm/models')
  async getLlmModels(@Headers('authorization') authorization: string) {
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listLlmModels(actor);
  }

  @Post('llm/model')
  async updateLlmModel(
    @Headers('authorization') authorization: string,
    @Body() body: { model?: string },
  ) {
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateLlmModel(actor, String(body?.model || ''));
  }

  @Get('log-sources')
  async getLogSources(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.logService.listSources(environmentId, actor);
  }

  @Post('logs/search')
  async searchLogs(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: LogSearchDto,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.logService.search(environmentId, actor, body);
  }

  @Post('logs/investigate')
  @HttpCode(HttpStatus.ACCEPTED)
  async investigateLogs(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: LogInvestigationDto,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.investigationService.enqueue(environmentId, actor, body);
  }

  @Get('logs/investigations/:id')
  async getLogInvestigationJob(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) {
      throw new HttpException(
        'Invalid log investigation job id',
        HttpStatus.BAD_REQUEST,
      );
    }
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.investigationService.getJob(environmentId, actor, numericId);
  }

  @Get('logs/investigations')
  async listLogInvestigationJobs(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.investigationService.listJobs(
      environmentId,
      actor,
      Number(page || 1),
      Number(pageSize || 20),
    );
  }

  @Post('events/cloudwatch')
  async ingestCloudWatch(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Headers('x-aiops-ingest-token') ingestToken: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: false }))
    payload: CloudWatchEventDto,
  ) {
    return this.service.ingestCloudWatchEvent(
      environmentId,
      ingestToken,
      payload,
    );
  }

  @Post('events/slow-query')
  async ingestSlowQuery(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Headers('x-aiops-ingest-token') ingestToken: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: false }))
    payload: SlowQueryEventDto,
  ) {
    return this.service.ingestSlowQueryEvent(
      environmentId,
      ingestToken,
      payload,
    );
  }

  @Post('events/alertmanager')
  async ingestAlertmanager(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: AlertmanagerPayload,
  ) {
    return this.alertInvestigationService.receiveAlertmanager(
      authorization,
      payload,
    );
  }

  @Get('investigations')
  async listInvestigations(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.list(environmentId, actor, {
      status,
      keyword,
      page: Number(page || 1),
      pageSize: Number(pageSize || 20),
    });
  }

  @Get('replay-cases')
  async listReplayCases(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.listReplayCases(environmentId, actor);
  }

  @Post('replays')
  async replayCase(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Body() body: { caseKey?: string },
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.replay(
      environmentId,
      actor,
      String(body.caseKey || '').trim(),
    );
  }

  @Get('investigations-quality-summary')
  async getInvestigationQualitySummary(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.qualitySummary(environmentId, actor);
  }

  @Get('investigations/:id')
  async getInvestigation(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1)
      throw new HttpException(
        'Invalid investigation id',
        HttpStatus.BAD_REQUEST,
      );
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.get(environmentId, actor, numericId);
  }

  @Post('investigations/:id/feedback')
  async addInvestigationFeedback(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
    @Body() body: { rating?: string; comment?: string },
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1)
      throw new HttpException(
        'Invalid investigation id',
        HttpStatus.BAD_REQUEST,
      );
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.addFeedback(
      environmentId,
      actor,
      numericId,
      String(body?.rating || ''),
      body?.comment,
    );
  }

  @Post('investigations/:id/retry')
  async retryInvestigation(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    this.ensureEnvironmentHeader(environmentId);
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1)
      throw new HttpException(
        'Invalid investigation id',
        HttpStatus.BAD_REQUEST,
      );
    const actor =
      await this.service.resolveActorFromAuthorization(authorization);
    return this.alertInvestigationService.retry(
      environmentId,
      actor,
      numericId,
    );
  }
}
