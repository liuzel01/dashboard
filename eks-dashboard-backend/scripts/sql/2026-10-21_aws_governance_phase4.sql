CREATE TABLE IF NOT EXISTS `aws_remediation_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `finding_id` BIGINT UNSIGNED NOT NULL,
  `cloud_account_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` VARCHAR(64) NOT NULL,
  `action_key` VARCHAR(64) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(512) NOT NULL,
  `region` VARCHAR(32) NOT NULL,
  `desired_tags_json` JSON NOT NULL,
  `before_tags_json` JSON NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `rollback_plan` VARCHAR(2000) NOT NULL,
  `maintenance_start` DATETIME(3) NOT NULL,
  `maintenance_end` DATETIME(3) NOT NULL,
  `status` ENUM('PENDING_APPROVAL','APPROVED','EXECUTING','SUCCEEDED','FAILED','ROLLED_BACK','REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  `requested_by_user_id` BIGINT UNSIGNED NOT NULL,
  `approved_by_user_id` BIGINT UNSIGNED NULL,
  `executed_by_user_id` BIGINT UNSIGNED NULL,
  `client_request_id` VARCHAR(128) NOT NULL,
  `approval_request_id` VARCHAR(128) NULL,
  `execution_request_id` VARCHAR(128) NULL,
  `approved_at` DATETIME(3) NULL,
  `executed_at` DATETIME(3) NULL,
  `rolled_back_at` DATETIME(3) NULL,
  `last_error` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aws_remediation_create_request` (`client_request_id`),
  UNIQUE KEY `uk_aws_remediation_approval_request` (`approval_request_id`),
  UNIQUE KEY `uk_aws_remediation_execution_request` (`execution_request_id`),
  KEY `idx_aws_remediation_account_status` (`cloud_account_id`,`status`,`created_at`),
  KEY `idx_aws_remediation_finding` (`finding_id`,`created_at`),
  CONSTRAINT `fk_aws_remediation_finding` FOREIGN KEY (`finding_id`) REFERENCES `aws_findings` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_aws_remediation_account` FOREIGN KEY (`cloud_account_id`) REFERENCES `aws_cloud_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aws_remediation_task_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `event_type` ENUM('CREATED','APPROVED','EXECUTED','FAILED','ROLLED_BACK') NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `summary_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_aws_remediation_event_task` (`task_id`,`created_at`),
  CONSTRAINT `fk_aws_remediation_event_task` FOREIGN KEY (`task_id`) REFERENCES `aws_remediation_tasks` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('aws-governance:remediation:request','AWS 整改任务提交',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:remediation:approve','AWS 整改任务审批',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:remediation:execute','AWS 受控整改执行',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws-governance:remediation:rollback','AWS 受控整改回滚',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` LIKE 'aws-governance:remediation:%'
WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_governance.hashex.human_write_role_arn','arn:aws:iam::290368114919:role/DashboardHashexHumanWriteRole','string','aws_governance','hashex 受控治理标签整改 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_governance.remediation.allowed_tag_keys','["environment","owner"]','json','aws_governance','受控整改允许写入的治理标签键',0,1,'["environment","owner"]',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`updated_at`=UTC_TIMESTAMP();
