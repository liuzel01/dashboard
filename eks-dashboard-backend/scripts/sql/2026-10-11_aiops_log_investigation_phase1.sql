CREATE TABLE IF NOT EXISTS `aiops_log_query_audit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `project_id` varchar(64) NOT NULL,
  `source_id` varchar(128) NOT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `actor_username` varchar(128) NOT NULL,
  `entity_field` varchar(32) NOT NULL,
  `entity_value_hash` char(64) NOT NULL,
  `namespace` varchar(128) NOT NULL,
  `service_name` varchar(255) DEFAULT NULL,
  `query_hash` char(64) NOT NULL,
  `time_from` datetime DEFAULT NULL,
  `time_to` datetime DEFAULT NULL,
  `result_count` int unsigned NOT NULL DEFAULT 0,
  `status` varchar(32) NOT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `duration_ms` int unsigned NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aiops_log_audit_env_created` (`environment_id`, `created_at`),
  KEY `idx_aiops_log_audit_actor_created` (`actor_user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `permissions` (`key`, `name`, `created_at`, `updated_at`) VALUES
  ('aiops:log-investigate', 'AI 日志只读调查', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `updated_at`=UTC_TIMESTAMP();

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.`key`='aiops:log-investigate'
WHERE LOWER(r.name)='admin'
ON DUPLICATE KEY UPDATE `role_id`=VALUES(`role_id`);
