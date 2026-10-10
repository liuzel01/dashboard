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

export type JobActionFilter = {
  includeAnyTokens?: string[];
  excludeAnyTokens?: string[];
};

const SAFE_DISCOVERY_PATTERN = /^\^\([A-Za-z0-9_.|^-]+\)$/;
const SAFE_JOB_TOKEN = /^[a-z0-9]{1,64}$/;

export const compileJobDiscoveryPattern = (value: string) => {
  const pattern = String(value || '').trim();
  if (!SAFE_DISCOVERY_PATTERN.test(pattern) || pattern.length > 128) {
    throw new Error(
      'Job discovery pattern must be an anchored prefix alternation',
    );
  }
  return new RegExp(pattern);
};

const normalizeJobFilterTokens = (value: unknown, field: string) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32)
    throw new Error(`${field} must be an array with at most 32 tokens`);
  const tokens = value.map((item) => String(item || '').trim().toLowerCase());
  if (tokens.some((token) => !SAFE_JOB_TOKEN.test(token)))
    throw new Error(`${field} contains an invalid job-name token`);
  return [...new Set(tokens)];
};

export const parseJobActionFilter = (value: unknown): JobActionFilter => {
  if (value === null || value === undefined || value === '') return {};
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error('Invalid job action filter JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Job action filter must be an object');
  const raw = parsed as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((key) => !['includeAnyTokens', 'excludeAnyTokens'].includes(key)))
    throw new Error('Job action filter has unsupported fields');
  const includeAnyTokens = normalizeJobFilterTokens(raw.includeAnyTokens, 'includeAnyTokens');
  const excludeAnyTokens = normalizeJobFilterTokens(raw.excludeAnyTokens, 'excludeAnyTokens');
  return {
    ...(includeAnyTokens?.length ? { includeAnyTokens } : {}),
    ...(excludeAnyTokens?.length ? { excludeAnyTokens } : {}),
  };
};

export const matchesJobActionFilter = (
  filterValue: unknown,
  jobName: string,
) => {
  const filter = parseJobActionFilter(filterValue);
  const tokens = String(jobName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (
    filter.includeAnyTokens?.length &&
    !filter.includeAnyTokens.some((token) => tokens.includes(token))
  )
    return false;
  return !filter.excludeAnyTokens?.some((token) => tokens.includes(token));
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

export const normalizeJenkinsType = (
  type: string,
): Exclude<CatalogParameter['type'], 'git_branch'> => {
  if (type.includes('Boolean')) return 'boolean';
  if (type.includes('Choice')) return 'enum';
  return 'string';
};

const SENSITIVE_PARAMETER_NAME = /(?:password|passwd|secret|token|credential|access.?key)/i;

export const sensitiveJenkinsParameterNames = (remote: JenkinsParameter[]) =>
  remote
    .filter(
      (parameter) =>
        parameter.type.toLowerCase().includes('password') ||
        SENSITIVE_PARAMETER_NAME.test(parameter.name),
    )
    .map((parameter) => parameter.name);

const normalizedDefault = (
  parameter: JenkinsParameter,
  type: Exclude<CatalogParameter['type'], 'git_branch'>,
) => {
  if (type === 'boolean')
    return parameter.default === true || String(parameter.default).toLowerCase() === 'true';
  if (parameter.default === null || parameter.default === undefined) return '';
  return String(parameter.default);
};

/**
 * Builds a catalog schema from Jenkins' live parameter definitions. Existing
 * validation metadata remains in place for parameters that Jenkins still
 * exposes; Jenkins never provides enough information to reconstruct it safely.
 */
export const buildParameterSchemaFromRemote = (
  currentSchemaValue: unknown,
  remote: JenkinsParameter[],
): ParameterSchema => {
  const current = parseParameterSchema(currentSchemaValue);
  const previous = new Map(
    current.parameters.map((parameter) => [parameter.name, parameter]),
  );
  return {
    version: 1,
    parameters: remote.map((remoteParameter) => {
      const existing = previous.get(remoteParameter.name);
      const normalizedType = normalizeJenkinsType(remoteParameter.type);
      const type =
        existing?.type === 'git_branch' && normalizedType === 'string'
          ? 'git_branch'
          : normalizedType;
      const next: CatalogParameter = {
        name: remoteParameter.name,
        type,
        required: existing?.required ?? false,
        default: normalizedDefault(remoteParameter, normalizedType),
      };
      if (type === 'enum' && remoteParameter.choices?.length)
        next.choices = remoteParameter.choices.map(String);
      if (existing?.pattern && type === 'git_branch') next.pattern = existing.pattern;
      if (existing?.maxLength && type === 'string') next.maxLength = existing.maxLength;
      return next;
    }),
  };
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
