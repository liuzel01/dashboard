import { sanitizeAuditPayload } from './audit.sanitizer';

describe('sanitizeAuditPayload', () => {
  it('redacts one-time tickets and AWS federation redirect URLs', () => {
    expect(
      sanitizeAuditPayload({
        ticket: 'one-time-secret',
        redirectUrl:
          'https://signin.aws.amazon.com/federation?SigninToken=secret',
        nested: { signinToken: 'secret' },
      }),
    ).toEqual({
      ticket: '***',
      redirectUrl: '***',
      nested: { signinToken: '***' },
    });
  });

  it('redacts MFA codes from failed verification request summaries', () => {
    expect(
      sanitizeAuditPayload({
        username: 'admin',
        otpCode: '123456',
        nested: { mfaCode: '654321', totp: '111111' },
      }),
    ).toEqual({
      username: 'admin',
      otpCode: '***',
      nested: { mfaCode: '***', totp: '***' },
    });
  });
});
