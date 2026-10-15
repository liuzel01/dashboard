import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AccessControlService } from '../access-control/access-control.service';
import { DependencyHealthService } from './dependency-health.service';

@Controller('dependency-health')
export class DependencyHealthController {
  constructor(
    private readonly service: DependencyHealthService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
  ) {}

  @Get()
  async list(
    @Headers('authorization') authorization?: string,
    @Query('refresh') refresh?: string,
  ) {
    await this.authorize(authorization);
    return this.service.list({ force: refresh === 'true' });
  }

  @Get('targets')
  async targets(@Headers('authorization') authorization?: string) {
    await this.authorize(authorization);
    return this.service.targets(true);
  }

  @Get('provider-profiles')
  async providerProfiles(@Headers('authorization') authorization?: string) {
    await this.authorize(authorization);
    return this.service.providerProfiles();
  }

  @Get('provider-profile-records')
  async providerProfileRecords(@Headers('authorization') authorization?: string) {
    await this.authorize(authorization);
    return this.service.providerProfileRecords();
  }

  @Get('provider-types')
  async providerTypes(@Headers('authorization') authorization?: string) {
    await this.authorize(authorization);
    return this.service.providerTypes();
  }

  @Post('provider-profiles')
  async createProviderProfile(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    await this.authorize(authorization);
    return this.service.saveProviderProfile(null, body);
  }

  @Put('provider-profiles/:id')
  async updateProviderProfile(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    await this.authorize(authorization);
    return this.service.saveProviderProfile(id, body);
  }

  @Delete('provider-profiles/:id')
  async deleteProviderProfile(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    await this.authorize(authorization);
    return this.service.deleteProviderProfile(id);
  }

  @Get('siteconf-references')
  async siteConfReferences(@Headers('authorization') authorization?: string) {
    await this.authorize(authorization);
    return this.service.siteConfReferences();
  }

  @Post('targets')
  async createTarget(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    await this.authorize(authorization);
    return this.service.saveTarget(null, body);
  }

  @Put('targets/:key')
  async updateTarget(@Headers('authorization') authorization: string | undefined, @Param('key') key: string, @Body() body: unknown) {
    await this.authorize(authorization);
    return this.service.saveTarget(key, body);
  }

  @Post('targets/:key/verify')
  async verifyTarget(@Headers('authorization') authorization: string | undefined, @Param('key') key: string) {
    await this.authorize(authorization);
    return this.service.verifyTarget(key);
  }

  @Delete('targets/:key')
  async deleteTarget(@Headers('authorization') authorization: string | undefined, @Param('key') key: string) {
    await this.authorize(authorization);
    return this.service.deleteTarget(key);
  }

  @Get('history/:key')
  async history(@Headers('authorization') authorization: string | undefined, @Param('key') key: string, @Query('hours') hours?: string) {
    await this.authorize(authorization);
    return this.service.history(key, Number(hours || 24));
  }

  private async authorize(authorization?: string) {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer ')) throw new ForbiddenException('Missing dependency health permission');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user = payload.source === 'keycloak' || typeof payload.sub !== 'number'
      ? await this.access.ensureUserByUsername(payload.username, { displayName: payload.displayName })
      : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    if (!(me.permissions || []).includes('menu:dependency-health')) {
      throw new ForbiddenException('Missing permissions: menu:dependency-health');
    }
  }
}
