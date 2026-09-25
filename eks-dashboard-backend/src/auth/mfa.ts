import { verifySync } from 'otplib';

export const normalizeOtpCode = (code?: string) => String(code || '').replace(/\s+/g, '');

/**
 * otplib v13 returns a result object, while older versions returned a boolean.
 * Normalize both shapes so an invalid token cannot be treated as a truthy object.
 */
export const verifyTotpCode = (secret: string, code?: string) => {
  const token = normalizeOtpCode(code);
  if (!secret || !token) return false;
  const result = verifySync({ strategy: 'totp', secret, token, epochTolerance: 0 });
  return typeof result === 'boolean' ? result : result.valid === true;
};
