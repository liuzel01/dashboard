import { Controller, ForbiddenException, Get, Headers } from '@nestjs/common';
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
  ) {
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
    return this.service.list();
  }
}
