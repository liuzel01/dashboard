CREATE TABLE IF NOT EXISTS `aiops_alert_event_queue` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `event_key` varchar(64) NOT NULL,
  `environment_id` varchar(64) NOT NULL,
  `alert_name` varchar(255) NOT NULL,
  `source_status` varchar(32) NOT NULL,
  `payload_json` json NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'PENDING',
  `attempt_count` int(10) unsigned NOT NULL DEFAULT 0,
  `available_at` datetime NOT NULL,
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `investigation_id` bigint(20) unsigned DEFAULT NULL,
  `error_code` varchar(64) DEFAULT NULL,
  `error_summary` varchar(1024) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_aiops_alert_event_key` (`event_key`),
  KEY `idx_aiops_alert_event_queue_work` (`status`, `available_at`, `id`),
  KEY `idx_aiops_alert_event_queue_investigation` (`investigation_id`),
  CONSTRAINT `fk_aiops_alert_event_queue_investigation`
    FOREIGN KEY (`investigation_id`) REFERENCES `aiops_investigations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
