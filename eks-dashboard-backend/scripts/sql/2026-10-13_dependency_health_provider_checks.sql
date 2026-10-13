CREATE TABLE IF NOT EXISTS `dependency_health_provider_results` (
  `target_key` varchar(64) NOT NULL,
  `layer` varchar(2) NOT NULL,
  `status` varchar(32) NOT NULL,
  `reason_code` varchar(64) NOT NULL,
  `summary` varchar(500) NOT NULL,
  `duration_ms` int DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  `checked_at` datetime(3) NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`target_key`, `layer`),
  KEY `idx_dependency_provider_checked_at` (`checked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('dependency_health.provider_checks_enabled', 'true', 'boolean', 'dependency-health', '是否启用外部依赖 L2/L3 后台只读检查', 0, 1, 'true', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('dependency_health.l2_interval_ms', '300000', 'number', 'dependency-health', 'L2 专用身份认证检查间隔（毫秒）', 0, 1, '300000', '{"min":60000,"max":3600000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('dependency_health.l3_interval_ms', '900000', 'number', 'dependency-health', 'L3 无副作用业务检查间隔（毫秒）', 0, 1, '900000', '{"min":60000,"max":7200000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type` = VALUES(`value_type`),
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `is_sensitive` = VALUES(`is_sensitive`),
  `is_runtime_editable` = VALUES(`is_runtime_editable`),
  `default_value` = VALUES(`default_value`),
  `validation_json` = VALUES(`validation_json`),
  `updated_at` = UTC_TIMESTAMP();
