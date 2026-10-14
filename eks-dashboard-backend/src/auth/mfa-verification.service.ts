import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { verifyTotpCode } from './mfa';

/**
 * Verifies a sensitive-operation MFA challenge against the user's latest
 * binding. Business services must not carry MFA secrets in their actor state.
 */
@Injectable()
export class MfaVerificationService {
  constructor(private readonly db: PlatformDatabaseService) {}

  async verifyForUser(userId: number, code?: string) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('无效的 MFA 用户');
    }
    const rows = await this.db.query<any[]>(
      'SELECT mfa_enabled, mfa_secret FROM users WHERE id = ? LIMIT 1',
      [id],
    );
    const user = rows[0];
    if (Number(user?.mfa_enabled || 0) !== 1 || !user?.mfa_secret) {
      throw new BadRequestException('当前账号未启用 Google Authenticator MFA');
    }
    if (!verifyTotpCode(String(user.mfa_secret), code)) {
      throw new UnauthorizedException('Google 验证码错误');
    }
  }
}
