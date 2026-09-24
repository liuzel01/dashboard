import { Body, Controller, Get, Headers, Post, Query, Res, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body(new ValidationPipe({ transform: true })) body: LoginDto) {
    return this.authService.login(body.username, body.password, body.otpCode || body.mfaCode);
  }

  @Get('mfa/status')
  async mfaStatus(@Headers('authorization') authorization?: string) {
    const user = await this.authService.resolveCurrentUser(authorization);
    return this.authService.getMfaStatus(Number(user.id));
  }

  @Post('mfa/enroll/start')
  async startMfaEnrollment(@Headers('authorization') authorization?: string) {
    const user = await this.authService.resolveCurrentUser(authorization);
    return this.authService.startMfaEnrollment(Number(user.id));
  }

  @Post('mfa/enroll/confirm')
  async confirmMfaEnrollment(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: MfaCodeDto,
  ) {
    const user = await this.authService.resolveCurrentUser(authorization);
    return this.authService.confirmMfaEnrollment(Number(user.id), body.otpCode);
  }

  @Post('mfa/disable')
  async disableMfa(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: MfaCodeDto,
  ) {
    const user = await this.authService.resolveCurrentUser(authorization);
    return this.authService.disableMfa(Number(user.id), body.otpCode);
  }

  @Get('keycloak/login')
  async keycloakLogin(@Query('redirectUri') redirectUri: string | undefined, @Res() res: Response) {
    const url = await this.authService.buildKeycloakAuthorizeUrl(redirectUri);
    return res.redirect(url);
  }

  @Get('keycloak/callback')
  async keycloakCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.authService.handleKeycloakCallback({
      code,
      state,
      error,
      errorDescription,
    });
    return res.redirect(url);
  }
}
