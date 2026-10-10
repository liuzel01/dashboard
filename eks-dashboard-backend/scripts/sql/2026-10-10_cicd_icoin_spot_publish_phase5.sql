CREATE TABLE IF NOT EXISTS `cicd_external_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `run_id` char(36) NOT NULL,
  `provider_type` varchar(64) NOT NULL,
  `service_key` varchar(255) NOT NULL,
  `git_ref` varchar(128) NOT NULL,
  `registry` varchar(255) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'QUEUED',
  `lease_owner` char(36) DEFAULT NULL,
  `lease_expires_at` datetime DEFAULT NULL,
  `attempt_count` int unsigned NOT NULL DEFAULT 0,
  `result_tag` varchar(1000) DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cicd_external_tasks_run` (`run_id`),
  KEY `idx_cicd_external_tasks_claim` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `cicd_executors`
  (`executor_key`, `provider_type`, `display_name`, `base_url_conf_key`, `username_conf_key`, `token_conf_key`, `timeout_conf_key`, `enabled`, `read_only`)
VALUES
  ('icoin-spot-publish', 'EXTERNAL_SPOT_PUBLISH', 'iCoin 现货镜像推包', 'cicd.providers.icoin-spot.signin_url', 'cicd.providers.icoin-spot.username', 'cicd.providers.icoin-spot.password', 'cicd.providers.icoin-spot.timeout_ms', 1, 0)
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
  ('icoin', 'IMAGE_BUILD_PUBLISH', 'EXTERNAL_SPOT_PUBLISH', 'icoin-spot-publish', NULL, 1)
ON DUPLICATE KEY UPDATE
  `provider_type` = VALUES(`provider_type`),
  `executor_key` = VALUES(`executor_key`),
  `job_name_pattern` = VALUES(`job_name_pattern`);

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('cicd.providers.icoin-spot.signin_url', '', 'string', 'cicd', 'iCoin 现货推包登录地址', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.providers.icoin-spot.username', '', 'string', 'cicd', 'iCoin 现货推包账号', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.providers.icoin-spot.password', '', 'string', 'cicd', 'iCoin 现货推包密码', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd.providers.icoin-spot.timeout_ms', '7200000', 'number', 'cicd', 'iCoin 现货推包最长等待时间（毫秒）', 0, 1, '7200000', '{"min":60000,"max":7200000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
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
VALUES ('cicd-runs:execute-image-publish', '执行外部镜像构建推包', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `updated_at` = UTC_TIMESTAMP();

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `roles` r JOIN `permissions` p ON p.`key`='cicd-runs:execute-image-publish'
WHERE LOWER(r.name)='admin'
ON DUPLICATE KEY UPDATE `role_id`=VALUES(`role_id`);
