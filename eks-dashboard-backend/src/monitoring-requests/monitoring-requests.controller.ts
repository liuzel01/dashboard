import { Body, Controller, Get, Headers, Param, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { MonitoringRequestsService } from './monitoring-requests.service';
import { MONITORING_CREATABLE_RESOURCE_TYPES, MONITORING_RESOURCE_TYPES, PROMETHEUS_RULE_SEVERITIES, type MonitoringCreatableResourceType, type MonitoringResourceType, type PrometheusRuleSeverity } from './monitoring-request-policy';

const APP_ID = /^[a-z][a-z0-9-]{1,62}$/;
const ENVIRONMENT_ID = /^[a-z][a-z0-9-]{1,63}$/;
const TARGET_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SHA = /^[a-f0-9]{40}$/i;
const validation = new ValidationPipe({ transform: true, whitelist: true });

class PrometheusRuleFieldsDto {
  @IsString() @MaxLength(128) alertName!: string;
  @IsString() @MaxLength(600) expr!: string;
  @IsString() @MaxLength(16) forDuration!: string;
  @IsIn(PROMETHEUS_RULE_SEVERITIES) severity!: PrometheusRuleSeverity;
  @IsString() @MaxLength(240) summary!: string;
  @IsString() @MaxLength(1000) description!: string;
  @IsString() @MaxLength(64) owner!: string;
  @IsString() @MaxLength(500) runbookUrl!: string;
}

class CreateRequestDto {
  @IsString() @Matches(ENVIRONMENT_ID) environmentId!: string;
  @IsString() @Matches(TARGET_BRANCH) targetBranch!: string;
  @IsString() @Matches(APP_ID) appId!: string;
  @IsIn(MONITORING_CREATABLE_RESOURCE_TYPES) resourceType!: MonitoringCreatableResourceType;
  @ValidateIf((o) => o.resourceType !== 'PrometheusRule') @IsString() @Matches(APP_ID) resourceName?: string;
  @IsString() @MaxLength(1000) reason!: string;
  @ValidateIf((o) => o.resourceType === 'PrometheusRule') @ValidateNested() @Type(() => PrometheusRuleFieldsDto) prometheusRule?: PrometheusRuleFieldsDto;
}
class UpdateDraftDto {
  @IsOptional() @IsString() @Matches(APP_ID) appId?: string;
  @IsOptional() @IsIn(MONITORING_CREATABLE_RESOURCE_TYPES) resourceType?: MonitoringCreatableResourceType;
  @IsOptional() @IsString() @Matches(APP_ID) resourceName?: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @ValidateNested() @Type(() => PrometheusRuleFieldsDto) prometheusRule?: PrometheusRuleFieldsDto;
}
class SubmitDto {
  @IsInt() @Min(1) mrIid!: number;
  @IsString() @Matches(SHA) commitSha!: string;
}
class JenkinsAuthorizationDto {
  @Type(() => Number) @IsInt() @Min(1) mrIid!: number;
  @IsString() @Matches(SHA) commitSha!: string;
  @IsIn(['true']) dryRun!: 'true';
}
class RealApplyGrantDto {
  @Type(() => Number) @IsInt() @Min(5) @Max(30) validMinutes!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
class JenkinsRealApplyAuthorizationDto {
  @Type(() => Number) @IsInt() @Min(1) mrIid!: number;
  @IsString() @Matches(SHA) commitSha!: string;
}
class JenkinsExecutionDto { @IsIn(['preview','apply']) mode!: 'preview'|'apply'; @IsOptional() @IsString() @MaxLength(1000) comment?: string; @IsOptional() @IsString() @MaxLength(64) confirmation?: string; }
class DecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
class ListDto {
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED', 'WITHDRAWN']) status?: string;
  @IsOptional() @IsIn(MONITORING_RESOURCE_TYPES) resourceType?: MonitoringResourceType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

@Controller('monitoring-requests')
export class MonitoringRequestsController {
  constructor(private readonly service: MonitoringRequestsService) {}
  @Get() list(@Headers('authorization') auth: string | undefined, @Query(validation) query: ListDto) { return this.service.list(auth, query); }
  @Get('environment-options') environmentOptions(@Headers('authorization') auth: string | undefined) { return this.service.environmentOptions(auth); }
  @Get(':requestId') get(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string) { return this.service.get(auth, requestId); }
  @Post() create(@Headers('authorization') auth: string | undefined, @Body(validation) body: CreateRequestDto) { return this.service.create(auth, body); }
  @Patch(':requestId') update(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: UpdateDraftDto) { return this.service.updateDraft(auth, requestId, body); }
  @Post(':requestId/submit') submit(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: SubmitDto) { return this.service.submit(auth, requestId, body); }
  @Post(':requestId/managed-submit') submitManaged(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string) { return this.service.submitManaged(auth, requestId); }
  @Get(':requestId/jenkins-authorization') authorizeDryRun(
    @Headers('x-dashboard-approval-token') token: string | undefined,
    @Param('requestId') requestId: string,
    @Query(validation) query: JenkinsAuthorizationDto,
  ) { return this.service.authorizeDryRun(requestId, { mrIid: query.mrIid, commitSha: query.commitSha, dryRun: query.dryRun === 'true' }, token); }
  @Post(':requestId/real-apply-grants') grantRealApply(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: RealApplyGrantDto) { return this.service.grantRealApply(auth, requestId, body.validMinutes, body.comment); }
  @Post(':requestId/jenkins-real-apply-preflight') authorizeRealApplyPreflight(
    @Headers('x-dashboard-approval-token') token: string | undefined,
    @Param('requestId') requestId: string,
    @Body(validation) body: JenkinsRealApplyAuthorizationDto,
  ) { return this.service.authorizeRealApplyPreflight(requestId, body, token); }
  @Post(':requestId/jenkins-real-apply-authorization') consumeRealApplyAuthorization(
    @Headers('x-dashboard-approval-token') token: string | undefined,
    @Param('requestId') requestId: string,
    @Body(validation) body: JenkinsRealApplyAuthorizationDto,
  ) { return this.service.consumeRealApplyAuthorization(requestId, body, token); }
  @Post(':requestId/jenkins-executions') execute(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: JenkinsExecutionDto) { return this.service.startDashboardExecution(auth, requestId, body.mode, body.comment, body.confirmation); }
  @Get(':requestId/jenkins-executions') executions(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string) { return this.service.listDashboardExecutions(auth, requestId); }
  @Post(':requestId/jenkins-executions/:id/refresh') refreshExecution(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Param('id') id: string) { return this.service.refreshDashboardExecution(auth, requestId, Number(id)); }
  @Post(':requestId/approve') approve(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: DecisionDto) { return this.service.decide(auth, requestId, 'APPROVED', body.comment); }
  @Post(':requestId/reject') reject(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: DecisionDto) { return this.service.decide(auth, requestId, 'REJECTED', body.comment); }
  @Post(':requestId/withdraw') withdraw(@Headers('authorization') auth: string | undefined, @Param('requestId') requestId: string, @Body(validation) body: DecisionDto) { return this.service.withdraw(auth, requestId, body.comment); }
}
