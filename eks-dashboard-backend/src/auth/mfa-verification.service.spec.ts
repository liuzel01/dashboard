import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateSecret, generateSync } from 'otplib';
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
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { mfa_enabled: 1, mfa_secret: generateSecret() },
        ])
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ total: 1 }]),
    };
    const service = new MfaVerificationService(db as never);

    await expect(service.verifyForUser(27, '123456')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO mfa_verification_failures'),
      [27, 'sensitive_operation'],
    );
    expect(db.query.mock.calls.flat()).not.toContain('123456');
  });

  it('clears failures after a valid sensitive-operation code', async () => {
    const secret = generateSecret();
    const code = generateSync({ strategy: 'totp', secret });
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ mfa_enabled: 1, mfa_secret: secret }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    const service = new MfaVerificationService(db as never);

    await expect(service.verifyForUser(27, code)).resolves.toBeUndefined();
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('DELETE FROM mfa_verification_failures'),
      [27, 'sensitive_operation'],
    );
  });

  it('rate limits a login after five recent failures', async () => {
    const db = {
      query: jest.fn().mockResolvedValueOnce([{ total: 5 }]),
    };
    const service = new MfaVerificationService(db as never);

    await expect(
      service.verifyLoginForUser(27, generateSecret(), '123456'),
    ).rejects.toMatchObject({ status: 429 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
