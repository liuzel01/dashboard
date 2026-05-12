import {
  AUDIT_EXACT_RULES,
  AUDIT_EXCLUDED_PATHS,
  AUDIT_EXCLUDED_PREFIXES,
  AUDIT_GET_PREFIX_ALLOWLIST,
  AUDIT_PATTERN_RULES,
  type AuditRuleConfig,
} from './audit.rules';

export type AuditRule = AuditRuleConfig;

const shouldFallbackAudit = (method: string, path: string) => {
  if (AUDIT_EXCLUDED_PATHS.includes(path)) return false;
  if (AUDIT_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (method === 'GET') return AUDIT_GET_PREFIX_ALLOWLIST.some((prefix) => path.startsWith(prefix));
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
};

export const resolveAuditRule = (methodRaw: string, pathRaw: string, ctx: { body?: any; query?: any } = {}) => {
  const method = methodRaw.toUpperCase();
  const path = pathRaw.replace(/^\/api/, '').split('?')[0] || '/';

  const exact = AUDIT_EXACT_RULES.find((rule) => rule.method === method && rule.path === path);
  if (exact) {
    return {
      ...exact,
      resourceId: exact.getResourceId?.({ body: ctx.body, query: ctx.query }) || null,
    };
  }

  for (const rule of AUDIT_PATTERN_RULES) {
    if (rule.method !== method) continue;
    const match = path.match(rule.regex);
    if (!match) continue;
    const params = Object.fromEntries(match.slice(1).map((value, index) => [String(index), value]));
    return {
      ...rule,
      resourceId: rule.getResourceId?.({ params, body: ctx.body, query: ctx.query }) || null,
    };
  }

  if (!shouldFallbackAudit(method, path)) return null;

  return {
    method,
    path,
    action: `${method.toLowerCase()}.${path.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '.') || 'root'}`,
    actionName: `${method} ${path}`,
    menuKey: undefined,
    targetType: undefined,
    resourceId: null,
  };
};
