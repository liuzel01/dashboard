CREATE TABLE IF NOT EXISTS `aws_cloud_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `environment_id` VARCHAR(64) NOT NULL,
  `account_id` CHAR(12) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL,
  `partition_name` VARCHAR(32) NOT NULL DEFAULT 'aws',
  `default_regions_json` JSON NOT NULL,
  `platform_audit_role_arn` VARCHAR(255) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_cloud_account_environment_account` (`environment_id`, `account_id`),
  KEY `idx_aws_cloud_account_enabled` (`enabled`, `environment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_cloud_account_role_scopes` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `created_by_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`role_id`, `cloud_account_id`),
  CONSTRAINT `fk_aws_account_scope_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_account_scope_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_inventory_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `mode` ENUM('MANUAL','SCHEDULED') NOT NULL,
  `status` ENUM('PENDING','RUNNING','SUCCEEDED','PARTIAL','FAILED') NOT NULL DEFAULT 'PENDING',
  `regions_json` JSON NOT NULL,
  `collector_version` VARCHAR(64) NOT NULL,
  `requested_by_user_id` BIGINT UNSIGNED NULL,
  `resource_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `change_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `errors_json` JSON NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_aws_inventory_runs_account_created` (`cloud_account_id`, `created_at`),
  KEY `idx_aws_inventory_runs_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_aws_inventory_run_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_resource_current` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `region` VARCHAR(32) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(512) NOT NULL,
  `resource_arn` VARCHAR(1024) NULL,
  `display_name` VARCHAR(255) NULL,
  `status` VARCHAR(64) NULL,
  `normalized_json` JSON NOT NULL,
  `normalized_hash` CHAR(64) NOT NULL,
  `first_seen_at` DATETIME(3) NOT NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `last_run_id` BIGINT UNSIGNED NOT NULL,
  `missing_successful_runs` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_resource_identity` (`cloud_account_id`, `region`, `resource_type`, `resource_id`(191)),
  KEY `idx_aws_resource_filter` (`cloud_account_id`, `resource_type`, `region`, `deleted_at`),
  KEY `idx_aws_resource_last_seen` (`cloud_account_id`, `last_seen_at`),
  CONSTRAINT `fk_aws_resource_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_resource_run` FOREIGN KEY (`last_run_id`) REFERENCES `aws_inventory_runs` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_resource_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `region` VARCHAR(32) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(512) NOT NULL,
  `normalized_json` JSON NOT NULL,
  `normalized_hash` CHAR(64) NOT NULL,
  `collected_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_snapshot_run_resource` (`run_id`, `region`, `resource_type`, `resource_id`(191)),
  KEY `idx_aws_snapshot_account_collected` (`cloud_account_id`, `collected_at`),
  CONSTRAINT `fk_aws_snapshot_run` FOREIGN KEY (`run_id`) REFERENCES `aws_inventory_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_snapshot_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_resource_changes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `region` VARCHAR(32) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(512) NOT NULL,
  `change_type` ENUM('CREATED','UPDATED','DELETED') NOT NULL,
  `before_hash` CHAR(64) NULL,
  `after_hash` CHAR(64) NULL,
  `summary_json` JSON NOT NULL,
  `detected_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aws_changes_account_detected` (`cloud_account_id`, `detected_at`),
  KEY `idx_aws_changes_run` (`run_id`, `id`),
  CONSTRAINT `fk_aws_change_run` FOREIGN KEY (`run_id`) REFERENCES `aws_inventory_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_change_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `aws_cloud_accounts`
  (`environment_id`,`account_id`,`display_name`,`partition_name`,`default_regions_json`,`platform_audit_role_arn`,`enabled`)
VALUES
  ('hashex','290368114919','Hashex AWS','aws',JSON_ARRAY('ap-east-1'),'arn:aws:iam::290368114919:role/DashboardHashexPlatformAuditRole',1)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `default_regions_json`=VALUES(`default_regions_json`),
  `platform_audit_role_arn`=VALUES(`platform_audit_role_arn`),
  `enabled`=VALUES(`enabled`),
  `updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('menu:aws-governance','AWS 云资源治理',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:catalog:read','AWS 资源目录读取',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:inventory:run','AWS Inventory 手动同步',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:change:read','AWS 资源变更读取',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:config:manage','AWS 云账号配置管理',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.`key` IN (
  'menu:aws-governance',
  'aws-governance:catalog:read',
  'aws-governance:inventory:run',
  'aws-governance:change:read',
  'aws-governance:config:manage'
)
WHERE LOWER(r.name)='admin';

INSERT IGNORE INTO `aws_cloud_account_role_scopes` (`role_id`,`cloud_account_id`,`created_by_user_id`)
SELECT r.id,a.id,NULL
FROM roles r
JOIN aws_cloud_accounts a ON a.environment_id='hashex' AND a.account_id='290368114919'
WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_governance.inventory.enabled','false','boolean','aws_governance','AWS Inventory 定时同步开关',0,1,'false',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_governance.inventory.interval_minutes','360','number','aws_governance','AWS Inventory 定时同步间隔（分钟）',0,1,'360','{"min":60,"max":1440}',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_governance.inventory.retention_days','90','number','aws_governance','AWS Inventory 快照保留天数',0,1,'90','{"min":7,"max":365}',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `validation_json`=VALUES(`validation_json`),
  `updated_at`=UTC_TIMESTAMP();
