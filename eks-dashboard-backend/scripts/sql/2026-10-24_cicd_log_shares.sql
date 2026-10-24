CREATE TABLE IF NOT EXISTS `cicd_log_shares` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `share_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `s3_bucket` VARCHAR(255) NOT NULL,
  `s3_object_key` VARCHAR(1024) NOT NULL,
  `captured_size_bytes` BIGINT UNSIGNED NOT NULL,
  `truncated` TINYINT(1) NOT NULL DEFAULT 0,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cicd_log_share_id` (`share_id`),
  UNIQUE KEY `uk_cicd_log_share_token` (`token_hash`),
  KEY `idx_cicd_log_share_run` (`run_id`,`created_at`),
  KEY `idx_cicd_log_share_expiry` (`expires_at`,`revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('cicd-runs:share-log','分享 Jenkins 构建日志',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=VALUES(`updated_at`);

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key`='cicd-runs:share-log'
WHERE LOWER(r.name) IN ('admin','管理员');

INSERT INTO `dashboard_site_conf`
(`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('cicd.log_share.s3_bucket','mgbx-tfstate-931324892624','string','cicd','CI/CD 日志分享私有 S3 Bucket',0,1,'mgbx-tfstate-931324892624',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('cicd.log_share.s3_prefix','dashboard/cicd-log-shares','string','cicd','CI/CD 日志分享 S3 Prefix',0,1,'dashboard/cicd-log-shares',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('cicd.log_share.s3_region','ap-southeast-1','string','cicd','CI/CD 日志分享 S3 Region',0,1,'ap-southeast-1',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('cicd.log_share.max_bytes','104857600','number','cicd','单份分享日志最大保留字节数，超过后截断',0,1,'104857600','{"min":1048576,"max":524288000}',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('cicd.log_share.default_expiry_hours','24','number','cicd','日志分享默认有效小时数',0,1,'24','{"min":1,"max":168}',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('cicd.log_share.max_expiry_hours','168','number','cicd','日志分享最大有效小时数',0,1,'168','{"min":1,"max":168}',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`default_value`=VALUES(`default_value`),`validation_json`=VALUES(`validation_json`),`updated_at`=VALUES(`updated_at`);

UPDATE `dashboard_site_conf`
SET `conf_value`='104857600',`updated_at`=UTC_TIMESTAMP()
WHERE `conf_key`='cicd.log_share.max_bytes' AND `conf_value`='20971520';
