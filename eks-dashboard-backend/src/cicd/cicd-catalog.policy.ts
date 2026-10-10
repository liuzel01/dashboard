export const CICD_ACTION_TYPES = [
  'BUILD_DEPLOY',
  'PACKAGE_PUBLISH',
  'IMAGE_BUILD_PUBLISH',
] as const;
export type CicdActionType = (typeof CICD_ACTION_TYPES)[number];

export type CatalogParameter = {
  name: string;
  type: 'string' | 'boolean' | 'enum' | 'git_branch';
  required?: boolean;
  default?: unknown;
  pattern?: string;
  maxLength?: number;
  choices?: string[];
};

export type ParameterSchema = {
  version: number;
  parameters: CatalogParameter[];
};
export type JenkinsParameter = {
  name: string;
  type: string;
  default: unknown;
  choices?: string[];
};

const SAFE_DISCOVERY_PATTERN = /^\^\([A-Za-z0-9_.|^-]+\)$/;

export const compileJobDiscoveryPattern = (value: string) => {
  const pattern = String(value || '').trim();
  if (!SAFE_DISCOVERY_PATTERN.test(pattern) || pattern.length > 128) {
    throw new Error(
      'Job discovery pattern must be an anchored prefix alternation',
    );
  }
  return new RegExp(pattern);
};

export const parseParameterSchema = (value: unknown): ParameterSchema => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    Number(parsed.version) !== 1 ||
    !('parameters' in parsed) ||
    !Array.isArray(parsed.parameters)
  ) {
    throw new Error('Unsupported parameter schema');
  }
  return parsed as ParameterSchema;
};

const comparableValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
};

const normalizeJenkinsType = (type: string): CatalogParameter['type'] => {
  if (type.includes('Boolean')) return 'boolean';
  if (type.includes('Choice')) return 'enum';
  return 'string';
};

export const compareParameterSchema = (
  schemaValue: unknown,
  remote: JenkinsParameter[],
) => {
  const schema = parseParameterSchema(schemaValue);
  const expected = new Map(schema.parameters.map((item) => [item.name, item]));
  const actual = new Map(remote.map((item) => [item.name, item]));
  const missing = [...expected.keys()].filter((name) => !actual.has(name));
  const unexpected = [...actual.keys()].filter((name) => !expected.has(name));
  const mismatched = [...expected.entries()].flatMap(
    ([name, expectedParameter]) => {
      const actualParameter = actual.get(name);
      if (!actualParameter) return [];
      const expectedType =
        expectedParameter.type === 'git_branch'
          ? 'string'
          : expectedParameter.type;
      const actualType = normalizeJenkinsType(actualParameter.type);
      const defaultMatches =
        expectedParameter.default === undefined ||
        comparableValue(expectedParameter.default) ===
          comparableValue(actualParameter.default);
      return expectedType === actualType && defaultMatches
        ? []
        : [
            {
              name,
              expectedType: expectedParameter.type,
              actualType,
              expectedDefault: expectedParameter.default,
              actualDefault: actualParameter.default,
            },
          ];
    },
  );
  return {
    matches:
      missing.length === 0 &&
      unexpected.length === 0 &&
      mismatched.length === 0,
    missing,
    unexpected,
    mismatched,
  };
};
