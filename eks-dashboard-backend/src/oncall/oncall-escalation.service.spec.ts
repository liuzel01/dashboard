import { OncallEscalationService } from './oncall-escalation.service';

describe('OncallEscalationService', () => {
  const previous = process.env.ONCALL_ESCALATION_ENABLED;
  afterEach(() => { if (previous === undefined) delete process.env.ONCALL_ESCALATION_ENABLED; else process.env.ONCALL_ESCALATION_ENABLED = previous; });

  const config = () => ({
    getEscalationEnabled: jest.fn(async () => process.env.ONCALL_ESCALATION_ENABLED === 'true'),
    getL1AckTimeoutMinutes: jest.fn(async () => Number(process.env.ONCALL_L1_ACK_TIMEOUT_MINUTES || 10)),
    getL2AckTimeoutMinutes: jest.fn(async () => Number(process.env.ONCALL_L2_ACK_TIMEOUT_MINUTES || 5)),
    getOwnerAckTimeoutMinutes: jest.fn(async () => Number(process.env.ONCALL_OWNER_ACK_TIMEOUT_MINUTES || 5)),
  });

  it('does not query or dispatch while escalation is disabled', async () => {
    process.env.ONCALL_ESCALATION_ENABLED = 'false';
    const db = { query: jest.fn(), withTransaction: jest.fn() };
    const service = new OncallEscalationService(db as any, {} as any, config() as any);
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
    const service = new OncallEscalationService(db as any, {} as any, config() as any);
    await (service as any).dispatchOne({ id: 7, alert_id: 8, level: 'L1', status: 'PENDING' });
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE oncall_escalation_records SET status=?'), ['FAILED', 'No Hotline App message_id is available', 7]);
  });
});
