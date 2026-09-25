import { generateSecret, generateSync } from 'otplib';
import { verifyTotpCode } from './mfa';

describe('MFA TOTP verification', () => {
  it('rejects an invalid six-digit code', () => {
    const secret = generateSecret();
    expect(verifyTotpCode(secret, '123456')).toBe(false);
  });

  it('accepts the current code generated from the same secret', () => {
    const secret = generateSecret();
    const code = generateSync({ strategy: 'totp', secret });
    expect(verifyTotpCode(secret, code)).toBe(true);
  });
});
