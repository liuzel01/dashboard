export type SiteConfValueType = 'string' | 'number' | 'boolean' | 'json';

export type SiteConfDefault = {
  key: string;
  envKey?: string;
  valueType: SiteConfValueType;
  category: string;
  description: string;
  defaultValue?: string;
  sensitive?: boolean;
  runtimeEditable?: boolean;
  validation?: Record<string, any>;
};

export const SITE_CONF_DEFAULTS: SiteConfDefault[] = [
  { key: 'line.availability.window_ms', envKey: 'LINE_AVAILABILITY_WINDOW_MS', valueType: 'number', category: 'line', description: '线路可用性判定时间窗（毫秒）', defaultValue: '120000', validation: { min: 1000 } },
  { key: 'line.availability.cache_ttl_ms', envKey: 'LINE_AVAILABILITY_CACHE_TTL_MS', valueType: 'number', category: 'line', description: '线路探测快照缓存 TTL（毫秒）', defaultValue: '15000', validation: { min: 0 } },
  { key: 'line.availability.up_threshold', envKey: 'LINE_AVAILABILITY_UP_THRESHOLD', valueType: 'number', category: 'line', description: '线路可用判定阈值，支持 0~1 或 0~100', defaultValue: '0.8', validation: { min: 0, max: 100 } },
  { key: 'line.provider.cache_ttl_ms', envKey: 'LINE_PROVIDER_CACHE_TTL_MS', valueType: 'number', category: 'line', description: '线路 provider 识别缓存 TTL（毫秒）', defaultValue: '3600000', validation: { min: 0 } },
  { key: 'line.provider.rules_json', envKey: 'LINE_PROVIDER_RULES_JSON', valueType: 'json', category: 'line', description: '线路 provider 规则扩展（JSON 数组）', defaultValue: '[]' },
  { key: 'line.ssl.cache_ttl_ms', envKey: 'LINE_SSL_CACHE_TTL_MS', valueType: 'number', category: 'line', description: '线路证书聚合缓存 TTL（毫秒）', defaultValue: '300000', validation: { min: 0 } },
  { key: 'line.ssl.tls_timeout_ms', envKey: 'LINE_SSL_TLS_TIMEOUT_MS', valueType: 'number', category: 'line', description: 'TLS 证书探测超时（毫秒）', defaultValue: '5000', validation: { min: 1000 } },
  { key: 'line.ssl.resolve_concurrency', envKey: 'LINE_SSL_RESOLVE_CONCURRENCY', valueType: 'number', category: 'line', description: '线路证书并发探测数量', defaultValue: '8', validation: { min: 1, max: 100 } },

  { key: 'aiops.openclaw.timeout_ms', envKey: 'AIOPS_OPENCLAW_TIMEOUT_MS', valueType: 'number', category: 'aiops', description: 'OpenClaw chat/completions 请求超时（毫秒）', defaultValue: '20000', validation: { min: 1000 } },
  { key: 'aiops.nl2sql.fewshot_max_cases', envKey: 'AIOPS_NL2SQL_FEWSHOT_MAX_CASES', valueType: 'number', category: 'aiops', description: '每次注入到 NL2SQL 提示词中的 few-shot 样例数量', defaultValue: '6', validation: { min: 0, max: 50 } },
  { key: 'aiops.sql.default_limit', envKey: 'AIOPS_SQL_DEFAULT_LIMIT', valueType: 'number', category: 'aiops', description: 'AI Ops SQL 默认 LIMIT', defaultValue: '200', validation: { min: 1 } },
  { key: 'aiops.sql.max_limit', envKey: 'AIOPS_SQL_MAX_LIMIT', valueType: 'number', category: 'aiops', description: 'AI Ops SQL 最大 LIMIT', defaultValue: '1000', validation: { min: 1 } },
  { key: 'aiops.sql.timeout_ms', envKey: 'AIOPS_SQL_TIMEOUT_MS', valueType: 'number', category: 'aiops', description: 'AI Ops SQL 查询超时（毫秒）', defaultValue: '5000', validation: { min: 1000 } },

  { key: 'query_center.gateway.enabled', envKey: 'QUERY_CENTER_GATEWAY_ENABLED', valueType: 'boolean', category: 'query-center', description: '查询中心网关是否启用', defaultValue: 'false' },
  { key: 'query_center.gateway.timeout_ms', envKey: 'QUERY_CENTER_GATEWAY_TIMEOUT_MS', valueType: 'number', category: 'query-center', description: '查询中心网关请求超时（毫秒）', defaultValue: '15000', validation: { min: 1000 } },
  { key: 'query_center.gateway.env_allowlist', envKey: 'QUERY_CENTER_GATEWAY_ENV_ALLOWLIST', valueType: 'string', category: 'query-center', description: '允许走网关的环境 ID，逗号分隔；为空表示不限制', defaultValue: '' },
  { key: 'query_center.gateway.env_denylist', envKey: 'QUERY_CENTER_GATEWAY_ENV_DENYLIST', valueType: 'string', category: 'query-center', description: '禁止走网关的环境 ID，逗号分隔', defaultValue: '' },
  { key: 'query_center.gateway.transport', envKey: 'QUERY_CENTER_GATEWAY_TRANSPORT', valueType: 'string', category: 'query-center', description: '查询中心网关传输模式：k8s-proxy 或 direct-url', defaultValue: 'k8s-proxy', validation: { enum: ['k8s-proxy', 'direct-url'] } },

  { key: 'cdn.wangsu.enabled', envKey: 'WANGSU_CDN_ENABLED', valueType: 'boolean', category: 'cdn', description: '是否启用网宿 CDN OpenAPI 集成', defaultValue: 'false' },
  { key: 'cdn.wangsu.endpoint', envKey: 'WANGSU_CDN_ENDPOINT', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI Endpoint', defaultValue: 'https://open.chinanetcenter.com' },
  { key: 'cdn.wangsu.username', envKey: 'WANGSU_CDN_USERNAME', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI 账号名 / username（用于 Basic Auth username）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.api_key', envKey: 'WANGSU_CDN_API_KEY', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI API Key（用于 HMAC-SHA1 Date 签名）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.access_key_id', envKey: 'WANGSU_CDN_ACCESS_KEY_ID', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI AccessKey ID（AKSK 鉴权优先使用）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.access_key_secret', envKey: 'WANGSU_CDN_ACCESS_KEY_SECRET', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI AccessKey Secret（AKSK 鉴权优先使用）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.timeout_ms', envKey: 'WANGSU_CDN_TIMEOUT_MS', valueType: 'number', category: 'cdn', description: '网宿 CDN OpenAPI 请求超时（毫秒）', defaultValue: '15000', validation: { min: 1000 } },

  { key: 'sso.keycloak.issuer', envKey: 'KEYCLOAK_ISSUER', valueType: 'string', category: 'sso', description: 'Keycloak issuer/realm 地址', defaultValue: '' },
  { key: 'sso.keycloak.client_id', envKey: 'KEYCLOAK_CLIENT_ID', valueType: 'string', category: 'sso', description: 'Keycloak Client ID', defaultValue: '' },
  { key: 'sso.keycloak.redirect_uri', envKey: 'KEYCLOAK_REDIRECT_URI', valueType: 'string', category: 'sso', description: 'Keycloak 后端回调地址', defaultValue: '' },
  { key: 'sso.keycloak.redirect_uris', envKey: 'KEYCLOAK_REDIRECT_URIS', valueType: 'string', category: 'sso', description: 'Keycloak 允许的后端回调地址列表，逗号分隔', defaultValue: '' },
  { key: 'sso.frontend.redirect_uri', envKey: 'SSO_FRONTEND_REDIRECT_URI', valueType: 'string', category: 'sso', description: '登录成功后回到前端页面', defaultValue: 'http://localhost:5173/sso/callback' },
  { key: 'sso.frontend.redirect_uris', envKey: 'SSO_FRONTEND_REDIRECT_URIS', valueType: 'string', category: 'sso', description: '允许的前端回跳地址列表，逗号分隔', defaultValue: '' },
];

export const SITE_CONF_DEFAULTS_BY_KEY = new Map(SITE_CONF_DEFAULTS.map((item) => [item.key, item]));
