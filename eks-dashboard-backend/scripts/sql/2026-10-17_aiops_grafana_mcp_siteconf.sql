INSERT INTO `dashboard_site_conf` (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`) VALUES
  ('aiops.logs.environments.icoin.executor', 'mcp', 'string', 'aiops-logs', 'icoin 日志执行器：mcp 或 direct', 0, 1, 'mcp', '{"enum":["mcp","direct"]}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.mcp_url', 'http://127.0.0.1:8102/mcp', 'string', 'aiops-logs', 'icoin Grafana MCP Streamable HTTP 地址', 0, 1, 'http://127.0.0.1:8102/mcp', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.mcp_token_source', 'siteconf', 'string', 'aiops-logs', 'icoin Grafana MCP Token 来源：siteconf 或 ssm', 0, 1, 'siteconf', '{"enum":["siteconf","ssm"]}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.mcp_token', '', 'string', 'aiops-logs', 'icoin Grafana MCP 调用 Bearer Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.mcp_token_parameter', '/dashboard/grafana-mcp/icoin/server-auth-token', 'string', 'aiops-logs', 'icoin Grafana MCP 调用 Token 的 SSM Parameter 名称', 0, 1, '/dashboard/grafana-mcp/icoin/server-auth-token', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.mcp_region', 'ap-southeast-1', 'string', 'aiops-logs', 'icoin Grafana MCP Token 所在 AWS Region', 0, 1, 'ap-southeast-1', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.mcp_fallback_direct', 'true', 'boolean', 'aiops-logs', 'MCP 不可用时是否临时回退 Grafana 直连执行器', 0, 1, 'true', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `description`=VALUES(`description`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `default_value`=VALUES(`default_value`),
  `validation_json`=VALUES(`validation_json`),
  `updated_at`=UTC_TIMESTAMP();
