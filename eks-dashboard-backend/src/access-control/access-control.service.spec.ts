import { AccessControlService } from './access-control.service';

describe('AccessControlService default permissions', () => {
  it('uses an idempotent insert when another request creates a missing permission concurrently', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    const service = new AccessControlService(db as any);

    await (service as any).ensureDefaultPermissions();

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain(
      'ON DUPLICATE KEY UPDATE name = VALUES(name)',
    );
  });

  it('does not issue an insert when all default permissions already exist', async () => {
    const db = { query: jest.fn() };
    const service = new AccessControlService(db as any);

    db.query.mockResolvedValueOnce(
      // Read the keys from the generated insert arguments without exporting the
      // production constant: the first call below exposes all defaults as missing.
      [],
    );
    await (service as any).ensureDefaultPermissions();
    const insertParams = db.query.mock.calls[1][1] as string[];
    const existing = insertParams
      .filter((_, index) => index % 2 === 0)
      .map((key) => ({ key }));

    db.query.mockReset();
    db.query.mockResolvedValueOnce(existing);
    await (service as any).ensureDefaultPermissions();

    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
