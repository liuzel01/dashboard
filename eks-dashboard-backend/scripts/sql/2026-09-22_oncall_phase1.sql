CREATE TABLE IF NOT EXISTS `oncall_alerts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `fingerprint` VARCHAR(256) NOT NULL,
  `upstream_fingerprint` VARCHAR(256) DEFAULT NULL,
  `environment_id` VARCHAR(64) NOT NULL,
  `alert_name` VARCHAR(255) NOT NULL,
  `namespace` VARCHAR(255) DEFAULT NULL,
  `severity` VARCHAR(64) DEFAULT NULL,
  `risk_level` VARCHAR(64) DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL,
  `first_fired_at` DATETIME DEFAULT NULL,
  `last_fired_at` DATETIME DEFAULT NULL,
  `resolved_at` DATETIME DEFAULT NULL,
  `labels_json` JSON NOT NULL,
  `annotations_json` JSON NOT NULL,
  `raw_payload_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_oncall_alerts_fingerprint` (`fingerprint`),
  KEY `idx_oncall_alerts_status_updated` (`status`, `updated_at`),
  KEY `idx_oncall_alerts_env_updated` (`environment_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `oncall_alert_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(32) NOT NULL,
  `source_status` VARCHAR(32) DEFAULT NULL,
  `payload_json` JSON NOT NULL,
  `source_ip` VARCHAR(64) DEFAULT NULL,
  `user_agent` VARCHAR(512) DEFAULT NULL,
  `trace_id` VARCHAR(128) DEFAULT NULL,
  `occurred_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_oncall_alert_events_alert_id` (`alert_id`, `id`),
  CONSTRAINT `fk_oncall_alert_events_alert` FOREIGN KEY (`alert_id`) REFERENCES `oncall_alerts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `oncall_ack_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_id` BIGINT UNSIGNED NOT NULL,
  `actor_user_id` BIGINT DEFAULT NULL,
  `actor_username` VARCHAR(128) DEFAULT NULL,
  `source` VARCHAR(32) NOT NULL,
  `result` VARCHAR(32) NOT NULL,
  `comment` VARCHAR(1000) DEFAULT NULL,
  `acknowledged_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_oncall_ack_records_alert_id` (`alert_id`, `id`),
  CONSTRAINT `fk_oncall_ack_records_alert` FOREIGN KEY (`alert_id`) REFERENCES `oncall_alerts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `oncall_notification_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_id` BIGINT UNSIGNED NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `idempotency_key` VARCHAR(256) NOT NULL,
  `error_message` VARCHAR(1000) DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_oncall_notification_idempotency` (`idempotency_key`),
  KEY `idx_oncall_notification_alert_id` (`alert_id`, `id`),
  CONSTRAINT `fk_oncall_notification_alert` FOREIGN KEY (`alert_id`) REFERENCES `oncall_alerts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`key`, `name`, `created_at`, `updated_at`)
VALUES ('menu:oncall', 'Oncall 告警', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `updated_at` = UTC_TIMESTAMP();

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r JOIN `permissions` p ON p.`key` = 'menu:oncall'
WHERE LOWER(r.`name`) IN ('admin', '管理员')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
