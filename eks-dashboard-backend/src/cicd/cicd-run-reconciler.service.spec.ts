import { CicdRunReconcilerService } from './cicd-run-reconciler.service';

describe('CicdRunReconcilerService', () => {
  it('refreshes active runs under a database lock and emits changed records once', async () => {
    const connection = {
      query: jest.fn(async (sql: string) =>
        sql.includes('GET_LOCK') ? [[{ acquired: 1 }]] : [[]],
      ),
    };
    const db = {
      withConnection: jest.fn(async (callback: (value: typeof connection) => Promise<void>) => callback(connection)),
    };
    const runs = {
      activeRunIds: jest.fn().mockResolvedValue(['run-1']),
      refreshInternal: jest.fn().mockResolvedValue({ run_id: 'run-1' }),
      recentlyUpdatedRuns: jest.fn().mockResolvedValue([
        { run_id: 'run-1', status: 'RUNNING', updated_at: '2026-10-10 01:00:00', build_number: 3 },
      ]),
    };
    const events = { emitRunUpdated: jest.fn() };
    const service = new CicdRunReconcilerService(db as never, runs as never, events as never);

    await service.reconcile();
    await service.reconcile();

    expect(runs.refreshInternal).toHaveBeenCalledTimes(2);
    expect(events.emitRunUpdated).toHaveBeenCalledTimes(1);
    expect(connection.query).toHaveBeenCalledWith("SELECT RELEASE_LOCK('dashboard:cicd-run-reconciler')");
  });

  it('does no work when another process owns the lock', async () => {
    const connection = { query: jest.fn().mockResolvedValue([[{ acquired: 0 }]]) };
    const db = {
      withConnection: jest.fn(async (callback: (value: typeof connection) => Promise<void>) => callback(connection)),
    };
    const runs = { activeRunIds: jest.fn(), refreshInternal: jest.fn(), recentlyUpdatedRuns: jest.fn() };
    const events = { emitRunUpdated: jest.fn() };
    const service = new CicdRunReconcilerService(db as never, runs as never, events as never);

    await service.reconcile();

    expect(runs.activeRunIds).not.toHaveBeenCalled();
    expect(events.emitRunUpdated).not.toHaveBeenCalled();
  });
});
