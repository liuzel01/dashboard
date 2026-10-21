CREATE TABLE IF NOT EXISTS `aws_access_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grantee_user_id` BIGINT UNSIGNED NOT NULL,
  `granted_by_user_id` BIGINT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` VARCHAR(64) NOT NULL,
  `permission_template_key` VARCHAR(64) NOT NULL,
  `target_role_arn` VARCHAR(255) NOT NULL,
  `regions_json` JSON NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `grant_snapshot_json` JSON NOT NULL,
  `grant_hash` CHAR(64) NOT NULL,
  `status` ENUM('ACTIVE','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `valid_until` DATETIME(3) NOT NULL,
  `revoked_by_user_id` BIGINT UNSIGNED NULL,
  `revoked_at` DATETIME(3) NULL,
  `revoke_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_aws_access_grant_user_status` (`grantee_user_id`,`status`,`valid_until`),
  KEY `idx_aws_access_grant_account` (`cloud_account_id`,`status`),
  CONSTRAINT `fk_aws_access_grant_user` FOREIGN KEY (`grantee_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_aws_access_grant_grantor` FOREIGN KEY (`granted_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_aws_access_grant_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_access_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grant_id` BIGINT UNSIGNED NOT NULL,
  `grantee_user_id` BIGINT UNSIGNED NOT NULL,
  `ticket_hash` CHAR(64) NOT NULL,
  `grant_hash` CHAR(64) NOT NULL,
  `delivery_mode` VARCHAR(32) NOT NULL DEFAULT 'AWS_CONSOLE_FEDERATION',
  `role_session_name` VARCHAR(64) NOT NULL,
  `aws_session_arn` VARCHAR(255) NULL,
  `cloudtrail_correlation_json` JSON NULL,
  `status` ENUM('PREPARED','CONSUMED','DENIED','EXPIRED','CLOSED') NOT NULL DEFAULT 'PREPARED',
  `prepared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `consumed_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `closed_at` DATETIME(3) NULL,
  `failure_code` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_access_session_ticket` (`ticket_hash`),
  KEY `idx_aws_access_session_grant` (`grant_id`,`prepared_at`),
  KEY `idx_aws_access_session_expiry` (`status`,`expires_at`),
  CONSTRAINT `fk_aws_access_session_grant` FOREIGN KEY (`grant_id`) REFERENCES `aws_access_grants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_access_session_user` FOREIGN KEY (`grantee_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_access_audit_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grant_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `payload_json` JSON NOT NULL,
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `dispatched_at` DATETIME(3) NULL,
  `last_error` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_aws_access_outbox_pending` (`dispatched_at`,`available_at`),
  CONSTRAINT `fk_aws_access_outbox_grant` FOREIGN KEY (`grant_id`) REFERENCES `aws_access_grants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_access_grant_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grant_id` BIGINT UNSIGNED NOT NULL,
  `event_type` ENUM('GRANTED','REVOKED','EXPIRED','SESSION_PREPARED','SESSION_CONSUMED','SESSION_DENIED','SESSION_EXPIRED') NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `summary_json` JSON NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_aws_access_event_grant` (`grant_id`,`occurred_at`),
  CONSTRAINT `fk_aws_access_event_grant` FOREIGN KEY (`grant_id`) REFERENCES `aws_access_grants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('menu:aws-access','AWS 临时访问',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-access:grant:read-own','AWS 临时授权本人读取',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-access:grant:read-all','AWS 临时授权全局读取',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-access:grant:manage','AWS 临时授权管理',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-access:session:start','AWS 临时会话启动',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-access:session:revoke','AWS 临时会话回收',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-access:audit:read','AWS 临时访问审计读取',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` LIKE 'aws-access:%' OR p.`key`='menu:aws-access'
WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.hashex.enabled','true','boolean','aws_access','启用 hashex AWS 临时访问',0,1,'false',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.broker_role_arn','arn:aws:iam::290368114919:role/DashboardHashexCredentialBrokerRole','string','aws_access','hashex Credential Broker Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.human_read_role_arn','arn:aws:iam::290368114919:role/DashboardHashexHumanReadRole','string','aws_access','hashex Human Read Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.session_max_minutes','60','number','aws_access','AWS 临时会话最长时长（分钟）',0,1,'60','{"min":15,"max":60}',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.ticket_ttl_seconds','120','number','aws_access','一次性会话 ticket 有效期（秒）',0,1,'120','{"min":30,"max":300}',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`validation_json`=VALUES(`validation_json`),`updated_at`=UTC_TIMESTAMP();
