import { Body, Controller, Get, Post, Query, Res, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body(new ValidationPipe({ transform: true })) body: LoginDto) {
    return this.authService.login(body.username, body.password, body.otpCode || body.mfaCode);
  }

  @Get('keycloak/login')
  keycloakLogin(@Query('redirectUri') redirectUri: string | undefined, @Res() res: Response) {
    const url = this.authService.buildKeycloakAuthorizeUrl(redirectUri);
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
