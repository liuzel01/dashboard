export const MFA_CODE_PATTERN = /^\d{6}$/;

export const normalizeMfaCode = (value: string) =>
  value.replace(/\D/g, '').slice(0, 6);
