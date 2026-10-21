import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';
import { AwsGovernanceService } from './aws-governance.service';
import type { AwsGovernanceActor } from './aws-governance.types';

@Controller('aws-governance')
export class AwsGovernanceController {
  constructor(
    private readonly service: AwsGovernanceService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
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
