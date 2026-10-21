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
});
