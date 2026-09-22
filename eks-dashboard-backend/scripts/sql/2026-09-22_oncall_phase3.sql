CREATE TABLE IF NOT EXISTS `oncall_escalation_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_id` BIGINT UNSIGNED NOT NULL,
  `level` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `idempotency_key` VARCHAR(256) NOT NULL,
  `scheduled_at` DATETIME NOT NULL,
  `executed_at` DATETIME DEFAULT NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_message` VARCHAR(1000) DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_oncall_escalation_idempotency` (`idempotency_key`),
  KEY `idx_oncall_escalation_pending` (`status`, `scheduled_at`),
  KEY `idx_oncall_escalation_alert` (`alert_id`, `id`),
  CONSTRAINT `fk_oncall_escalation_alert` FOREIGN KEY (`alert_id`) REFERENCES `oncall_alerts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `oncall_identity_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `environment_id` VARCHAR(64) NOT NULL,
  `level` VARCHAR(32) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `lark_open_id` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) DEFAULT NULL,
  `active_from` DATETIME DEFAULT NULL,
  `active_until` DATETIME DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_oncall_identity_binding` (`environment_id`, `level`, `email`),
  KEY `idx_oncall_identity_active` (`environment_id`, `level`, `enabled`, `active_from`, `active_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
