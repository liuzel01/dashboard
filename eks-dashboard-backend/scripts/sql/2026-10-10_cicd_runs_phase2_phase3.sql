CREATE TABLE IF NOT EXISTS `cicd_runs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `run_id` char(36) NOT NULL,
  `client_request_id` char(36) NOT NULL,
  `action_type` varchar(32) NOT NULL,
  `environment_id` varchar(64) NOT NULL,
  `executor_key` varchar(128) NOT NULL,
  `job_name` varchar(255) NOT NULL,
  `parameters_json` json NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'TRIGGERING',
  `queue_id` bigint unsigned DEFAULT NULL,
  `queue_url` varchar(1000) DEFAULT NULL,
  `build_number` bigint unsigned DEFAULT NULL,
  `build_url` varchar(1000) DEFAULT NULL,
  `duration_ms` bigint unsigned DEFAULT NULL,
  `error_summary` varchar(1000) DEFAULT NULL,
  `requested_by_user_id` bigint unsigned NOT NULL,
  `requested_by_username` varchar(128) NOT NULL,
  `cancelled_by_user_id` bigint unsigned DEFAULT NULL,
  `queued_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cicd_runs_run_id` (`run_id`),
  UNIQUE KEY `uk_cicd_runs_client_request_id` (`client_request_id`),
  KEY `idx_cicd_runs_environment_created` (`environment_id`, `created_at`),
  KEY `idx_cicd_runs_active_job` (`environment_id`, `executor_key`, `job_name`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `cicd_run_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `run_id` char(36) NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `message` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cicd_run_events_run` (`run_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `cicd_runs` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE `cicd_run_events` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

UPDATE `cicd_executors`
SET `read_only` = 0, `updated_at` = UTC_TIMESTAMP()
WHERE `executor_key` IN ('hash-jenkins', 'mgbx-jenkins', 'icoin-jenkins');

INSERT INTO `permissions` (`key`, `name`, `created_at`, `updated_at`)
VALUES
  ('cicd-runs:execute-build', '执行 Jenkins 构建部署', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd-runs:execute-publish', '执行 Jenkins 制品推包', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('cicd-runs:cancel', '取消 Jenkins CI/CD 执行', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `updated_at` = UTC_TIMESTAMP();

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.`key` IN (
  'cicd-runs:execute-build',
  'cicd-runs:execute-publish',
  'cicd-runs:cancel'
)
WHERE LOWER(r.name) = 'admin'
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

