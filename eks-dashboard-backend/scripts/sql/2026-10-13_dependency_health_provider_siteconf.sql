INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('aiops.cliproxy.base_url', '', 'string', 'aiops', 'AI Ops cliproxy OpenAI-compatible API Base URL', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.cliproxy.api_key', '', 'string', 'aiops', 'AI Ops cliproxy 专用 API Key', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.cliproxy.model', 'gpt-5.6-terra', 'string', 'aiops', 'AI Ops cliproxy 受控模型', 0, 1, 'gpt-5.6-terra', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.cliproxy.timeout_ms', '20000', 'number', 'aiops', 'cliproxy chat/completions 请求超时（毫秒）', 0, 1, '20000', '{"min":1000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.enabled', 'false', 'boolean', 'aiops-logs', '是否启用 mgbx 只读日志调查', 0, 1, 'false', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.project_id', 'mgbx', 'string', 'aiops-logs', 'mgbx 日志调查试点项目 ID', 0, 1, 'mgbx', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.source_id', 'mgbx-loki-main', 'string', 'aiops-logs', 'mgbx Loki 逻辑数据源 ID', 0, 1, 'mgbx-loki-main', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.grafana_base_url', '', 'string', 'aiops-logs', 'mgbx Grafana 地址（仅后端使用）', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.grafana_service_account', 'dashboard-aiops-mgbx', 'string', 'aiops-logs', 'Dashboard 专用 mgbx Grafana Service Account 名称（仅核对）', 0, 1, 'dashboard-aiops-mgbx', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.grafana_token', '', 'string', 'aiops-logs', 'Dashboard 专用 mgbx Grafana Service Account Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.datasource_uid', '', 'string', 'aiops-logs', 'mgbx Loki datasource UID', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.allowed_namespaces', 'default', 'string', 'aiops-logs', 'mgbx 日志调查允许的 namespace，逗号分隔', 0, 1, 'default', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.allowed_services', '', 'string', 'aiops-logs', 'mgbx 日志调查允许的 service_name，逗号分隔；留空表示仅受 namespace 约束', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.max_range_hours', '24', 'number', 'aiops-logs', 'mgbx 单次日志调查最大时间范围（小时）', 0, 1, '24', '{"min":1,"max":168}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.max_lines', '200', 'number', 'aiops-logs', 'mgbx 单次日志调查最大返回行数', 0, 1, '200', '{"min":1,"max":1000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.mgbx.timeout_ms', '15000', 'number', 'aiops-logs', 'mgbx Grafana/Loki 查询超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `default_value`=VALUES(`default_value`),
  `validation_json`=VALUES(`validation_json`),
  `updated_at`=UTC_TIMESTAMP();
