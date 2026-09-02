import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AccessControlService } from '../access-control/access-control.service';
import { ListSiteConfDto, UpsertSiteConfDto } from './dto/site-conf.dto';
import { SiteConfService } from './site-conf.service';

@Controller('site-conf')
export class SiteConfController {
  constructor(private readonly siteConfService: SiteConfService, private readonly auth: AuthService, private readonly access: AccessControlService) {}

  private async assertSiteConfAccess(authorization?: string) {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer ')) throw new ForbiddenException('Missing siteconf permission');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user = payload.source === 'keycloak' || typeof payload.sub !== 'number' ? await this.access.ensureUserByUsername(payload.username, { displayName: payload.displayName }) : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    if (!(me.permissions || []).includes('menu:site-conf')) throw new ForbiddenException('Missing permissions: menu:site-conf');
  }

  @Get('/runtime-config')
  runtimeConfig() {
    return this.siteConfService.getPublicRuntimeConfig();
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async list(@Headers('authorization') auth: string | undefined, @Query() query: ListSiteConfDto) {
    await this.assertSiteConfAccess(auth); return this.siteConfService.list(query);
  }

  @Get('categories')
  async categories(@Headers('authorization') auth: string | undefined) {
    await this.assertSiteConfAccess(auth); return this.siteConfService.categories();
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async upsert(@Headers('authorization') auth: string | undefined, @Body() body: UpsertSiteConfDto) {
    await this.assertSiteConfAccess(auth); return this.siteConfService.upsert(body);
  }

  @Delete(':confKey')
  async remove(@Headers('authorization') auth: string | undefined, @Param('confKey') confKey: string) {
    await this.assertSiteConfAccess(auth); return this.siteConfService.remove(confKey);
  }
}
