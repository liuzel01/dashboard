export type AuditRuleConfig = {
  method: string;
  path: string;
  action: string;
  actionName: string;
  menuKey?: string;
  targetType?: string;
  getResourceId?: (ctx: { params?: Record<string, unknown>; body?: any; query?: any }) => string | null;
};

export type AuditPatternRuleConfig = AuditRuleConfig & { regex: RegExp };

export const AUDIT_EXACT_RULES: AuditRuleConfig[] = [
  { method: 'POST', path: '/auth/login', action: 'auth.login', actionName: '登录' },
  { method: 'POST', path: '/auth/logout', action: 'auth.logout', actionName: '登出' },
  { method: 'GET', path: '/s3/buckets', action: 's3.listBuckets', actionName: '查询 S3 Bucket', menuKey: 'menu:s3-upload', targetType: 's3_bucket' },
  { method: 'GET', path: '/s3/prefixes', action: 's3.listPrefixes', actionName: '查询 S3 路径', menuKey: 'menu:s3-upload', targetType: 's3_prefix', getResourceId: ({ query }) => [query?.bucket, query?.prefix].filter(Boolean).join(':') || null },
  { method: 'GET', path: '/deployments', action: 'deployments.list', actionName: '查询 EKS 部署', menuKey: 'menu:deployments', targetType: 'deployment' },
  { method: 'GET', path: '/environments/configs', action: 'environments.listConfigs', actionName: '查询环境配置', menuKey: 'menu:environments', targetType: 'environment' },
  { method: 'GET', path: '/lines/inventory', action: 'lines.inventory', actionName: '查询线路库存', menuKey: 'menu:lines', targetType: 'line_inventory', getResourceId: ({ query }) => [query?.tenantId ? `tenant:${query.tenantId}` : null, query?.lineUrl].filter(Boolean).join(':') || null },
  { method: 'POST', path: '/s3/presigned-upload', action: 's3.createPresignedUpload', actionName: '生成 S3 直传链接', menuKey: 'menu:s3-upload', targetType: 's3_object', getResourceId: ({ body }) => [body?.bucket, body?.key].filter(Boolean).join('/') || null },
  { method: 'POST', path: '/s3/upload', action: 's3.upload', actionName: '上传 S3 对象', menuKey: 'menu:s3-upload', targetType: 's3_object', getResourceId: ({ body }) => [body?.bucket, body?.key].filter(Boolean).join('/') || null },
  { method: 'POST', path: '/s3/object-exists', action: 's3.objectExists', actionName: '检查 S3 对象是否存在', menuKey: 'menu:s3-upload', targetType: 's3_object', getResourceId: ({ body }) => [body?.bucket, body?.key].filter(Boolean).join('/') || null },
  { method: 'POST', path: '/users', action: 'users.create', actionName: '创建用户', menuKey: 'menu:access-control', targetType: 'user', getResourceId: ({ body }) => body?.username || null },
  { method: 'GET', path: '/ssl-certificates', action: 'sslCertificates.list', actionName: '查询 SSL 证书列表', menuKey: 'menu:ssl-certificates', targetType: 'ssl_certificate' },
];

export const AUDIT_PATTERN_RULES: AuditPatternRuleConfig[] = [
  { method: 'PATCH', path: '/users/:id', regex: /^\/users\/([^/]+)$/, action: 'users.update', actionName: '修改用户', menuKey: 'menu:access-control', targetType: 'user', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'POST', path: '/users/:id/reset-password', regex: /^\/users\/([^/]+)\/reset-password$/, action: 'users.resetPassword', actionName: '重置用户密码', menuKey: 'menu:access-control', targetType: 'user', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'POST', path: '/roles', regex: /^\/roles$/, action: 'roles.create', actionName: '创建角色', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ body }) => body?.name || null },
  { method: 'PATCH', path: '/roles/:id', regex: /^\/roles\/([^/]+)$/, action: 'roles.update', actionName: '修改角色', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'DELETE', path: '/roles/:id', regex: /^\/roles\/([^/]+)$/, action: 'roles.delete', actionName: '删除角色', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'PUT', path: '/roles/:id/permissions', regex: /^\/roles\/([^/]+)\/permissions$/, action: 'roles.updatePermissions', actionName: '修改角色权限', menuKey: 'menu:access-control', targetType: 'role', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'GET', path: '/ssl-certificates/:id', regex: /^\/ssl-certificates\/([^/]+)$/, action: 'sslCertificates.viewDetail', actionName: '查看证书详情', menuKey: 'menu:ssl-certificates', targetType: 'ssl_certificate', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'POST', path: '/ssl-certificates/:id/export-encrypted', regex: /^\/ssl-certificates\/([^/]+)\/export-encrypted$/, action: 'sslCertificates.exportEncrypted', actionName: '导出加密包', menuKey: 'menu:ssl-certificates', targetType: 'ssl_certificate', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'POST', path: '/ssl-certificates/:id/decrypt-download', regex: /^\/ssl-certificates\/([^/]+)\/decrypt-download$/, action: 'sslCertificates.decryptDownload', actionName: '解密下载', menuKey: 'menu:ssl-certificates', targetType: 'ssl_certificate', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'GET', path: '/ssl-certificates/download/:token', regex: /^\/ssl-certificates\/download\/([^/]+)$/, action: 'sslCertificates.downloadFile', actionName: '下载证书明文文件', menuKey: 'menu:ssl-certificates', targetType: 'ssl_certificate_download', getResourceId: ({ params }) => String(params?.[0] || '') || null },
  { method: 'PUT', path: '/environments/config/:id', regex: /^\/environments\/config\/([^/]+)$/, action: 'environments.updateConfig', actionName: '修改环境配置', menuKey: 'menu:environments', targetType: 'environment', getResourceId: ({ params }) => String(params?.[0] || '') || null },
];

export const AUDIT_GET_PREFIX_ALLOWLIST = [
  '/s3/',
  '/deployments',
  '/environments',
  '/lines',
];

export const AUDIT_EXCLUDED_PREFIXES = [
  '/audit-logs',
  '/auth/keycloak',
];

export const AUDIT_EXCLUDED_PATHS = [
  '/me',
];
