CREATE TABLE IF NOT EXISTS `bytebase_executors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `executor_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `base_url_conf_key` VARCHAR(255) NOT NULL,
  `catalog_email_conf_key` VARCHAR(255) NOT NULL,
  `catalog_key_conf_key` VARCHAR(255) NOT NULL,
  `reader_email_conf_key` VARCHAR(255) NOT NULL,
  `reader_key_conf_key` VARCHAR(255) NOT NULL,
  `submitter_email_conf_key` VARCHAR(255) NOT NULL,
  `submitter_key_conf_key` VARCHAR(255) NOT NULL,
  `deployer_email_conf_key` VARCHAR(255) NOT NULL,
  `deployer_key_conf_key` VARCHAR(255) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_bytebase_executor_key` (`executor_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `bytebase_environment_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `environment_id` VARCHAR(128) NOT NULL,
  `executor_key` VARCHAR(128) NOT NULL,
  `project_filter_json` JSON NULL,
  `capabilities_json` JSON NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_bytebase_environment` (`environment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `bytebase_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` VARCHAR(64) NOT NULL,
  `environment_id` VARCHAR(128) NOT NULL,
  `project_name` VARCHAR(255) NOT NULL,
  `database_name` VARCHAR(512) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `sql_sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `actor_user_id` BIGINT NULL,
  `actor_username` VARCHAR(255) NOT NULL,
  `issue_name` VARCHAR(512) NULL,
  `plan_name` VARCHAR(512) NULL,
  `rollout_name` VARCHAR(512) NULL,
  `last_error` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_bytebase_request_id` (`request_id`),
  KEY `idx_bytebase_requests_actor` (`actor_user_id`,`created_at`),
  KEY `idx_bytebase_requests_env` (`environment_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `bytebase_executors`
(`executor_key`,`display_name`,`base_url_conf_key`,`catalog_email_conf_key`,`catalog_key_conf_key`,`reader_email_conf_key`,`reader_key_conf_key`,`submitter_email_conf_key`,`submitter_key_conf_key`,`deployer_email_conf_key`,`deployer_key_conf_key`,`enabled`)
VALUES
('hashex-bytebase','Hashex Bytebase','bytebase.hashex.base_url','bytebase.hashex.catalog_email','bytebase.hashex.catalog_service_key','bytebase.hashex.reader_email','bytebase.hashex.reader_service_key','bytebase.hashex.submitter_email','bytebase.hashex.submitter_service_key','bytebase.hashex.deployer_email','bytebase.hashex.deployer_service_key',1)
ON DUPLICATE KEY UPDATE `display_name`=VALUES(`display_name`),`updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `bytebase_environment_bindings`
(`environment_id`,`executor_key`,`project_filter_json`,`capabilities_json`,`enabled`)
VALUES ('hashex','hashex-bytebase',NULL,JSON_ARRAY('CATALOG','CHANGE','ROLLOUT'),1)
ON DUPLICATE KEY UPDATE `executor_key`=VALUES(`executor_key`),`capabilities_json`=VALUES(`capabilities_json`),`enabled`=1,`updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('menu:bytebase','数据库访问与变更中心',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase:catalog:read','Bytebase 目录读取',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase:change:submit','Bytebase 变更提交',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase:rollout:execute','Bytebase 发布执行',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase:config:manage','Bytebase 连接诊断',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM `roles` r JOIN `permissions` p
  ON p.`key` IN ('menu:bytebase','bytebase:catalog:read','bytebase:change:submit','bytebase:rollout:execute','bytebase:config:manage')
WHERE LOWER(r.`name`) IN ('admin','管理员');

INSERT INTO `dashboard_site_conf`
(`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('bytebase.hashex.base_url','','string','bytebase','Hashex Bytebase HTTPS 地址',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.catalog_email','','string','bytebase','Hashex Bytebase 项目目录 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.catalog_service_key','','string','bytebase','Hashex Bytebase 项目目录 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.reader_email','','string','bytebase','Hashex Bytebase 只读 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.reader_service_key','','string','bytebase','Hashex Bytebase 只读 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.submitter_email','','string','bytebase','Hashex Bytebase 变更提交 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.submitter_service_key','','string','bytebase','Hashex Bytebase 变更提交 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.deployer_email','','string','bytebase','Hashex Bytebase 发布 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.hashex.deployer_service_key','','string','bytebase','Hashex Bytebase 发布 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`is_sensitive`=VALUES(`is_sensitive`),`updated_at`=UTC_TIMESTAMP();
