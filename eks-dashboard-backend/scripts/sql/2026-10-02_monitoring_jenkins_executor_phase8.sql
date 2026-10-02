ALTER TABLE `monitoring_jenkins_executions`
  ADD COLUMN `executor_key` varchar(128) NOT NULL DEFAULT 'hash-jenkins' AFTER `application_id`,
  ADD COLUMN `job_name` varchar(255) NOT NULL DEFAULT 'platform-bootstrap-hash' AFTER `executor_key`,
  ADD KEY `idx_monitoring_jenkins_executor_build` (`executor_key`, `job_name`, `build_number`);

UPDATE `monitoring_jenkins_executions`
SET `executor_key` = 'hash-jenkins',
    `job_name` = 'platform-bootstrap-hash'
WHERE `executor_key` = '' OR `executor_key` IS NULL OR `job_name` = '' OR `job_name` IS NULL;

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('monitoring.requests.executors.hash-jenkins.enabled', 'false', 'boolean', 'monitoring', '是否启用 hashex 独立 Jenkins 执行器', 0, 1, 'false', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('monitoring.requests.executors.hash-jenkins.base_url', '', 'string', 'monitoring', 'hashex Jenkins 服务地址（仅后端使用）', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('monitoring.requests.executors.hash-jenkins.username', '', 'string', 'monitoring', 'hashex Jenkins API 用户名（仅后端使用）', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('monitoring.requests.executors.hash-jenkins.api_token', '', 'string', 'monitoring', 'hashex Jenkins API Token（仅后端使用）', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('monitoring.requests.executors.hash-jenkins.job_name', 'platform-bootstrap-hash', 'string', 'monitoring', 'hashex 监控资源受控 Jenkins Job', 0, 0, 'platform-bootstrap-hash', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('monitoring.requests.executors.hash-jenkins.timeout_ms', '15000', 'number', 'monitoring', 'Dashboard 调用 hashex Jenkins 的 HTTP 超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type` = VALUES(`value_type`),
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `is_sensitive` = VALUES(`is_sensitive`),
  `is_runtime_editable` = VALUES(`is_runtime_editable`),
  `default_value` = VALUES(`default_value`),
  `validation_json` = VALUES(`validation_json`),
  `updated_at` = UTC_TIMESTAMP();
