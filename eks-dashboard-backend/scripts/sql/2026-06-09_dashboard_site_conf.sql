CREATE TABLE IF NOT EXISTS `dashboard_site_conf` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `conf_key` VARCHAR(128) NOT NULL,
  `conf_value` TEXT NULL,
  `value_type` VARCHAR(32) NOT NULL DEFAULT 'string',
  `category` VARCHAR(64) NULL,
  `description` VARCHAR(512) NULL,
  `is_sensitive` TINYINT(1) NOT NULL DEFAULT 0,
  `is_runtime_editable` TINYINT(1) NOT NULL DEFAULT 1,
  `default_value` TEXT NULL,
  `validation_json` JSON NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dashboard_site_conf_key` (`conf_key`),
  KEY `idx_dashboard_site_conf_category` (`category`)
);

INSERT INTO permissions (`key`, name, created_at, updated_at)
VALUES ('menu:site-conf', 'siteconf 配置', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP();
