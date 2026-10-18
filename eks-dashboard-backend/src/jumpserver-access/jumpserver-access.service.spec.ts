/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JumpserverAccessService } from './jumpserver-access.service';

describe('JumpserverAccessService safety policy', () => {
  const db: any = { query: jest.fn(), withTransaction: jest.fn() };
  const auth: any = {};
  const access: any = {};
  const siteConf: any = {};
  let service: JumpserverAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JumpserverAccessService(db, auth, access, siteConf);
  });

  it('blocks unknown read endpoints before credentials are resolved', async () => {
    await expect(
      (service as any).remote('reader', 'GET', '/api/v1/settings/private/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never permits reader identity to call a write endpoint', async () => {
    await expect(
      (service as any).remote(
        'reader',
        'POST',
        '/api/v1/perms/asset-permissions/',
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to revoke a permission not managed by Dashboard', async () => {
    jest
      .spyOn(service as any, 'remote')
      .mockResolvedValue({ id: 'remote-1', name: 'manual-permission' });
    await expect(
      (service as any).revokeManaged({ userId: 1 }, 2, {
        bundle_id: 3,
        remote_permission_id: 'remote-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('normalizes and de-duplicates account/protocol selectors', () => {
    expect((service as any).strings([' ssh ', 'ssh', '', '@ALL'])).toEqual([
      'ssh',
      '@ALL',
    ]);
  });

  it('uses the constrained grant identity only for catalogs denied to the auditor', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    const remote = jest
      .spyOn(service as any, 'remote')
      .mockResolvedValue({ count: 0, results: [] });

    await service.catalog('token', 'users');
    expect(remote).toHaveBeenLastCalledWith(
      'reader',
      'GET',
      expect.stringContaining('/api/v1/users/users/'),
    );

    await service.catalog('token', 'nodes');
    expect(remote).toHaveBeenLastCalledWith(
      'grant',
      'GET',
      expect.stringContaining('/api/v1/assets/nodes/'),
    );
  });

  it('rejects an empty sync instead of reporting a misleading success', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    db.query
      .mockResolvedValueOnce([
        { dashboard_user_id: 2, remote_user_id: 'remote-user' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.syncUser('token', 2)).rejects.toThrow(
      '用户未绑定任何已启用的 JumpServer 授权包',
    );
    expect(db.query.mock.calls[1][0]).toContain(
      'jumpserver_user_bundle_bindings',
    );
    expect(db.query.mock.calls[1][0]).not.toContain('user_roles');
  });

  it('derives portal eligibility from direct user bindings', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    db.query.mockResolvedValueOnce([
      {
        remote_username: 'mapped-user',
        bundle_id: 7,
        bundle_name: 'ops-assets',
        remote_permission_id: 'permission-7',
        status: 'SYNCED',
      },
    ]);
    jest.spyOn(service as any, 'remote').mockResolvedValue({
      id: 'permission-7',
      name: 'dashboard:bundle:7:user:2',
      is_valid: true,
    });

    const status = await service.myStatus('token');
    expect(db.query.mock.calls[0][0]).toContain(
      'jumpserver_user_bundle_bindings',
    );
    expect(status.eligible).toBe(true);
    expect(status.grants).toEqual([
      { bundleId: 7, bundleName: 'ops-assets', status: 'SYNCED' },
    ]);
  });
});
