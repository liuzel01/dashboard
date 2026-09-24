import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

const createService = () => {
  const db = { query: jest.fn() };
  const accessControl = {
    ensureUserByUsername: jest.fn(),
    getMe: jest.fn(),
  };
  const config = { get: jest.fn() };
  const siteConf = { getString: jest.fn() };
  return {
    service: new AuthService(db as any, accessControl as any, config as any, siteConf as any),
    db,
    accessControl,
  };
};

describe('AuthService MFA management', () => {
  it('resolves the user represented by an SSO token before reading MFA state', async () => {
    const { service, accessControl } = createService();
    jest.spyOn(service, 'verifyToken').mockResolvedValue({
      sub: 'keycloak-sub',
      username: 'sso-user',
      displayName: 'SSO User',
      source: 'keycloak',
    });
    accessControl.ensureUserByUsername.mockResolvedValue({ id: 27, username: 'sso-user' });
    accessControl.getMe.mockResolvedValue({ id: 27, username: 'sso-user', permissions: [] });

    const user = await service.resolveCurrentUser('Bearer sso-token');

    expect(accessControl.ensureUserByUsername).toHaveBeenCalledWith('sso-user', { displayName: 'SSO User' });
    expect(accessControl.getMe).toHaveBeenCalledWith({ userId: 27 });
    expect(user.id).toBe(27);
  });

  it('rejects non-admin actors from managing another user MFA', async () => {
    const { service, accessControl } = createService();
    jest.spyOn(service, 'verifyToken').mockResolvedValue({
      sub: 'keycloak-sub',
      username: 'operator',
      displayName: 'Operator',
      source: 'keycloak',
    });
    accessControl.ensureUserByUsername.mockResolvedValue({ id: 27, username: 'operator' });
    accessControl.getMe.mockResolvedValue({ id: 27, username: 'operator', roles: [{ name: '运维' }], permissions: [] });

    await expect(service.requireAdminCurrentUser('Bearer operator-token')).rejects.toThrow('仅 admin 管理员');
  });

  it('creates a pending enrollment and only enables it after code confirmation', async () => {
    const { service, db } = createService();
    db.query
      .mockResolvedValueOnce([{ username: 'sso-user', mfa_enabled: 0, mfa_secret: null }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ mfa_enabled: 1, mfa_secret: 'secret', mfa_confirmed_at: '2026-09-24 12:00:00' }]);

    const enrollment = await service.startMfaEnrollment(27);
    expect(enrollment.secret).toBeTruthy();
    expect(enrollment.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('mfa_enabled = 0'), expect.any(Array));

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce([{ mfa_secret: enrollment.secret }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ mfa_enabled: 1, mfa_secret: enrollment.secret, mfa_confirmed_at: '2026-09-24 12:00:00' }]);
    jest.spyOn(service as any, 'verifyMfaCode').mockReturnValue(true);
    const status = await service.confirmMfaEnrollment(27, '123456');
    expect(status.enabled).toBe(true);
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('mfa_enabled = 1'), [27]);
  });

  it('allows the admin MFA manager to disable a target account without target code', async () => {
    const { service, db } = createService();
    db.query
      .mockResolvedValueOnce([{ id: 27 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ mfa_enabled: 0, mfa_secret: null, mfa_confirmed_at: null }]);
    const status = await service.disableMfaForUser(27);
    expect(status.enabled).toBe(false);
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('mfa_secret = NULL'), [27]);
  });

  it('does not treat an unbound account as MFA enabled', async () => {
    const { service, db } = createService();
    db.query.mockResolvedValueOnce([{ mfa_enabled: 0, mfa_secret: null, mfa_confirmed_at: null }]);
    await expect(service.getMfaStatus(27)).resolves.toEqual({
      enabled: false,
      enrollmentPending: false,
      confirmedAt: null,
    });
    db.query.mockResolvedValueOnce([]);
    await expect(service.verifyMfaForUser(27, '123456')).rejects.toBeInstanceOf(BadRequestException);
  });
});
