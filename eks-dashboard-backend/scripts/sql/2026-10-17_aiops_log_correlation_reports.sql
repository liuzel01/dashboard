CREATE TABLE IF NOT EXISTS `aiops_log_correlation_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `actor_username` varchar(128) NOT NULL,
  `job_ids_json` json NOT NULL,
  `report_json` json NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aiops_log_reports_environment` (`environment_id`, `created_at`),
  KEY `idx_aiops_log_reports_actor` (`actor_user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
