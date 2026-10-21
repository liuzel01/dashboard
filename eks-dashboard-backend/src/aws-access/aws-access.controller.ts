import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';
import type { AwsGovernanceActor } from '../aws-governance/aws-governance.types';
import { AwsAccessService } from './aws-access.service';

class CreateGrantDto {
  @IsInt() @Min(1) granteeUserId!: number;
  @IsInt() @Min(1) cloudAccountId!: number;
  @IsString() @MaxLength(64) permissionTemplateKey!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  regions!: string[];
  @IsISO8601() validUntil!: string;
  @IsString() @MaxLength(1000) reason!: string;
  @IsString() @Matches(/^\d{6}$/) mfaCode!: string;
}

class RevokeGrantDto {
  @IsString() @MaxLength(1000) reason!: string;
  @IsString() @Matches(/^\d{6}$/) mfaCode!: string;
}

class ConsumeTicketDto {
  @IsString() @MaxLength(256) ticket!: string;
}

@Controller('aws-access')
export class AwsAccessController {
  constructor(
    private readonly service: AwsAccessService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
  ) {}

  @Get('configuration')
  async configuration(@Headers('authorization') authorization?: string) {
    return this.service.configuration(
      await this.actor(authorization, 'aws-access:grant:read-own'),
    );
  }

  @Get('grants')
  async grants(@Headers('authorization') authorization?: string) {
    const actor = await this.actorAny(authorization, [
      'aws-access:grant:read-own',
      'aws-access:grant:read-all',
    ]);
    return this.service.listGrants(actor);
  }

  @Post('grants')
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CreateGrantDto,
  ) {
    return this.service.createGrant(
      await this.actor(authorization, 'aws-access:grant:manage'),
      body,
    );
  }

  @Post('grants/:id/revoke')
  async revoke(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: RevokeGrantDto,
  ) {
    return this.service.revokeGrant(
      await this.actor(authorization, 'aws-access:grant:manage'),
      Number(id),
      body,
    );
  }

  @Post('grants/:id/session/prepare')
  async prepare(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.service.prepareSession(
      await this.actor(authorization, 'aws-access:session:start'),
      Number(id),
    );
  }

  @Post('sessions/consume')
  async consume(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ConsumeTicketDto,
  ) {
    return this.service.consumeSession(
      await this.actor(authorization, 'aws-access:session:start'),
      body.ticket,
    );
  }

  private actor(authorization: string | undefined, permission: string) {
    return this.actorAny(authorization, [permission]);
  }

  private async actorAny(
    authorization: string | undefined,
    required: string[],
  ): Promise<AwsGovernanceActor> {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer '))
      throw new ForbiddenException('Missing AWS access permission');
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
      !permissions.includes('menu:aws-access') ||
      !required.some((permission) => permissions.includes(permission))
    ) {
      throw new ForbiddenException(
        `Missing permissions: menu:aws-access, ${required.join(' or ')}`,
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
