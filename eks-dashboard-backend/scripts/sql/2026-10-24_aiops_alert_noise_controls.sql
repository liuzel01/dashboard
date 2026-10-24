CREATE TABLE IF NOT EXISTS `aiops_alert_suppressions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `investigation_id` bigint unsigned DEFAULT NULL,
  `scope` varchar(32) NOT NULL,
  `matchers_json` json NOT NULL,
  `starts_at` datetime NOT NULL,
  `ends_at` datetime NOT NULL,
  `reason` varchar(500) NOT NULL,
  `hit_count` bigint unsigned NOT NULL DEFAULT 0,
  `last_hit_at` datetime DEFAULT NULL,
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_by_username` varchar(128) NOT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(500) DEFAULT NULL,
  `cancelled_by_user_id` bigint unsigned DEFAULT NULL,
  `cancelled_by_username` varchar(128) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aiops_suppressions_active` (`environment_id`,`cancelled_at`,`starts_at`,`ends_at`),
  KEY `idx_aiops_suppressions_investigation` (`investigation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `aiops_alertmanager_silences` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `investigation_id` bigint unsigned NOT NULL,
  `alertmanager_silence_id` varchar(255) NOT NULL,
  `scope` varchar(32) NOT NULL,
  `matchers_json` json NOT NULL,
  `starts_at` datetime NOT NULL,
  `ends_at` datetime NOT NULL,
  `reason` varchar(500) NOT NULL,
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `created_by_username` varchar(128) NOT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(500) DEFAULT NULL,
  `cancelled_by_user_id` bigint unsigned DEFAULT NULL,
  `cancelled_by_username` varchar(128) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_aiops_alertmanager_silence` (`environment_id`,`alertmanager_silence_id`),
  KEY `idx_aiops_alertmanager_investigation` (`investigation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('aiops:alert:suppress','AI 告警调查暂停',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aiops:alert:silence','Alertmanager 临时静默',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=VALUES(`updated_at`);

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` IN ('aiops:alert:suppress','aiops:alert:silence')
WHERE LOWER(r.name) IN ('admin','管理员');

INSERT INTO `dashboard_site_conf`
(`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('aiops.alertmanager.environments.mgbx.silence_enabled','false','boolean','aiops-alerts','是否允许 Dashboard 向 mgbx Alertmanager 写入临时 Silence',0,1,'false',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aiops.alertmanager.environments.mgbx.base_url','','string','aiops-alerts','mgbx Alertmanager 管理 API 地址（仅由服务端读取）',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aiops.alertmanager.environments.mgbx.bearer_token','','string','aiops-alerts','mgbx Alertmanager 管理 API Bearer Token',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aiops.alertmanager.environments.icoin.silence_enabled','false','boolean','aiops-alerts','是否允许 Dashboard 向 icoin Alertmanager 写入临时 Silence',0,1,'false',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aiops.alertmanager.environments.icoin.base_url','','string','aiops-alerts','icoin Alertmanager 管理 API 地址（仅由服务端读取）',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aiops.alertmanager.environments.icoin.bearer_token','','string','aiops-alerts','icoin Alertmanager 管理 API Bearer Token',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`is_sensitive`=VALUES(`is_sensitive`),`updated_at`=VALUES(`updated_at`);
