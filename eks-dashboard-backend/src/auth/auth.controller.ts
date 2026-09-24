import { Body, Controller, Get, Headers, Param, Post, Query, Res, ValidationPipe } from '@nestjs/common';
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

  @Post('users/:id/mfa/enroll/start')
  async startUserMfaEnrollment(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.authService.requireAdminCurrentUser(authorization);
    return this.authService.startMfaEnrollment(Number(id));
  }

  @Post('users/:id/mfa/enroll/confirm')
  async confirmUserMfaEnrollment(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: MfaCodeDto,
  ) {
    await this.authService.requireAdminCurrentUser(authorization);
    return this.authService.confirmMfaEnrollment(Number(id), body.otpCode);
  }

  @Post('users/:id/mfa/disable')
  async disableUserMfa(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.authService.requireAdminCurrentUser(authorization);
    return this.authService.disableMfaForUser(Number(id));
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
