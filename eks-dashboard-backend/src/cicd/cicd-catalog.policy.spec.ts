import {
  compareParameterSchema,
  compileJobDiscoveryPattern,
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
});
