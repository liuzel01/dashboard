CREATE TABLE IF NOT EXISTS `aws_detection_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rule_key` VARCHAR(128) NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `severity` ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `resource_types_json` JSON NOT NULL,
  `condition_json` JSON NOT NULL,
  `remediation_hint` TEXT NULL,
  `checksum` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_detection_rule_version` (`rule_key`,`version`),
  KEY `idx_aws_detection_rule_enabled` (`enabled`,`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_detection_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inventory_run_id` BIGINT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('RUNNING','SUCCEEDED','FAILED') NOT NULL DEFAULT 'RUNNING',
  `rule_version_set_json` JSON NOT NULL,
  `matched_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `opened_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `reopened_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `resolved_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_json` JSON NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_detection_run_inventory` (`inventory_run_id`),
  KEY `idx_aws_detection_run_account_started` (`cloud_account_id`,`started_at`),
  CONSTRAINT `fk_aws_detection_run_inventory` FOREIGN KEY (`inventory_run_id`) REFERENCES `aws_inventory_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_detection_run_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_findings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `fingerprint` CHAR(64) NOT NULL,
  `rule_key` VARCHAR(128) NOT NULL,
  `rule_version` INT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` VARCHAR(64) NOT NULL,
  `region` VARCHAR(32) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(512) NOT NULL,
  `resource_arn` VARCHAR(1024) NULL,
  `severity` ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
  `status` ENUM('OPEN','ACKNOWLEDGED','REMEDIATING','RESOLVED','FALSE_POSITIVE','ACCEPTED_RISK','REOPENED') NOT NULL DEFAULT 'OPEN',
  `title` VARCHAR(255) NOT NULL,
  `summary` TEXT NOT NULL,
  `evidence_json` JSON NOT NULL,
  `remediation_hint` TEXT NULL,
  `first_seen_at` DATETIME(3) NOT NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `last_detection_run_id` BIGINT UNSIGNED NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `exempt_until` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_finding_fingerprint` (`fingerprint`),
  KEY `idx_aws_finding_account_status` (`cloud_account_id`,`status`,`severity`),
  KEY `idx_aws_finding_resource` (`cloud_account_id`,`resource_type`,`resource_id`(191)),
  KEY `idx_aws_finding_exemption` (`status`,`exempt_until`),
  CONSTRAINT `fk_aws_finding_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aws_finding_detection_run` FOREIGN KEY (`last_detection_run_id`) REFERENCES `aws_detection_runs` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_finding_actions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `finding_id` BIGINT UNSIGNED NOT NULL,
  `action` ENUM('ACKNOWLEDGE','ACCEPT_RISK','RESOLVE','REOPEN','FALSE_POSITIVE','AUTO_RESOLVE','EXEMPTION_EXPIRED') NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `note` VARCHAR(1000) NULL,
  `before_status` VARCHAR(32) NOT NULL,
  `after_status` VARCHAR(32) NOT NULL,
  `client_request_id` VARCHAR(128) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_finding_action_request` (`client_request_id`),
  KEY `idx_aws_finding_action_finding` (`finding_id`,`created_at`),
  CONSTRAINT `fk_aws_finding_action_finding` FOREIGN KEY (`finding_id`) REFERENCES `aws_findings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('aws-governance:finding:read','AWS 风险发现读取',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:finding:manage','AWS 风险发现处置',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` IN (
  'aws-governance:finding:read','aws-governance:finding:manage'
) WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_governance.detection.enabled','true','boolean','aws_governance','Inventory 完成后运行确定性风险检测',0,1,'true',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_governance.detection.acm_expiry_days','30','number','aws_governance','ACM 证书临期阈值（天）',0,1,'30','{"min":1,"max":180}',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `description`=VALUES(`description`),`is_sensitive`=VALUES(`is_sensitive`),
  `validation_json`=VALUES(`validation_json`),`updated_at`=UTC_TIMESTAMP();
