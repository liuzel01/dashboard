import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';
import { AwsDetectionService } from './aws-detection.service';
import { AwsGovernanceService } from './aws-governance.service';
import { AwsRemediationService } from './aws-remediation.service';
import type { AwsGovernanceActor } from './aws-governance.types';

@Controller('aws-governance')
export class AwsGovernanceController {
  constructor(
    private readonly service: AwsGovernanceService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly detection: AwsDetectionService,
    private readonly remediation: AwsRemediationService,
  ) {}

  @Get('overview')
  async overview(@Headers('authorization') authorization?: string) {
    return this.service.overview(
      await this.actor(authorization, 'aws-governance:catalog:read'),
    );
  }

  @Get('accounts')
  async accounts(@Headers('authorization') authorization?: string) {
    return this.service.listAccounts(
      await this.actor(authorization, 'aws-governance:catalog:read'),
    );
  }

  @Get('resources')
  async resources(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.service.listResources(
      await this.actor(authorization, 'aws-governance:catalog:read'),
      query,
    );
  }

  @Get('inventory-runs')
  async runs(
    @Headers('authorization') authorization: string | undefined,
    @Query('accountId') accountId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listRuns(
      await this.actor(authorization, 'aws-governance:catalog:read'),
      Number(accountId),
      Number(page || 1),
      Number(pageSize || 20),
    );
  }

  @Get('inventory-runs/:id')
  async run(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.service.getRun(
      await this.actor(authorization, 'aws-governance:catalog:read'),
      Number(id),
    );
  }

  @Post('accounts/:id/inventory-runs')
  async startRun(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.service.startRun(
      await this.actor(authorization, 'aws-governance:inventory:run'),
      Number(id),
    );
  }

  @Post('accounts/:id/diagnose')
  async diagnose(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.service.diagnose(
      await this.actor(authorization, 'aws-governance:config:manage'),
      Number(id),
    );
  }

  @Get('changes')
  async changes(
    @Headers('authorization') authorization: string | undefined,
    @Query('accountId') accountId: string,
    @Query('runId') runId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listChanges(
      await this.actor(authorization, 'aws-governance:change:read'),
      Number(accountId),
      runId ? Number(runId) : undefined,
      Number(page || 1),
      Number(pageSize || 50),
    );
  }

  @Get('findings')
  async findings(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
  ) {
    const actor = await this.actor(
      authorization,
      'aws-governance:finding:read',
    );
    const account = await this.service.scopedAccount(
      actor,
      Number(query.accountId),
    );
    return this.detection.list(account.id, query);
  }

  @Get('findings/:id')
  async finding(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('accountId') accountId: string,
  ) {
    const actor = await this.actor(
      authorization,
      'aws-governance:finding:read',
    );
    const account = await this.service.scopedAccount(actor, Number(accountId));
    return this.detection.detail(Number(id), account.id);
  }

  @Get('finding-export')
  async exportFindings(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string | undefined>,
    @Res() response: Response,
  ) {
    const actor = await this.actor(
      authorization,
      'aws-governance:finding:read',
    );
    const account = await this.service.scopedAccount(
      actor,
      Number(query.accountId),
    );
    const csv = await this.detection.exportCsv(account.id, query);
    response
      .type('text/csv; charset=utf-8')
      .attachment(`aws-findings-${account.environmentId}.csv`)
      .send(csv);
  }

  @Post('findings/:id/:action')
  async transitionFinding(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Param('action') action: string,
    @Query('accountId') accountId: string,
    @Body()
    body: { note?: string; exemptUntil?: string; clientRequestId?: string },
  ) {
    const actor = await this.actor(
      authorization,
      'aws-governance:finding:manage',
    );
    const account = await this.service.scopedAccount(actor, Number(accountId));
    return this.detection.transition(
      Number(id),
      account.id,
      actor,
      action,
      body,
    );
  }

  @Post('findings/:id/remediations/preview')
  async previewRemediation(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('accountId') accountId: string,
    @Body() body: any,
  ) {
    const actor = await this.actor(authorization, 'aws-governance:remediation:request');
    const account = await this.service.scopedAccount(actor, Number(accountId));
    return this.remediation.preview(Number(id), account.id, body);
  }

  @Post('remediations/from-finding/:id')
  async createRemediation(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('accountId') accountId: string,
    @Body() body: any,
  ) {
    const actor = await this.actor(authorization, 'aws-governance:remediation:request');
    const account = await this.service.scopedAccount(actor, Number(accountId));
    return this.remediation.create(actor, Number(id), account.id, body);
  }

  @Get('remediations')
  async remediations(
    @Headers('authorization') authorization: string | undefined,
    @Query('accountId') accountId: string,
  ) {
    const actor = await this.actor(authorization, 'aws-governance:finding:read');
    const account = await this.service.scopedAccount(actor, Number(accountId));
    return this.remediation.list(account.id);
  }

  @Post('remediations/:id/approve')
  async approveRemediation(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('accountId') accountId: string,
    @Body() body: any,
  ) {
    const actor = await this.actor(authorization, 'aws-governance:remediation:approve');
    const account = await this.service.scopedAccount(actor, Number(accountId));
    return this.remediation.approve(actor, Number(id), account.id, body);
  }

  @Post('remediations/:id/execute')
  async executeRemediation(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('accountId') accountId: string,
    @Body() body: any,
  ) {
    const actor = await this.actor(authorization, 'aws-governance:remediation:execute');
    const account = await this.service.scopedAccount(actor, Number(accountId));
    const task = await this.remediation.execute(actor, Number(id), account.id, body);
    const inventory = await this.service.startRun(actor, account.id);
    return { task, inventory };
  }

  @Post('remediations/:id/rollback')
  async rollbackRemediation(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Query('accountId') accountId: string,
    @Body() body: any,
  ) {
    const actor = await this.actor(authorization, 'aws-governance:remediation:rollback');
    const account = await this.service.scopedAccount(actor, Number(accountId));
    const task = await this.remediation.rollback(actor, Number(id), account.id, body);
    const inventory = await this.service.startRun(actor, account.id);
    return { task, inventory };
  }

  private async actor(
    authorization: string | undefined,
    permission: string,
  ): Promise<AwsGovernanceActor> {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer '))
      throw new ForbiddenException('Missing AWS governance permission');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user =
      payload.source === 'keycloak' || typeof payload.sub !== 'number'
        ? await this.access.ensureUserByUsername(payload.username, {
            displayName: payload.displayName,
          })
        : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    const permissions = (me.permissions || []).map(String);
    if (
      !permissions.includes('menu:aws-governance') ||
      !permissions.includes(permission)
    ) {
      throw new ForbiddenException(
        `Missing permissions: menu:aws-governance, ${permission}`,
      );
    }
    return {
      userId: Number(me.id),
      username: String(me.username || payload.username || ''),
      displayName: String(me.display_name || me.username || ''),
      roleIds: (me.roles || []).map((role: any) => Number(role.id)),
      permissions,
    };
  }
}
