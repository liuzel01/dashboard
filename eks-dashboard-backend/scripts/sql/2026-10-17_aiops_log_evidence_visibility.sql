INSERT INTO `dashboard_site_conf` (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`) VALUES
  ('aiops.logs.environments.icoin.redact_enabled', 'false', 'boolean', 'aiops-logs', '是否对 icoin 日志证据中的常见敏感键值执行脱敏', 0, 1, 'false', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.logs.environments.icoin.restrict_labels', 'false', 'boolean', 'aiops-logs', '是否仅保留 icoin 日志证据的常用标签白名单', 0, 1, 'false', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `description`=VALUES(`description`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `default_value`=VALUES(`default_value`),
  `updated_at`=UTC_TIMESTAMP();
