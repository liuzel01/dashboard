import {
  BadRequestException,
  HttpException,
  HttpStatus,
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
  private static readonly maxFailures = 5;

  constructor(private readonly db: PlatformDatabaseService) {}

  private async failureCount(userId: number, scope: string) {
    const rows = await this.db.query<Array<{ total: number | string }>>(
      `SELECT COUNT(1) AS total
       FROM mfa_verification_failures
       WHERE user_id = ? AND scope = ?
         AND created_at >= (UTC_TIMESTAMP() - INTERVAL 5 MINUTE)`,
      [userId, scope],
    );
    return Number(rows[0]?.total || 0);
  }

  private async assertAttemptsAvailable(userId: number, scope: string) {
    if ((await this.failureCount(userId, scope)) >= MfaVerificationService.maxFailures) {
      throw new HttpException(
        'MFA 验证失败次数过多，请 5 分钟后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailure(userId: number, scope: string) {
    await this.db.query(
      `INSERT INTO mfa_verification_failures (user_id, scope, created_at)
       VALUES (?, ?, UTC_TIMESTAMP())`,
      [userId, scope],
    );
    if ((await this.failureCount(userId, scope)) >= MfaVerificationService.maxFailures) {
      throw new HttpException(
        'MFA 验证失败次数过多，请 5 分钟后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async clearFailures(userId: number, scope: string) {
    await this.db.query(
      'DELETE FROM mfa_verification_failures WHERE user_id = ? AND scope = ?',
      [userId, scope],
    );
  }

  private async verifySecret(
    userId: number,
    secret: string,
    code: string | undefined,
    scope: 'login' | 'sensitive_operation',
  ) {
    await this.assertAttemptsAvailable(userId, scope);
    if (!verifyTotpCode(secret, code)) {
      await this.recordFailure(userId, scope);
      throw new UnauthorizedException('Google 验证码错误');
    }
    await this.clearFailures(userId, scope);
  }

  async verifyLoginForUser(userId: number, secret: string, code?: string) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('无效的 MFA 用户');
    }
    await this.verifySecret(id, secret, code, 'login');
  }

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
    await this.verifySecret(
      id,
      String(user.mfa_secret),
      code,
      'sensitive_operation',
    );
  }
}
