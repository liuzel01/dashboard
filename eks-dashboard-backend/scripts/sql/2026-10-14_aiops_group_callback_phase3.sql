CREATE TABLE IF NOT EXISTS `aiops_group_callback_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `investigation_id` bigint unsigned NOT NULL,
  `channel` varchar(32) NOT NULL DEFAULT 'lark-group',
  `status` varchar(32) NOT NULL DEFAULT 'PENDING',
  `idempotency_key` varchar(255) NOT NULL,
  `message_text` text NOT NULL,
  `provider_message_id` varchar(255) DEFAULT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_aiops_group_callback_idempotency` (`idempotency_key`),
  KEY `idx_aiops_group_callback_status` (`status`, `created_at`),
  CONSTRAINT `fk_aiops_group_callback_investigation`
    FOREIGN KEY (`investigation_id`) REFERENCES `aiops_investigations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
