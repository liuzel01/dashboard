const SENSITIVE_KEYWORDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'credential',
  'access_key',
  'secret_key',
  'aws_access_key_id',
  'aws_secret_access_key',
  'private_key',
  'kubeconfig',
  'cookie',
];

const MAX_STRING_LENGTH = 500;
const MAX_JSON_LENGTH = 5000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 4;

const isSensitiveKey = (key: string) => {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const truncateString = (value: string, max = MAX_STRING_LENGTH) => {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...(truncated ${value.length - max} chars)`;
};

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      result.push(`...(truncated ${value.length - MAX_ARRAY_ITEMS} items)`);
    }
    return result;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
      result[key] = isSensitiveKey(key) ? '***' : sanitizeValue(item, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
    }
    return result;
  }

  return String(value);
};

export const sanitizeAuditPayload = (value: unknown) => {
  const sanitized = sanitizeValue(value, 0);
  const json = JSON.stringify(sanitized);
  if (json.length <= MAX_JSON_LENGTH) return sanitized;
  return {
    truncated: true,
    originalLength: json.length,
    preview: truncateString(json, MAX_JSON_LENGTH),
  };
};

export const toJsonParam = (value: unknown) => {
  if (value === null || value === undefined) return null;
  return JSON.stringify(sanitizeAuditPayload(value));
};
