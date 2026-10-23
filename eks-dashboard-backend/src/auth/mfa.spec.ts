import { generateSecret, generateSync } from 'otplib';
import {
  MFA_TOTP_PERIOD_SECONDS,
  verifyTotpCode,
} from './mfa';

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

  it('accepts only the current and immediately previous time steps', () => {
    const secret = generateSecret();
    const boundary = Math.floor(Date.now() / 30_000) * 30;
    const verifyAt = boundary + 1;
    const tokenAt = (epoch: number) =>
      generateSync({ strategy: 'totp', secret, epoch, period: 30 });
    jest.useFakeTimers().setSystemTime(verifyAt * 1000);

    expect(verifyTotpCode(secret, tokenAt(boundary + 1))).toBe(true);
    expect(verifyTotpCode(secret, tokenAt(boundary - 1))).toBe(true);
    expect(verifyTotpCode(secret, tokenAt(boundary + 31))).toBe(false);
    expect(verifyTotpCode(secret, tokenAt(boundary - 31))).toBe(false);

    jest.useRealTimers();
  });
});
