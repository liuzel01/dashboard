INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('aiops.logs.environments.icoin.enabled', 'false', 'boolean', 'aiops-logs', '是否启用 icoin 只读日志调查', 0, 1, 'false', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.project_id', 'icoin', 'string', 'aiops-logs', 'icoin 日志调查项目 ID', 0, 1, 'icoin', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.source_id', 'icoin-loki-main', 'string', 'aiops-logs', 'icoin Loki 逻辑数据源 ID', 0, 1, 'icoin-loki-main', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.grafana_base_url', '', 'string', 'aiops-logs', 'icoin Grafana 地址（仅后端使用）', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.grafana_service_account', 'dashboard-aiops-icoin', 'string', 'aiops-logs', 'Dashboard 专用 icoin Grafana Service Account 名称（仅核对）', 0, 1, 'dashboard-aiops-icoin', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.grafana_token', '', 'string', 'aiops-logs', 'Dashboard 专用 icoin Grafana Service Account Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.datasource_uid', '', 'string', 'aiops-logs', 'icoin Loki datasource UID', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.allowed_namespaces', 'default', 'string', 'aiops-logs', 'icoin 日志调查允许的 namespace，逗号分隔', 0, 1, 'default', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.allowed_services', '', 'string', 'aiops-logs', 'icoin 日志调查允许的 service_name，逗号分隔；留空表示仅受 namespace 约束', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.max_range_hours', '24', 'number', 'aiops-logs', 'icoin 单次日志调查最大时间范围（小时）', 0, 1, '24', '{"min":1,"max":168}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.max_lines', '200', 'number', 'aiops-logs', 'icoin 单次日志调查最大返回行数', 0, 1, '200', '{"min":1,"max":1000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.timeout_ms', '15000', 'number', 'aiops-logs', 'icoin Grafana/Loki 查询超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `default_value`=VALUES(`default_value`),
  `validation_json`=VALUES(`validation_json`),
  `updated_at`=UTC_TIMESTAMP();
