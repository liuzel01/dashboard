import {
  buildParameterSchemaFromRemote,
  compareParameterSchema,
  compileJobDiscoveryPattern,
  matchesJobActionFilter,
  parseJobActionFilter,
  sensitiveJenkinsParameterNames,
} from './cicd-catalog.policy';

describe('CI/CD catalog policy', () => {
  it.each([
    ['^(icoin-|icoinweb)', 'icoin-kylin-price', true],
    ['^(icoin-|icoinweb)', 'icoinweb-partner-admin', true],
    ['^(icoin-|icoinweb)', 'devops-kylin-script-icoin', false],
    ['^(mega-|megaweb)', 'mega-kylin-price', true],
  ])('applies controlled prefix pattern %s to %s', (pattern, job, expected) => {
    expect(compileJobDiscoveryPattern(pattern).test(job)).toBe(expected);
  });

  it('rejects unbounded or feature-rich regular expressions', () => {
    expect(() => compileJobDiscoveryPattern('icoin-')).toThrow();
    expect(() => compileJobDiscoveryPattern('^(icoin-.*|icoinweb)')).toThrow();
  });

  it('detects Jenkins parameter drift', () => {
    const schema = {
      version: 1,
      parameters: [
        { name: 'GIT_BRANCH', type: 'git_branch', default: 'saas_test' },
      ],
    };
    expect(
      compareParameterSchema(schema, [
        {
          name: 'GIT_BRANCH',
          type: 'StringParameterDefinition',
          default: 'saas_test',
        },
      ]).matches,
    ).toBe(true);
    expect(
      compareParameterSchema(schema, [
        {
          name: 'BRANCH_NAME',
          type: 'StringParameterDefinition',
          default: 'saas_test',
        },
      ]),
    ).toMatchObject({
      matches: false,
      missing: ['GIT_BRANCH'],
      unexpected: ['BRANCH_NAME'],
    });
  });

  it('builds a safe catalog schema from remote Jenkins parameters', () => {
    const result = buildParameterSchemaFromRemote(
      {
        version: 1,
        parameters: [
          {
            name: 'GIT_BRANCH',
            type: 'git_branch',
            required: true,
            pattern: '^[A-Za-z0-9._/-]{1,128}$',
          },
          { name: 'MEEGLE_ID', type: 'string', maxLength: 128 },
        ],
      },
      [
        { name: 'GIT_BRANCH', type: 'StringParameterDefinition', default: 'saas_test' },
        { name: 'MEEGLE_ID', type: 'StringParameterDefinition', default: '' },
        { name: 'COVERAGE_CALLBACK_ENABLED', type: 'BooleanParameterDefinition', default: false },
      ],
    );
    expect(result).toMatchObject({
      version: 1,
      parameters: [
        { name: 'GIT_BRANCH', type: 'git_branch', required: true, default: 'saas_test' },
        { name: 'MEEGLE_ID', type: 'string', maxLength: 128, default: '' },
        { name: 'COVERAGE_CALLBACK_ENABLED', type: 'boolean', required: false, default: false },
      ],
    });
  });

  it('does not allow sensitive Jenkins parameters to be auto-synced', () => {
    expect(
      sensitiveJenkinsParameterNames([
        { name: 'API_TOKEN', type: 'StringParameterDefinition', default: '' },
        { name: 'PASSWORD', type: 'PasswordParameterDefinition', default: '' },
      ]),
    ).toEqual(['API_TOKEN', 'PASSWORD']);
  });

  it('separates action types with safe job-name tokens', () => {
    expect(
      matchesJobActionFilter(
        { includeAnyTokens: ['publish'] },
        'hash-kylin-common-publish',
      ),
    ).toBe(true);
    expect(
      matchesJobActionFilter(
        { includeAnyTokens: ['publish'] },
        'hash-kylin-price-kylin-price-impl',
      ),
    ).toBe(false);
    expect(
      matchesJobActionFilter(
        { excludeAnyTokens: ['npmpublish'] },
        'megaweb-npmpublish-mega-pack',
      ),
    ).toBe(false);
  });

  it('rejects unbounded regular-expression-like action filters', () => {
    expect(() => parseJobActionFilter({ includeAnyTokens: ['.*publish.*'] })).toThrow();
  });
});
