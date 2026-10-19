/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
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

  it('returns stored target names instead of exposing target UUIDs as labels', () => {
    expect(
      (service as any).targetLines(
        'NODE:node-1:/DEFAULT/hashex/开发\nASSET:asset-1:tenant-admin · /DEFAULT/hashex/开发',
      ),
    ).toEqual([
      { type: 'NODE', id: 'node-1', name: '/DEFAULT/hashex/开发' },
      {
        type: 'ASSET',
        id: 'asset-1',
        name: 'tenant-admin · /DEFAULT/hashex/开发',
      },
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

    remote.mockResolvedValue({
      count: 3,
      results: [
        { id: 'p1', name: 'ops', is_valid: true },
        { id: 'p2', name: 'dashboard:bundle:1:user:2', is_valid: true },
        { id: 'p3', name: 'expired', is_valid: false },
      ],
    });
    const permissions = await service.catalog('token', 'permissions');
    expect(remote).toHaveBeenLastCalledWith(
      'grant',
      'GET',
      expect.stringContaining('/api/v1/perms/asset-permissions/'),
    );
    expect(permissions.items.map((item) => item.name)).toEqual(['ops']);
  });

  it('reads only reusable scope fields from an Asset Permission template', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    jest
      .spyOn(service as any, 'remote')
      .mockResolvedValueOnce({
        id: 'permission-1',
        name: 'ops-template',
        is_valid: true,
        users: [{ id: 'user-1', name: 'must-not-copy' }],
        user_groups: [{ id: 'group-1', name: 'must-not-copy' }],
        assets: [{ id: 'asset-1', name: 'host-1' }],
        nodes: [{ id: 'node-1', name: 'production' }],
        accounts: ['@ALL'],
        protocols: ['ssh'],
        actions: [{ value: 'connect' }, { value: 'download' }],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'asset-1',
            name: 'host-1',
            nodes_display: ['/DEFAULT/hashex/开发'],
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'node-1',
            name: 'production',
            full_value: '/DEFAULT/hashex/开发',
          },
        ],
      })
      .mockResolvedValueOnce({
        count: 9,
        results: [{ asset: 'asset-1', asset_display: 'host-1' }],
      });

    const template = await service.permissionTemplate('token', 'permission-1');
    expect(template.targets).toEqual([
      {
        type: 'ASSET',
        id: 'asset-1',
        name: 'host-1 · /DEFAULT/hashex/开发',
      },
      { type: 'NODE', id: 'node-1', name: '/DEFAULT/hashex/开发' },
    ]);
    expect(template.actions).toEqual(['connect', 'download']);
    expect(template.effectiveAssets).toEqual({
      count: 9,
      sample: [{ id: 'asset-1', name: 'host-1', address: undefined }],
    });
    expect(template).not.toHaveProperty('users');
    expect(template).not.toHaveProperty('userGroups');
    expect(template.risks.join(' ')).toContain('高风险动作');
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

  it('keeps an unchanged synchronized grant idempotent', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    const desired = {
      user: 'remote-user',
      bundle: 7,
      targets: [['ASSET', 'asset-1']],
      accounts: ['@ALL'],
      protocols: ['ssh'],
      actions: ['connect'],
    };
    const desiredHash = createHash('sha256')
      .update(JSON.stringify(desired))
      .digest('hex');
    db.query
      .mockResolvedValueOnce([{ remote_user_id: 'remote-user' }])
      .mockResolvedValueOnce([
        {
          id: 7,
          accounts_json: '["@ALL"]',
          protocols_json: '["ssh"]',
          actions_json: '["connect"]',
        },
      ])
      .mockResolvedValueOnce([
        {
          bundle_id: 7,
          remote_permission_id: 'permission-7',
          desired_hash: desiredHash,
          status: 'SYNCED',
        },
      ])
      .mockResolvedValueOnce([{ target_type: 'ASSET', remote_id: 'asset-1' }])
      .mockResolvedValueOnce({});
    const remote = jest.spyOn(service as any, 'remote');

    await expect(service.syncUser('token', 2)).resolves.toEqual({
      dashboardUserId: 2,
      results: [{ bundleId: 7, status: 'SYNCED', unchanged: true }],
    });
    expect(remote).not.toHaveBeenCalled();
  });

  it('records a failed remote synchronization without reporting success', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    db.query
      .mockResolvedValueOnce([{ remote_user_id: 'remote-user' }])
      .mockResolvedValueOnce([
        {
          id: 7,
          accounts_json: '["@ALL"]',
          protocols_json: '["ssh"]',
          actions_json: '["connect"]',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ target_type: 'ASSET', remote_id: 'asset-1' }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    jest
      .spyOn(service as any, 'remote')
      .mockRejectedValue(new Error('provider unavailable'));

    const result = await service.syncUser('token', 2);
    expect(result.results).toEqual([
      {
        bundleId: 7,
        status: 'FAILED',
        error: 'provider unavailable',
      },
    ]);
    expect(db.query.mock.calls[4][0]).toContain("status='FAILED'");
    expect(db.query.mock.calls[5][1]).toEqual(
      expect.arrayContaining(['GRANT_SYNC', 'PARTIAL']),
    );
  });

  it('derives portal eligibility from direct user bindings', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    db.query.mockResolvedValueOnce([
      {
        remote_user_id: 'remote-user-2',
        remote_username: 'mapped-user',
        bundle_id: 7,
        bundle_name: 'ops-assets',
        remote_permission_id: 'permission-7',
        status: 'SYNCED',
        accounts_json: '["@ALL"]',
        protocols_json: '["ssh"]',
      },
    ]);
    const remote = jest
      .spyOn(service as any, 'remote')
      .mockResolvedValueOnce({
        id: 'permission-7',
        name: 'dashboard:bundle:7:user:2',
        is_valid: true,
        is_active: true,
        users: [{ id: 'remote-user-2' }],
      })
      .mockResolvedValueOnce({
        count: 1,
        results: [{ asset: 'asset-1' }],
      })
      .mockResolvedValueOnce({
        permed_accounts: [{ id: 'account-1' }],
        permed_protocols: [{ name: 'ssh' }],
      });

    const status = await service.myStatus('token');
    expect(db.query.mock.calls[0][0]).toContain(
      'jumpserver_user_bundle_bindings',
    );
    expect(status.eligible).toBe(true);
    expect(status.grants).toEqual([
      { bundleId: 7, bundleName: 'ops-assets', status: 'SYNCED' },
    ]);
    expect(remote).toHaveBeenLastCalledWith(
      'grant',
      'GET',
      '/api/v1/perms/users/remote-user-2/assets/asset-1/',
    );
  });

  it('fails closed when an effective account or protocol is missing', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    db.query.mockResolvedValueOnce([
      {
        remote_user_id: 'remote-user-2',
        remote_username: 'mapped-user',
        bundle_id: 7,
        bundle_name: 'ops-assets',
        remote_permission_id: 'permission-7',
        status: 'SYNCED',
        accounts_json: '["account-expected"]',
        protocols_json: '["ssh"]',
      },
    ]);
    jest
      .spyOn(service as any, 'remote')
      .mockResolvedValueOnce({
        name: 'dashboard:bundle:7:user:2',
        is_valid: true,
        is_active: true,
        users: ['remote-user-2'],
      })
      .mockResolvedValueOnce({
        count: 1,
        results: [{ asset: { id: 'asset-1' } }],
      })
      .mockResolvedValueOnce({
        permed_accounts: [{ id: 'another-account' }],
        permed_protocols: ['ssh'],
      });

    await expect(service.myStatus('token')).resolves.toMatchObject({
      eligible: false,
      grants: [{ bundleId: 7, status: 'DRIFTED' }],
    });
  });

  it('fails closed when effective asset expansion exceeds the safety limit', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    db.query.mockResolvedValueOnce([
      {
        remote_user_id: 'remote-user-2',
        bundle_id: 7,
        remote_permission_id: 'permission-7',
        status: 'SYNCED',
        accounts_json: '["@ALL"]',
        protocols_json: '["ssh"]',
      },
    ]);
    const remote = jest
      .spyOn(service as any, 'remote')
      .mockResolvedValueOnce({
        name: 'dashboard:bundle:7:user:2',
        is_valid: true,
        users: ['remote-user-2'],
      })
      .mockResolvedValueOnce({ count: 201, results: [] });

    const status = await service.myStatus('token');
    expect(status.eligible).toBe(false);
    expect(status.grants[0].status).toBe('DRIFTED');
    expect(remote).toHaveBeenCalledTimes(2);
  });

  it('creates the internal scope snapshot and user binding atomically', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    db.query.mockResolvedValueOnce([{ id: 10 }]);
    const conn = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([{ insertId: 21 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}]),
    };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));
    const syncUser = jest
      .spyOn(service, 'syncUser')
      .mockResolvedValue({ dashboardUserId: 2, results: [] });

    const result = await service.createUserGrant('token', {
      dashboardUserId: 2,
      targets: [{ type: 'ASSET', id: 'asset-1', name: 'test-asset' }],
      accounts: ['@ALL'],
      protocols: ['ssh'],
    });

    expect(result.bundleId).toBe(21);
    expect(conn.execute.mock.calls[2][0]).toContain(
      'jumpserver_user_bundle_bindings',
    );
    expect(syncUser).toHaveBeenCalledWith('token', 2);
  });

  it('snapshots a template and binds it to one Dashboard user atomically', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 1 });
    jest
      .spyOn(service as any, 'remote')
      .mockResolvedValueOnce({
        id: 'permission-1',
        name: 'ops-template',
        is_valid: true,
        users: [{ id: 'remote-user' }],
        user_groups: [{ id: 'remote-group' }],
        assets: [{ id: 'asset-1', name: 'host-1' }],
        nodes: [],
        accounts: ['@ALL'],
        protocols: ['ssh'],
        actions: [{ value: 'connect' }, { value: 'download' }],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'asset-1',
            name: 'host-1',
            nodes_display: ['/DEFAULT/test'],
          },
        ],
      })
      .mockResolvedValueOnce({ count: 1, results: [] });
    db.query.mockResolvedValueOnce([{ id: 10 }]);
    const conn = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([{ insertId: 22 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}]),
    };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));
    jest
      .spyOn(service, 'syncUser')
      .mockResolvedValue({ dashboardUserId: 2, results: [] });

    const result = await service.createUserGrantFromTemplate('token', {
      dashboardUserId: 2,
      permissionId: 'permission-1',
    });

    expect(result.bundleId).toBe(22);
    expect(conn.execute.mock.calls[0][0]).toContain('source_snapshot_hash');
    expect(conn.execute.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['permission-1', 'ops-template']),
    );
    expect(conn.execute.mock.calls[1][1]).toEqual([
      22,
      'ASSET',
      'asset-1',
      'host-1 · /DEFAULT/test',
    ]);
    expect(conn.execute.mock.calls[2][0]).toContain(
      'jumpserver_user_bundle_bindings',
    );
  });

  it('rejects preparing a portal ticket without a browser session', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    jest.spyOn(service, 'myStatus').mockResolvedValue({
      mapped: true,
      eligible: true,
      remoteUsername: 'mapped-user',
      grants: [],
    });

    await expect(service.prepareTicket('token', '')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['PORTAL_DENIED', 'DENIED']),
    );
  });

  it('records a denied event when remote access is not eligible', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    jest.spyOn(service, 'myStatus').mockResolvedValue({
      mapped: true,
      eligible: false,
      remoteUsername: 'mapped-user',
      grants: [{ bundleId: 7, status: 'DRIFTED' }],
    });

    await expect(
      service.prepareTicket('token', 'session-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['PORTAL_DENIED', 'DENIED']),
    );
  });

  it('clamps the configured portal ticket lifetime to the safe maximum', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    jest.spyOn(service, 'myStatus').mockResolvedValue({
      mapped: true,
      eligible: true,
      remoteUsername: 'mapped-user',
      grants: [],
    });
    siteConf.getNumber = jest.fn().mockResolvedValue(999);
    db.query.mockResolvedValue({});

    const result = await service.prepareTicket('token', 'session-2');
    expect(typeof result.ticket).toBe('string');
    expect(result.expiresInSeconds).toBe(300);
    expect(db.query.mock.calls[0][1][4]).toBe(300);
  });

  it('rejects an unknown ticket without leaking validation details', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    const conn = { execute: jest.fn().mockResolvedValueOnce([[]]) };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));

    await expect(
      service.consumeTicket('token', 'session-2', 'invalid-ticket'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conn.execute.mock.calls[0][0]).toContain('is_expired');
    expect(conn.execute.mock.calls[0][1]).toEqual([expect.any(String)]);
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['PORTAL_DENIED', 'DENIED']),
    );
  });

  it('records expired and denied events for an unconsumed expired ticket', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    const conn = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          [
            {
              ticket_id: 'expired-ticket-id',
              dashboard_user_id: 2,
              consumed_at: null,
              expired_event_at: null,
              is_expired: 1,
            },
          ],
        ])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{}]),
    };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));

    await expect(
      service.consumeTicket('token', 'session-2', 'expired-ticket'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conn.execute.mock.calls[2][1]).toEqual(
      expect.arrayContaining(['PORTAL_EXPIRED', 'EXPIRED']),
    );
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['PORTAL_DENIED', 'DENIED']),
    );
  });

  it('records each naturally expired ticket only after claiming it', async () => {
    const conn = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          [
            {
              ticket_id: 'expired-ticket-id',
              dashboard_user_id: 2,
              expired_event_at: null,
            },
          ],
        ])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{}]),
    };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));

    await service.recordExpiredPortalTickets();
    expect(conn.execute.mock.calls[0][0]).toContain('expired_event_at IS NULL');
    expect(conn.execute.mock.calls[1][0]).toContain(
      'expired_event_at=UTC_TIMESTAMP',
    );
    expect(conn.execute.mock.calls[2][1]).toEqual(
      expect.arrayContaining(['PORTAL_EXPIRED', 'EXPIRED']),
    );
  });

  it('records a denied event for a replayed or mismatched-session ticket', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    const conn = {
      execute: jest.fn().mockResolvedValueOnce([
        [
          {
            ticket_id: 'consumed-ticket-id',
            dashboard_user_id: 2,
            session_hash: 'another-session',
            consumed_at: new Date(),
            is_expired: 0,
          },
        ],
      ]),
    };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));

    await expect(
      service.consumeTicket('token', 'session-2', 'consumed-ticket'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['PORTAL_DENIED', 'DENIED']),
    );
  });

  it('consumes a valid ticket exactly once before returning the fixed portal', async () => {
    jest.spyOn(service as any, 'actor').mockResolvedValue({ userId: 2 });
    jest.spyOn(service, 'myStatus').mockResolvedValue({
      mapped: true,
      eligible: true,
      remoteUsername: 'mapped-user',
      grants: [],
    });
    jest.spyOn(service as any, 'config').mockResolvedValue({
      portalUrl: 'https://jumpserver.example.test',
    });
    jest.spyOn(service as any, 'event').mockResolvedValue(undefined);
    const conn = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          [
            {
              ticket_id: 'ticket-id',
              dashboard_user_id: 2,
              session_hash: createHash('sha256')
                .update('session-2')
                .digest('hex'),
              consumed_at: null,
              is_expired: 0,
            },
          ],
        ])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    };
    db.withTransaction.mockImplementation((callback: any) => callback(conn));

    await expect(
      service.consumeTicket('token', 'session-2', 'valid-ticket'),
    ).resolves.toEqual({ portalUrl: 'https://jumpserver.example.test' });
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(conn.execute.mock.calls[1][0]).toContain('consumed_at IS NULL');
  });
});
