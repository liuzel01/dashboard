import { LinesService } from './lines.service';

describe('LinesService availability summary', () => {
  const service = Object.create(LinesService.prototype) as LinesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    (service as any).getAvailabilityWindowMs = jest.fn().mockResolvedValue(120_000);
    (service as any).getAvailabilityUpThreshold = jest.fn().mockResolvedValue(0.8);
  });

  afterEach(() => jest.useRealTimers());

  const record = (region: string, ok: boolean | null, ageSeconds = 30) => ({
    host: 'line.example.com',
    region,
    ok,
    statusCode: ok === true ? 200 : ok === false ? 500 : null,
    errorText: ok === false ? 'http failure' : '',
    checkedAt: new Date(Date.now() - ageSeconds * 1000),
  });

  it('reports all expected agents when some regions have no current sample', async () => {
    const result = await (service as any).buildAvailabilitySummaryByHost(
      'line.example.com',
      [record('beijing', true), record('shanghai', true)],
      false,
      8,
    );

    expect(result).toMatchObject({
      availability: 'up',
      availabilityScore: 100,
      successRegions: 2,
      failedRegions: 0,
      unknownRegions: 6,
      totalRegions: 8,
    });
  });

  it('counts stale agent samples as unknown coverage', async () => {
    const result = await (service as any).buildAvailabilitySummaryByHost(
      'line.example.com',
      [record('beijing', true, 180)],
      false,
      8,
    );

    expect(result).toMatchObject({
      availability: 'unknown',
      availabilityScore: null,
      successRegions: 0,
      failedRegions: 0,
      unknownRegions: 8,
      totalRegions: 8,
    });
  });
});
