import { BadRequestException } from '@nestjs/common';
import { AiOpsAlertNoiseControlService } from './ai-ops-alert-noise-control.service';

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

describe('AiOpsAlertNoiseControlService', () => {
  const makeService = (query: jest.Mock = jest.fn(async () => [])) =>
    new AiOpsAlertNoiseControlService(
      { query } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('matches only exact label values for a local suppression', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 7,
          matchers_json: JSON.stringify([
            { name: 'alertname', value: 'CPUThrottlingHigh' },
            { name: 'namespace', value: 'payments' },
          ]),
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const service = makeService(query);

    await expect(
      service.suppresses('mgbx', {
        alertname: 'CPUThrottlingHigh',
        namespace: 'payments',
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('requires an environment label for an upstream Alertmanager silence', () => {
    const service = makeService();
    expect(() =>
      (service as any).buildMatchers(
        { alertname: 'CPUThrottlingHigh', namespace: 'payments' },
        'mgbx',
        'NAMESPACE',
        true,
      ),
    ).toThrow(BadRequestException);
  });

  it('builds exact non-regex matchers from the controlled label allowlist', () => {
    const service = makeService();
    expect(
      (service as any).buildMatchers(
        {
          alertname: 'CPUThrottlingHigh',
          environment: 'mgbx',
          namespace: 'payments',
          pod: 'api-123',
          arbitrary: 'ignored',
        },
        'mgbx',
        'RESOURCE',
        true,
      ),
    ).toEqual([
      {
        name: 'alertname',
        value: 'CPUThrottlingHigh',
        isRegex: false,
        isEqual: true,
      },
      { name: 'environment', value: 'mgbx', isRegex: false, isEqual: true },
      { name: 'namespace', value: 'payments', isRegex: false, isEqual: true },
      { name: 'pod', value: 'api-123', isRegex: false, isEqual: true },
    ]);
  });
});
