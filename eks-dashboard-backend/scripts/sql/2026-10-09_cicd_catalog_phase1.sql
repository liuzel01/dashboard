CREATE TABLE IF NOT EXISTS `cicd_executors` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `executor_key` varchar(128) NOT NULL,
  `provider_type` varchar(32) NOT NULL DEFAULT 'JENKINS',
  `display_name` varchar(128) NOT NULL,
  `base_url_conf_key` varchar(255) NOT NULL,
  `username_conf_key` varchar(255) NOT NULL,
  `token_conf_key` varchar(255) NOT NULL,
  `timeout_conf_key` varchar(255) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `read_only` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cicd_executors_key` (`executor_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `cicd_environment_bindings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `action_type` varchar(32) NOT NULL,
  `provider_type` varchar(32) NOT NULL DEFAULT 'JENKINS',
  `executor_key` varchar(128) DEFAULT NULL,
  `job_name_pattern` varchar(255) DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cicd_binding_environment_action` (`environment_id`, `action_type`),
  KEY `idx_cicd_binding_executor` (`executor_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `cicd_job_catalog` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_key` varchar(160) NOT NULL,
  `environment_id` varchar(64) NOT NULL,
  `action_type` varchar(32) NOT NULL,
  `executor_key` varchar(128) NOT NULL,
  `jenkins_job_full_name` varchar(255) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `service_key` varchar(160) NOT NULL,
  `parameter_schema_json` json NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `requires_approval` tinyint(1) NOT NULL DEFAULT 0,
  `concurrency_policy` varchar(32) NOT NULL DEFAULT 'FORBID_SAME_JOB',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cicd_job_catalog_key` (`job_key`),
  UNIQUE KEY `uk_cicd_job_catalog_env_job` (`environment_id`, `jenkins_job_full_name`),
  KEY `idx_cicd_job_catalog_lookup` (`environment_id`, `action_type`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `cicd_executors` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `cicd_environment_bindings` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `cicd_job_catalog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

INSERT INTO `cicd_executors`
  (`executor_key`, `provider_type`, `display_name`, `base_url_conf_key`, `username_conf_key`, `token_conf_key`, `timeout_conf_key`, `enabled`, `read_only`)
VALUES
  ('hash-jenkins', 'JENKINS', 'Hash Jenkins', 'cicd.executors.hash-jenkins.base_url', 'cicd.executors.hash-jenkins.username', 'cicd.executors.hash-jenkins.api_token', 'cicd.executors.hash-jenkins.timeout_ms', 1, 0),
  ('mgbx-jenkins', 'JENKINS', 'MGBX Jenkins', 'cicd.executors.mgbx-jenkins.base_url', 'cicd.executors.mgbx-jenkins.username', 'cicd.executors.mgbx-jenkins.api_token', 'cicd.executors.mgbx-jenkins.timeout_ms', 1, 0),
  ('icoin-jenkins', 'JENKINS', 'iCoin Jenkins', 'cicd.executors.icoin-jenkins.base_url', 'cicd.executors.icoin-jenkins.username', 'cicd.executors.icoin-jenkins.api_token', 'cicd.executors.icoin-jenkins.timeout_ms', 1, 0)
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
  ('hashex', 'BUILD_DEPLOY', 'JENKINS', 'hash-jenkins', NULL, 1),
  ('hashex', 'PACKAGE_PUBLISH', 'JENKINS', 'hash-jenkins', NULL, 1),
  ('hashdev', 'BUILD_DEPLOY', 'JENKINS', 'hash-jenkins', NULL, 1),
  ('hashdev', 'PACKAGE_PUBLISH', 'JENKINS', 'hash-jenkins', NULL, 1),
  ('mgbx', 'BUILD_DEPLOY', 'JENKINS', 'mgbx-jenkins', NULL, 1),
  ('mgbx', 'PACKAGE_PUBLISH', 'JENKINS', 'mgbx-jenkins', NULL, 1),
  ('icoin', 'BUILD_DEPLOY', 'JENKINS', 'icoin-jenkins', '^(icoin-|icoinweb)', 1),
  ('icoin', 'PACKAGE_PUBLISH', 'JENKINS', 'icoin-jenkins', '^(icoin-|icoinweb)', 1)
ON DUPLICATE KEY UPDATE
  `provider_type` = VALUES(`provider_type`),
  `executor_key` = VALUES(`executor_key`),
  `job_name_pattern` = VALUES(`job_name_pattern`);

INSERT INTO `cicd_job_catalog`
  (`job_key`, `environment_id`, `action_type`, `executor_key`, `jenkins_job_full_name`, `display_name`, `service_key`, `parameter_schema_json`, `enabled`, `requires_approval`, `concurrency_policy`)
VALUES
  ('hashex-kylin-price-impl', 'hashex', 'BUILD_DEPLOY', 'hash-jenkins', 'hash-kylin-price-kylin-price-impl', 'kylin-price-impl', 'kylin-price-kylin-price-impl', '{"version":1,"parameters":[{"name":"GIT_BRANCH","type":"git_branch","required":true,"default":"saas_test","pattern":"^[A-Za-z0-9._/-]{1,128}$"},{"name":"MEEGLE_ID","type":"string","required":false,"default":"","maxLength":128}]}', 1, 0, 'FORBID_SAME_JOB'),
  ('hashex-partner-admin-web', 'hashex', 'BUILD_DEPLOY', 'hash-jenkins', 'hashweb-partner-admin-web-frontend', 'partner-admin-web-frontend', 'partner-admin-web-frontend', '{"version":1,"parameters":[{"name":"BRANCH_NAME","type":"git_branch","required":true,"default":"mega_test","pattern":"^[A-Za-z0-9._/-]{1,128}$"}]}', 1, 0, 'FORBID_SAME_JOB'),
  ('hashex-kylin-common-publish', 'hashex', 'PACKAGE_PUBLISH', 'hash-jenkins', 'hash-kylin-common-publish', 'kylin-common-publish', 'kylin-common', '{"version":1,"parameters":[{"name":"BRANCH_NAME","type":"git_branch","required":true,"default":"saas_test","pattern":"^[A-Za-z0-9._/-]{1,128}$"}]}', 1, 1, 'FORBID_SAME_JOB'),
  ('hashdev-kylin-price-impl', 'hashdev', 'BUILD_DEPLOY', 'hash-jenkins', 'hashdev-kylin-price-kylin-price-impl', 'kylin-price-impl', 'kylin-price-kylin-price-impl', '{"version":1,"parameters":[{"name":"GIT_BRANCH","type":"git_branch","required":true,"default":"saas_dev","pattern":"^[A-Za-z0-9._/-]{1,128}$"}]}', 1, 0, 'FORBID_SAME_JOB'),
  ('hashdev-partner-admin-web', 'hashdev', 'BUILD_DEPLOY', 'hash-jenkins', 'hashdevweb-partner-admin-web-frontend', 'partner-admin-web-frontend', 'partner-admin-web-frontend', '{"version":1,"parameters":[{"name":"BRANCH_NAME","type":"git_branch","required":true,"default":"mega_test","pattern":"^[A-Za-z0-9._/-]{1,128}$"}]}', 1, 0, 'FORBID_SAME_JOB'),
  ('hashdev-kylin-common-publish', 'hashdev', 'PACKAGE_PUBLISH', 'hash-jenkins', 'hashdev-kylin-common-publish', 'kylin-common-publish', 'kylin-common', '{"version":1,"parameters":[{"name":"BRANCH_NAME","type":"git_branch","required":true,"default":"saas_dev","pattern":"^[A-Za-z0-9._/-]{1,128}$"}]}', 1, 1, 'FORBID_SAME_JOB')
ON DUPLICATE KEY UPDATE
  `action_type` = VALUES(`action_type`),
  `executor_key` = VALUES(`executor_key`),
  `jenkins_job_full_name` = VALUES(`jenkins_job_full_name`),
  `display_name` = VALUES(`display_name`),
  `service_key` = VALUES(`service_key`),
  `parameter_schema_json` = VALUES(`parameter_schema_json`),
  `requires_approval` = VALUES(`requires_approval`),
  `concurrency_policy` = VALUES(`concurrency_policy`);

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('cicd.executors.hash-jenkins.base_url', '', 'string', 'cicd', 'CI/CD 执行中心 Hash Jenkins 地址', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.hash-jenkins.username', '', 'string', 'cicd', 'CI/CD 执行中心 Hash Jenkins 机器账号', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.hash-jenkins.api_token', '', 'string', 'cicd', 'CI/CD 执行中心 Hash Jenkins API Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.hash-jenkins.timeout_ms', '15000', 'number', 'cicd', 'Hash Jenkins 只读诊断超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.mgbx-jenkins.base_url', '', 'string', 'cicd', 'CI/CD 执行中心 MGBX Jenkins 地址', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.mgbx-jenkins.username', '', 'string', 'cicd', 'CI/CD 执行中心 MGBX Jenkins 机器账号', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.mgbx-jenkins.api_token', '', 'string', 'cicd', 'CI/CD 执行中心 MGBX Jenkins API Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.mgbx-jenkins.timeout_ms', '15000', 'number', 'cicd', 'MGBX Jenkins 只读诊断超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.icoin-jenkins.base_url', '', 'string', 'cicd', 'CI/CD 执行中心 iCoin Jenkins 地址', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.icoin-jenkins.username', '', 'string', 'cicd', 'CI/CD 执行中心 iCoin Jenkins 机器账号', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.icoin-jenkins.api_token', '', 'string', 'cicd', 'CI/CD 执行中心 iCoin Jenkins API Token', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.executors.icoin-jenkins.timeout_ms', '15000', 'number', 'cicd', 'iCoin Jenkins 只读诊断超时（毫秒）', 0, 1, '15000', '{"min":1000,"max":60000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type` = VALUES(`value_type`),
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `is_sensitive` = VALUES(`is_sensitive`),
  `is_runtime_editable` = VALUES(`is_runtime_editable`),
  `default_value` = VALUES(`default_value`),
  `validation_json` = VALUES(`validation_json`),
  `updated_at` = UTC_TIMESTAMP();

INSERT INTO `permissions` (`key`, `name`, `created_at`, `updated_at`)
VALUES
  ('menu:cicd-runs', 'CI/CD 执行中心', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd-config:manage', 'CI/CD 目录与连接诊断', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `updated_at` = UTC_TIMESTAMP();

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.`key` IN ('menu:cicd-runs', 'cicd-config:manage')
WHERE LOWER(r.name) = 'admin'
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
