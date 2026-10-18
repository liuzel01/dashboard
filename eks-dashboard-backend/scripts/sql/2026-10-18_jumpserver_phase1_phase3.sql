CREATE TABLE IF NOT EXISTS `jumpserver_providers` (
  `provider_key` VARCHAR(64) PRIMARY KEY, `display_name` VARCHAR(128) NOT NULL,
  `base_url_conf_key` VARCHAR(255) NOT NULL, `reader_id_conf_key` VARCHAR(255) NOT NULL,
  `reader_secret_conf_key` VARCHAR(255) NOT NULL, `grant_id_conf_key` VARCHAR(255) NOT NULL,
  `grant_secret_conf_key` VARCHAR(255) NOT NULL, `portal_url_conf_key` VARCHAR(255) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_identity_mappings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, `provider_key` VARCHAR(64) NOT NULL,
  `dashboard_user_id` BIGINT UNSIGNED NOT NULL, `remote_user_id` VARCHAR(64) NOT NULL,
  `remote_username` VARCHAR(128) NOT NULL, `status` ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `verified_at` DATETIME(3) NULL, `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_jumpserver_mapping_user` (`provider_key`,`dashboard_user_id`),
  UNIQUE KEY `uk_jumpserver_mapping_remote` (`provider_key`,`remote_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_access_bundles` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, `provider_key` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL, `description` VARCHAR(500) NOT NULL DEFAULT '',
  `accounts_json` JSON NOT NULL, `protocols_json` JSON NOT NULL, `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_jumpserver_bundle_name` (`provider_key`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_bundle_targets` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, `bundle_id` BIGINT NOT NULL,
  `target_type` ENUM('ASSET','NODE') NOT NULL, `remote_id` VARCHAR(64) NOT NULL, `remote_name` VARCHAR(255) NOT NULL,
  UNIQUE KEY `uk_jumpserver_bundle_target` (`bundle_id`,`target_type`,`remote_id`),
  CONSTRAINT `fk_jumpserver_target_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `jumpserver_access_bundles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_role_bindings` (
  `role_id` BIGINT UNSIGNED NOT NULL, `bundle_id` BIGINT NOT NULL, `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`role_id`,`bundle_id`),
  CONSTRAINT `fk_jumpserver_binding_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_jumpserver_binding_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `jumpserver_access_bundles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_grant_states` (
  `provider_key` VARCHAR(64) NOT NULL, `dashboard_user_id` BIGINT UNSIGNED NOT NULL, `bundle_id` BIGINT NOT NULL,
  `remote_permission_id` VARCHAR(64) NULL, `desired_hash` CHAR(64) NOT NULL,
  `status` ENUM('PENDING','SYNCED','FAILED','DRIFTED','REVOKED') NOT NULL,
  `last_error` VARCHAR(1000) NULL, `last_synced_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`provider_key`,`dashboard_user_id`,`bundle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_portal_tickets` (
  `ticket_id` CHAR(36) PRIMARY KEY, `ticket_hash` CHAR(64) NOT NULL UNIQUE,
  `dashboard_user_id` BIGINT UNSIGNED NOT NULL, `session_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL, `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_jumpserver_ticket_expiry` (`dashboard_user_id`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jumpserver_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, `actor_user_id` BIGINT UNSIGNED NOT NULL,
  `target_user_id` BIGINT UNSIGNED NULL, `event_type` VARCHAR(64) NOT NULL, `target_ref` VARCHAR(255) NULL,
  `outcome` VARCHAR(32) NOT NULL, `summary` VARCHAR(1000) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_jumpserver_events_target` (`target_user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `jumpserver_providers` (`provider_key`,`display_name`,`base_url_conf_key`,`reader_id_conf_key`,`reader_secret_conf_key`,`grant_id_conf_key`,`grant_secret_conf_key`,`portal_url_conf_key`,`enabled`) VALUES
('primary','JumpServer','jumpserver.primary.base_url','jumpserver.primary.reader_access_key_id','jumpserver.primary.reader_access_key_secret','jumpserver.primary.grant_access_key_id','jumpserver.primary.grant_access_key_secret','jumpserver.primary.portal_url',1)
ON DUPLICATE KEY UPDATE `display_name`=VALUES(`display_name`),`updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('menu:jumpserver','服务器访问（JumpServer）',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver:portal:launch','JumpServer 受控跳转',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver:config:manage','JumpServer 配置管理',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver:sync:execute','JumpServer 授权同步',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver:audit:read','JumpServer 审计读取',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` IN ('menu:jumpserver','jumpserver:portal:launch','jumpserver:config:manage','jumpserver:sync:execute','jumpserver:audit:read') WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf` (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('jumpserver.primary.base_url','','string','jumpserver','JumpServer HTTPS 地址',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver.primary.portal_url','','string','jumpserver','JumpServer Portal HTTPS 地址',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver.primary.reader_access_key_id','','string','jumpserver','JumpServer Reader Access Key ID',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver.primary.reader_access_key_secret','','string','jumpserver','JumpServer Reader Access Key Secret',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver.primary.grant_access_key_id','','string','jumpserver','JumpServer Grant Manager Access Key ID',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver.primary.grant_access_key_secret','','string','jumpserver','JumpServer Grant Manager Access Key Secret',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver.portal.ticket_ttl_seconds','120','number','jumpserver','JumpServer 单次跳转 Ticket 有效秒数',0,1,'120','{"min":60,"max":300}',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`is_sensitive`=VALUES(`is_sensitive`),`updated_at`=UTC_TIMESTAMP();
