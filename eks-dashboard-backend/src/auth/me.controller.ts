import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccessControlService } from '../access-control/access-control.service';
import { ConfigService } from '@nestjs/config';

@Controller('me')
export class MeController {
  constructor(
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async getMe(
    @Headers('authorization') authorization?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Headers('x-username') usernameHeader?: string,
    @Query('userId') userIdQuery?: string,
    @Query('username') usernameQuery?: string,
  ) {
    const auth = authorization || '';
    if (auth.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim();
      const payload = await this.authService.verifyToken(token);
      let userId: number;
      if (payload.source === 'keycloak' || typeof payload.sub !== 'number') {
        const user = await this.accessControl.ensureUserByUsername(payload.username, {
          displayName: payload.displayName,
        });
        userId = user.id;
      } else {
        userId = Number(payload.sub);
      }
      const me = await this.accessControl.getMe({ userId });
      return {
        ...me,
        identity: {
          source: payload.source,
          username: payload.username,
          display_name: payload.displayName || payload.username,
          email: payload.email || null,
        },
      };
    }

    const devBypass = this.config.get<string>('AUTH_DEV_BYPASS') === 'true';
    if (devBypass) {
      const userIdRaw = userIdHeader || userIdQuery;
      const userId = userIdRaw ? Number(userIdRaw) : undefined;
      const username = (usernameHeader || usernameQuery || '').trim();
      return this.accessControl.getMe({
        userId: Number.isNaN(userId as number) ? undefined : userId,
        username: username || undefined,
        allowDefaultUser: true,
        allowBootstrap: true,
      });
    }

    throw new UnauthorizedException('Missing token');
  }
}
