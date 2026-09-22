import { OncallEscalationService } from './oncall-escalation.service';

describe('OncallEscalationService', () => {
  const previous = process.env.ONCALL_ESCALATION_ENABLED;
  afterEach(() => { if (previous === undefined) delete process.env.ONCALL_ESCALATION_ENABLED; else process.env.ONCALL_ESCALATION_ENABLED = previous; });

  it('does not query or dispatch while escalation is disabled', async () => {
    process.env.ONCALL_ESCALATION_ENABLED = 'false';
    const db = { query: jest.fn(), withTransaction: jest.fn() };
    const service = new OncallEscalationService(db as any, {} as any);
    await service.run();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('records a failed escalation when the sent Hotline message is unavailable', async () => {
    process.env.ONCALL_ESCALATION_ENABLED = 'true';
    const execute = jest.fn()
      .mockResolvedValueOnce([[{ id: 7, alert_id: 8, level: 'L1', status: 'PENDING', alert_status: 'FIRING' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const db = {
      withTransaction: jest.fn(async (fn: any) => fn({ execute })),
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const service = new OncallEscalationService(db as any, {} as any);
    await (service as any).dispatchOne({ id: 7, alert_id: 8, level: 'L1', status: 'PENDING' });
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE oncall_escalation_records SET status=?'), ['FAILED', 'No Hotline App message_id is available', 7]);
  });
});
