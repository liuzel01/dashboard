INSERT INTO `cicd_executors`
  (`executor_key`, `provider_type`, `display_name`, `base_url_conf_key`, `username_conf_key`, `token_conf_key`, `timeout_conf_key`, `enabled`, `read_only`)
VALUES
  ('tb-jenkins', 'JENKINS', 'TB Jenkins', 'cicd.executors.tb-jenkins.base_url', 'cicd.executors.tb-jenkins.username', 'cicd.executors.tb-jenkins.api_token', 'cicd.executors.tb-jenkins.timeout_ms', 1, 0)
ON DUPLICATE KEY UPDATE
  `provider_type` = VALUES(`provider_type`),
  `display_name` = VALUES(`display_name`),
  `base_url_conf_key` = VALUES(`base_url_conf_key`),
  `username_conf_key` = VALUES(`username_conf_key`),
  `token_conf_key` = VALUES(`token_conf_key`),
  `timeout_conf_key` = VALUES(`timeout_conf_key`),
  `read_only` = VALUES(`read_only`);

INSERT INTO `cicd_environment_bindings`
  (`environment_id`, `action_type`, `provider_type`, `executor_key`, `job_name_pattern`, `enabled`)
VALUES
  ('tb', 'BUILD_DEPLOY', 'JENKINS', 'tb-jenkins', NULL, 1),
  ('tb', 'PACKAGE_PUBLISH', 'JENKINS', 'tb-jenkins', NULL, 1)
ON DUPLICATE KEY UPDATE
  `provider_type` = VALUES(`provider_type`),
  `executor_key` = VALUES(`executor_key`),
  `job_name_pattern` = VALUES(`job_name_pattern`);

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('cicd.executors.tb-jenkins.base_url', '', 'string', 'cicd', 'CI/CD 执行中心 TB Jenkins 地址', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.tb-jenkins.username', '', 'string', 'cicd', 'CI/CD 执行中心 TB Jenkins 机器账号', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.tb-jenkins.api_token', '', 'string', 'cicd', 'CI/CD 执行中心 TB Jenkins API Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.tb-jenkins.timeout_ms', '15000', 'number', 'cicd', 'TB Jenkins 请求超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type` = VALUES(`value_type`),
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `is_sensitive` = VALUES(`is_sensitive`),
  `is_runtime_editable` = VALUES(`is_runtime_editable`),
  `default_value` = VALUES(`default_value`),
  `validation_json` = VALUES(`validation_json`),
  `updated_at` = UTC_TIMESTAMP();

DELETE FROM `cicd_environment_bindings`
WHERE `environment_id` = 'vlink' AND `executor_key` = 'vlink-jenkins';

DELETE FROM `cicd_executors`
WHERE `executor_key` = 'vlink-jenkins';

DELETE FROM `dashboard_site_conf`
WHERE `conf_key` LIKE 'cicd.executors.vlink-jenkins.%';
