import { AwsGovernanceCollector } from './aws-governance.collector';

describe('AwsGovernanceCollector', () => {
  const collector = new AwsGovernanceCollector({} as any);

  it('produces a stable hash for equivalent objects and array orderings', () => {
    const first = (collector as any).resource(
      'ap-east-1',
      'test:resource',
      'r-1',
      null,
      'test',
      'READY',
      {
        z: [{ id: 'b' }, { id: 'a' }],
        a: { beta: 2, alpha: 1 },
        ignored: undefined,
      },
    );
    const second = (collector as any).resource(
      'ap-east-1',
      'test:resource',
      'r-1',
      null,
      'test',
      'READY',
      {
        a: { alpha: 1, beta: 2 },
        z: [{ id: 'a' }, { id: 'b' }],
      },
    );

    expect(first.normalized).toEqual(second.normalized);
    expect(first.normalizedHash).toBe(second.normalizedHash);
  });

  it('keeps only allowlisted tags and does not persist secret-like tags', () => {
    const tags = (collector as any).tags([
      { Key: 'Name', Value: 'orders-api' },
      { Key: 'Environment', Value: 'hashex' },
      { Key: 'Password', Value: 'must-not-be-stored' },
      { Key: 'token', Value: 'must-not-be-stored' },
    ]);

    expect(tags).toEqual({ Environment: 'hashex', Name: 'orders-api' });
    expect(JSON.stringify(tags)).not.toContain('must-not-be-stored');
  });

  it('records a collector failure without throwing away other collector results', async () => {
    const errors: any[] = [];
    const completed: string[] = [];

    await (collector as any).runCollector(
      'failed-source',
      'ap-east-1',
      errors,
      completed,
      async () => {
        const error = new Error('access denied');
        error.name = 'AccessDeniedException';
        throw error;
      },
    );
    await (collector as any).runCollector(
      'healthy-source',
      'ap-east-1',
      errors,
      completed,
      async () => undefined,
    );

    expect(errors).toEqual([
      expect.objectContaining({
        collector: 'failed-source',
        region: 'ap-east-1',
        code: 'AccessDeniedException',
        message: 'access denied',
      }),
    ]);
    expect(completed).toEqual(['healthy-source:ap-east-1']);
  });
});
