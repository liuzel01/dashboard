CREATE TABLE IF NOT EXISTS `aiops_log_investigation_cases` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `actor_username` varchar(128) NOT NULL,
  `actor_json` json NOT NULL,
  `seed_job_ids_json` json NOT NULL,
  `child_job_ids_json` json NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'WAITING',
  `final_report_id` bigint unsigned DEFAULT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aiops_log_cases_queue` (`status`, `updated_at`, `id`),
  KEY `idx_aiops_log_cases_environment` (`environment_id`, `created_at`),
  KEY `idx_aiops_log_cases_actor` (`actor_user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
