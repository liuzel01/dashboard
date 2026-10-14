import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateSecret } from 'otplib';
import { MfaVerificationService } from './mfa-verification.service';

describe('MfaVerificationService', () => {
  it('reads the latest MFA binding and rejects an unbound account', async () => {
    const db = { query: jest.fn().mockResolvedValue([]) };
    const service = new MfaVerificationService(db as never);

    await expect(service.verifyForUser(27, '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT mfa_enabled, mfa_secret'),
      [27],
    );
  });

  it('rejects an invalid OTP after loading the latest binding', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([
        { mfa_enabled: 1, mfa_secret: generateSecret() },
      ]),
    };
    const service = new MfaVerificationService(db as never);

    await expect(service.verifyForUser(27, '123456')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
