import { AiOpsAlertAgentService } from './ai-ops-alert-agent.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */

describe('AiOpsAlertAgentService', () => {
  const evidence = [
    {
      evidenceId: 'metric-1',
      evidenceType: 'METRIC',
      sourceSystem: 'prometheus',
      observedAt: '2026-10-17T18:21:54.000Z',
      title: 'CPU throttling',
      content: { value: 0.33 },
    },
  ];

  it('stays disabled unless explicitly enabled', async () => {
    const aiOps = { completeLogInvestigationJson: jest.fn() };
    const service = new AiOpsAlertAgentService(
      {
        getBoolean: jest.fn(async () => false),
        getNumber: jest.fn(),
      } as any,
      aiOps as any,
    );

    await expect(
      service.analyze({
        environmentId: 'mgbx',
        alertName: 'CPUThrottlingHigh',
        baselineConfidence: 'MEDIUM',
        baselineInsufficientEvidence: false,
        report: {},
        evidence,
      }),
    ).resolves.toEqual({ status: 'DISABLED' });
    expect(aiOps.completeLogInvestigationJson).not.toHaveBeenCalled();
  });

  it('accepts only cited evidence and cannot raise deterministic confidence', async () => {
    const service = new AiOpsAlertAgentService(
      {
        getBoolean: jest.fn(async () => true),
        getNumber: jest.fn(async () => 30),
      } as any,
      {
        completeLogInvestigationJson: jest.fn(async () => ({
          provider: 'cliproxy',
          model: 'test-model',
          text: JSON.stringify({
            summary: '当前证据支持低影响候选判断。',
            findings: [
              { text: 'throttling 升高。', evidenceIds: ['metric-1'] },
            ],
            evidenceIds: ['metric-1'],
            confidence: 'HIGH',
            insufficientEvidence: false,
          }),
        })),
      } as any,
    );

    const result = await service.analyze({
      environmentId: 'mgbx',
      alertName: 'CPUThrottlingHigh',
      baselineConfidence: 'MEDIUM',
      baselineInsufficientEvidence: false,
      report: {},
      evidence,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        confidence: 'MEDIUM',
        insufficientEvidence: false,
      }),
    );
  });

  it('falls back when the model invents an evidence id', async () => {
    const service = new AiOpsAlertAgentService(
      {
        getBoolean: jest.fn(async () => true),
        getNumber: jest.fn(async () => 30),
      } as any,
      {
        completeLogInvestigationJson: jest.fn(async () => ({
          provider: 'cliproxy',
          model: 'test-model',
          text: JSON.stringify({
            summary: 'unsupported',
            findings: [],
            evidenceIds: ['invented'],
            confidence: 'HIGH',
            insufficientEvidence: false,
          }),
        })),
      } as any,
    );

    await expect(
      service.analyze({
        environmentId: 'mgbx',
        alertName: 'CPUThrottlingHigh',
        baselineConfidence: 'HIGH',
        baselineInsufficientEvidence: false,
        report: {},
        evidence,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'FAILED' }));
  });
});
