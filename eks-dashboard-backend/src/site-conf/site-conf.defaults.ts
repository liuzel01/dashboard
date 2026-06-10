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
  { key: 'line.inventory_probe.api_url', envKey: 'LINE_INVENTORY_PROBE_API_URL', valueType: 'string', category: 'line', description: '线路总览探测聚合接口地址', defaultValue: '' },
  { key: 'line.availability.window_ms', envKey: 'LINE_AVAILABILITY_WINDOW_MS', valueType: 'number', category: 'line', description: '线路可用性判定时间窗（毫秒）', defaultValue: '120000', validation: { min: 1000 } },
  { key: 'line.availability.cache_ttl_ms', envKey: 'LINE_AVAILABILITY_CACHE_TTL_MS', valueType: 'number', category: 'line', description: '线路探测快照缓存 TTL（毫秒）', defaultValue: '15000', validation: { min: 0 } },
  { key: 'line.availability.http_timeout_ms', envKey: 'LINE_AVAILABILITY_HTTP_TIMEOUT_MS', valueType: 'number', category: 'line', description: '线路探测聚合接口 HTTP 超时（毫秒）', defaultValue: '3000', validation: { min: 1000 } },
  { key: 'line.availability.up_threshold', envKey: 'LINE_AVAILABILITY_UP_THRESHOLD', valueType: 'number', category: 'line', description: '线路可用判定阈值，支持 0~1 或 0~100', defaultValue: '0.8', validation: { min: 0, max: 100 } },
  { key: 'line.provider.cache_ttl_ms', envKey: 'LINE_PROVIDER_CACHE_TTL_MS', valueType: 'number', category: 'line', description: '线路 provider 识别缓存 TTL（毫秒）', defaultValue: '3600000', validation: { min: 0 } },
  { key: 'line.provider.rules_json', envKey: 'LINE_PROVIDER_RULES_JSON', valueType: 'json', category: 'line', description: '线路 provider 规则扩展（JSON 数组）', defaultValue: '[]' },
  { key: 'line.ssl.cache_ttl_ms', envKey: 'LINE_SSL_CACHE_TTL_MS', valueType: 'number', category: 'line', description: '线路证书聚合缓存 TTL（毫秒）', defaultValue: '300000', validation: { min: 0 } },
  { key: 'line.ssl.tls_timeout_ms', envKey: 'LINE_SSL_TLS_TIMEOUT_MS', valueType: 'number', category: 'line', description: 'TLS 证书探测超时（毫秒）', defaultValue: '5000', validation: { min: 1000 } },
  { key: 'line.ssl.resolve_concurrency', envKey: 'LINE_SSL_RESOLVE_CONCURRENCY', valueType: 'number', category: 'line', description: '线路证书并发探测数量', defaultValue: '8', validation: { min: 1, max: 100 } },

  { key: 'aiops.llm.provider', envKey: 'AIOPS_LLM_PROVIDER', valueType: 'string', category: 'aiops', description: 'AI Ops LLM provider（当前仅支持 openclaw）', defaultValue: 'openclaw', validation: { enum: ['openclaw'] } },
  { key: 'aiops.openclaw.base_url', envKey: 'AIOPS_OPENCLAW_BASE_URL', valueType: 'string', category: 'aiops', description: 'AI Ops OpenClaw OpenAI-compatible API Base URL', defaultValue: '' },
  { key: 'aiops.openclaw.model', envKey: 'AIOPS_OPENCLAW_MODEL', valueType: 'string', category: 'aiops', description: 'AI Ops OpenClaw 模型名', defaultValue: 'openclaw/default' },
  { key: 'aiops.openclaw.token', envKey: 'AIOPS_OPENCLAW_TOKEN', valueType: 'string', category: 'aiops', description: 'AI Ops OpenClaw API Token', defaultValue: '', sensitive: true },
  { key: 'aiops.nl2sql.fewshot_cases_path', envKey: 'AIOPS_NL2SQL_FEWSHOT_CASES_PATH', valueType: 'string', category: 'aiops', description: 'NL2SQL few-shot CSV 文件路径；为空时自动探测默认路径', defaultValue: '' },
  { key: 'aiops.openclaw.timeout_ms', envKey: 'AIOPS_OPENCLAW_TIMEOUT_MS', valueType: 'number', category: 'aiops', description: 'OpenClaw chat/completions 请求超时（毫秒）', defaultValue: '20000', validation: { min: 1000 } },
  { key: 'aiops.nl2sql.fewshot_max_cases', envKey: 'AIOPS_NL2SQL_FEWSHOT_MAX_CASES', valueType: 'number', category: 'aiops', description: '每次注入到 NL2SQL 提示词中的 few-shot 样例数量', defaultValue: '6', validation: { min: 0, max: 50 } },
  { key: 'aiops.sql.whitelist_tables', envKey: 'AIOPS_SQL_WHITELIST_TABLES', valueType: 'string', category: 'aiops', description: 'AI Ops SQL 全局兜底表白名单，逗号分隔；环境级 database.aiops 优先', defaultValue: '' },
  { key: 'aiops.sql.whitelist_databases', envKey: 'AIOPS_SQL_WHITELIST_DATABASES', valueType: 'string', category: 'aiops', description: 'AI Ops SQL 全局兜底数据库白名单，逗号分隔；环境级 database.aiops 优先', defaultValue: '' },
  { key: 'aiops.sql.default_limit', envKey: 'AIOPS_SQL_DEFAULT_LIMIT', valueType: 'number', category: 'aiops', description: 'AI Ops SQL 默认 LIMIT', defaultValue: '200', validation: { min: 1 } },
  { key: 'aiops.sql.max_limit', envKey: 'AIOPS_SQL_MAX_LIMIT', valueType: 'number', category: 'aiops', description: 'AI Ops SQL 最大 LIMIT', defaultValue: '1000', validation: { min: 1 } },
  { key: 'aiops.sql.timeout_ms', envKey: 'AIOPS_SQL_TIMEOUT_MS', valueType: 'number', category: 'aiops', description: 'AI Ops SQL 查询超时（毫秒）', defaultValue: '5000', validation: { min: 1000 } },

  { key: 'query_center.agent.k8s_namespace', envKey: 'QUERY_CENTER_AGENT_K8S_NAMESPACE', valueType: 'string', category: 'query-center', description: 'Query Center Agent Kubernetes namespace', defaultValue: 'default' },
  { key: 'query_center.agent.k8s_service', envKey: 'QUERY_CENTER_AGENT_K8S_SERVICE', valueType: 'string', category: 'query-center', description: 'Query Center Agent Kubernetes service name', defaultValue: 'dashboard-db-gateway-agent' },
  { key: 'query_center.agent.k8s_port', envKey: 'QUERY_CENTER_AGENT_K8S_PORT', valueType: 'number', category: 'query-center', description: 'Query Center Agent Kubernetes service port', defaultValue: '8080', validation: { min: 1, max: 65535 } },
  { key: 'query_center.agent.token', envKey: 'QUERY_CENTER_AGENT_TOKEN', valueType: 'string', category: 'query-center', description: 'Query Center Agent Shared Token', defaultValue: '', sensitive: true },
  { key: 'query_center.gateway.enabled', envKey: 'QUERY_CENTER_GATEWAY_ENABLED', valueType: 'boolean', category: 'query-center', description: '查询中心网关是否启用', defaultValue: 'false' },
  { key: 'query_center.gateway.timeout_ms', envKey: 'QUERY_CENTER_GATEWAY_TIMEOUT_MS', valueType: 'number', category: 'query-center', description: '查询中心网关请求超时（毫秒）', defaultValue: '15000', validation: { min: 1000 } },
  { key: 'query_center.gateway.env_allowlist', envKey: 'QUERY_CENTER_GATEWAY_ENV_ALLOWLIST', valueType: 'string', category: 'query-center', description: '允许走网关的环境 ID，逗号分隔；为空表示不限制', defaultValue: '' },
  { key: 'query_center.gateway.env_denylist', envKey: 'QUERY_CENTER_GATEWAY_ENV_DENYLIST', valueType: 'string', category: 'query-center', description: '禁止走网关的环境 ID，逗号分隔', defaultValue: '' },
  { key: 'query_center.gateway.transport', envKey: 'QUERY_CENTER_GATEWAY_TRANSPORT', valueType: 'string', category: 'query-center', description: '查询中心网关传输模式：k8s-proxy 或 direct-url', defaultValue: 'k8s-proxy', validation: { enum: ['k8s-proxy', 'direct-url'] } },

  { key: 'cdn.aliyun.dcdn_endpoint', envKey: 'DCDN_ENDPOINT', valueType: 'string', category: 'cdn', description: '阿里云 DCDN API Endpoint', defaultValue: 'https://dcdn.aliyuncs.com' },
  { key: 'cdn.aliyun.access_key_id', envKey: 'ALIYUN_ACCESS_KEY_ID', valueType: 'string', category: 'cdn', description: '阿里云 RAM AccessKey ID', defaultValue: '', sensitive: true },
  { key: 'cdn.aliyun.access_key_secret', envKey: 'ALIYUN_ACCESS_KEY_SECRET', valueType: 'string', category: 'cdn', description: '阿里云 RAM AccessKey Secret', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.enabled', envKey: 'WANGSU_CDN_ENABLED', valueType: 'boolean', category: 'cdn', description: '是否启用网宿 CDN OpenAPI 集成', defaultValue: 'false' },
  { key: 'cdn.wangsu.endpoint', envKey: 'WANGSU_CDN_ENDPOINT', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI Endpoint', defaultValue: 'https://open.chinanetcenter.com' },
  { key: 'cdn.wangsu.username', envKey: 'WANGSU_CDN_USERNAME', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI 账号名 / username（用于 Basic Auth username）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.api_key', envKey: 'WANGSU_CDN_API_KEY', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI API Key（用于 HMAC-SHA1 Date 签名）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.access_key_id', envKey: 'WANGSU_CDN_ACCESS_KEY_ID', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI AccessKey ID（AKSK 鉴权优先使用）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.access_key_secret', envKey: 'WANGSU_CDN_ACCESS_KEY_SECRET', valueType: 'string', category: 'cdn', description: '网宿 CDN OpenAPI AccessKey Secret（AKSK 鉴权优先使用）', defaultValue: '', sensitive: true },
  { key: 'cdn.wangsu.timeout_ms', envKey: 'WANGSU_CDN_TIMEOUT_MS', valueType: 'number', category: 'cdn', description: '网宿 CDN OpenAPI 请求超时（毫秒）', defaultValue: '15000', validation: { min: 1000 } },

  { key: 'sso.keycloak.issuer', envKey: 'KEYCLOAK_ISSUER', valueType: 'string', category: 'sso', description: 'Keycloak issuer/realm 地址', defaultValue: '' },
  { key: 'sso.keycloak.client_id', envKey: 'KEYCLOAK_CLIENT_ID', valueType: 'string', category: 'sso', description: 'Keycloak Client ID', defaultValue: '' },
  { key: 'sso.keycloak.client_secret', envKey: 'KEYCLOAK_CLIENT_SECRET', valueType: 'string', category: 'sso', description: 'Keycloak Client Secret', defaultValue: '', sensitive: true },
  { key: 'sso.keycloak.redirect_uri', envKey: 'KEYCLOAK_REDIRECT_URI', valueType: 'string', category: 'sso', description: 'Keycloak 后端回调地址', defaultValue: '' },
  { key: 'sso.keycloak.redirect_uris', envKey: 'KEYCLOAK_REDIRECT_URIS', valueType: 'string', category: 'sso', description: 'Keycloak 允许的后端回调地址列表，逗号分隔', defaultValue: '' },
  { key: 'sso.frontend.redirect_uri', envKey: 'SSO_FRONTEND_REDIRECT_URI', valueType: 'string', category: 'sso', description: '登录成功后回到前端页面', defaultValue: 'http://localhost:5173/sso/callback' },
  { key: 'sso.frontend.redirect_uris', envKey: 'SSO_FRONTEND_REDIRECT_URIS', valueType: 'string', category: 'sso', description: '允许的前端回跳地址列表，逗号分隔', defaultValue: '' },
];

export const SITE_CONF_DEFAULTS_BY_KEY = new Map(SITE_CONF_DEFAULTS.map((item) => [item.key, item]));
