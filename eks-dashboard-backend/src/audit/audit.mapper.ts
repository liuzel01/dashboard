export type AuditRule = {
  method: string;
  path: string;
  action: string;
  actionName: string;
  menuKey?: string;
  targetType?: string;
  getResourceId?: (ctx: { params?: Record<string, unknown>; body?: any; query?: any }) => string | null;
};

const exactRules: AuditRule[] = [
  { method: 'POST', path: '/auth/login', action: 'auth.login', actionName: '登录' },
  { method: 'POST', path: '/auth/logout', action: 'auth.logout', actionName: '登出' },
  { method: 'GET', path: '/s3/buckets', action: 's3.listBuckets', actionName: '查询 S3 Bucket', menuKey: 'menu:s3-upload', targetType: 's3_bucket' },
  { method: 'GET', path: '/s3/prefixes', action: 's3.listPrefixes', actionName: '查询 S3 路径', menuKey: 'menu:s3-upload', targetType: 's3_prefix', getResourceId: ({ query }) => [query?.bucket, query?.prefix].filter(Boolean).join(':') || null },
  { method: 'GET', path: '/deployments', action: 'deployments.list', actionName: '查询 EKS 部署', menuKey: 'menu:deployments', targetType: 'deployment' },
  { method: 'GET', path: '/environments/configs', action: 'environments.listConfigs', actionName: '查询环境配置', menuKey: 'menu:environments', targetType: 'environment' },
  { method: 'POST', path: '/s3/upload', action: 's3.upload', actionName: '上传 S3 对象', menuKey: 'menu:s3-upload', targetType: 's3_object', getResourceId: ({ body }) => [body?.bucket, body?.key].filter(Boolean).join('/') || null },
  { method: 'POST', path: '/s3/object-exists', action: 's3.objectExists', actionName: '检查 S3 对象是否存在', menuKey: 'menu:s3-upload', targetType: 's3_object', getResourceId: ({ body }) => [body?.bucket, body?.key].filter(Boolean).join('/') || null },
  { method: 'POST', path: '/users', action: 'users.create', actionName: '创建用户', menuKey: 'menu:access-control', targetType: 'user', getResourceId: ({ body }) => body?.username || null },
];

const patternRules: Array<AuditRule & { regex: RegExp }> = [
  { method: 'PATCH', path: '/users/:id', regex: /^\/users\/([^/]+)$/, action: 'users.update', actionName: '修改用户', menuKey: 'menu:access-control', targetType: 'user', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'POST', path: '/users/:id/reset-password', regex: /^\/users\/([^/]+)\/reset-password$/, action: 'users.resetPassword', actionName: '重置用户密码', menuKey: 'menu:access-control', targetType: 'user', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'POST', path: '/roles', regex: /^\/roles$/, action: 'roles.create', actionName: '创建角色', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ body }) => body?.name || null },
  { method: 'PATCH', path: '/roles/:id', regex: /^\/roles\/([^/]+)$/, action: 'roles.update', actionName: '修改角色', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'DELETE', path: '/roles/:id', regex: /^\/roles\/([^/]+)$/, action: 'roles.delete', actionName: '删除角色', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'PUT', path: '/roles/:id/permissions', regex: /^\/roles\/([^/]+)\/permissions$/, action: 'roles.updatePermissions', actionName: '修改角色权限', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'PUT', path: '/environments/config/:id', regex: /^\/environments\/config\/([^/]+)$/, action: 'environments.updateConfig', actionName: '修改环境配置', menuKey: 'menu:environments', targetType: 'environment', getResourceId: ({ params }) => String(params?.[0] || '') || null },
];

const isAuditedGet = (path: string) => (
  path.startsWith('/s3/') ||
  path.startsWith('/deployments') ||
  path.startsWith('/environments')
);

const shouldFallbackAudit = (method: string, path: string) => {
  if (path.startsWith('/audit-logs')) return false;
  if (path === '/me' || path.startsWith('/auth/keycloak')) return false;
  if (method === 'GET') return isAuditedGet(path);
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
};

export const resolveAuditRule = (methodRaw: string, pathRaw: string, ctx: { body?: any; query?: any } = {}) => {
  const method = methodRaw.toUpperCase();
  const path = pathRaw.replace(/^\/api/, '').split('?')[0] || '/';

  const exact = exactRules.find((rule) => rule.method === method && rule.path === path);
  if (exact) {
    return {
      ...exact,
      resourceId: exact.getResourceId?.({ body: ctx.body, query: ctx.query }) || null,
    };
  }

  for (const rule of patternRules) {
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
