CREATE TABLE IF NOT EXISTS `dependency_health_targets` (
  `target_key` varchar(64) NOT NULL,
  `name` varchar(100) NOT NULL,
  `environment_id` varchar(64) NOT NULL,
  `category` varchar(64) NOT NULL,
  `url` varchar(1000) NOT NULL,
  `probe_module` varchar(32) NOT NULL DEFAULT 'http_2xx',
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`target_key`), KEY `idx_dependency_targets_enabled` (`enabled`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `dependency_health_targets` (`target_key`,`name`,`environment_id`,`category`,`url`,`probe_module`,`sort_order`) VALUES
('dashboard-frontend','Dashboard 前端','global','dashboard','http://10.100.166.109:5173/','http_2xx',10),
('dashboard-backend','Dashboard 后端','global','dashboard','http://10.100.166.109:3000/api/oncall/health','http_2xx',20),
('jenkins-hashex','Hashex Jenkins','hashex','jenkins','http://10.2.0.116:8080/login','http_2xx',30),
('jenkins-hashdev','Hashdev Jenkins','hashdev','jenkins','http://10.2.0.116:8080/login','http_2xx',40),
('jenkins-mgbx','MGBX Jenkins','mgbx','jenkins','http://10.100.174.192:8080/login','http_2xx',50),
('jenkins-icoin','iCoin Jenkins','icoin','jenkins','http://172.31.18.229:8080/login','http_2xx',60),
('jenkins-tb','TB Jenkins','tb','jenkins','http://10.80.160.79:8080/login','http_2xx',70),
('line-inventory','线路探测清单服务','global','probe-service','http://172.31.29.3:3000/api/probes/latest','http_2xx',80),
('wangsu-open-api','网宿 OpenAPI','global','cdn','https://open.chinanetcenter.com','http_reachable',90),
('gitlab-api','GitLab API','hashex','gitlab','https://git.megadevapp.com/api/v4/version','http_reachable',100),
('cliproxy-api','Cliproxy API','global','aiops','http://10.90.0.13:8317/v1/models','http_reachable',110),
('grafana-mgbx','MGBX Grafana','mgbx','observability','https://grafana.pre.mg56.net/api/health','http_reachable',120),
('aliyun-dcdn-api','阿里云 DCDN API','global','cdn','https://dcdn.aliyuncs.com','http_reachable',130),
('aliyun-esa-api','阿里云 ESA API','global','cdn','https://esa.cn-hangzhou.aliyuncs.com','http_reachable',140),
('icoin-spot-publish','iCoin 现货推包系统','icoin','publish','http://52.198.75.133:8005/signin','http_reachable',150)
ON DUPLICATE KEY UPDATE target_key=VALUES(target_key);

CREATE TABLE IF NOT EXISTS `dependency_health_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `target_key` varchar(64) NOT NULL, `layer` varchar(2) NOT NULL,
  `status` varchar(32) NOT NULL, `reason_code` varchar(64) NOT NULL,
  `duration_ms` int DEFAULT NULL, `checked_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`), KEY `idx_dependency_history_target_time` (`target_key`,`checked_at`),
  KEY `idx_dependency_history_time` (`checked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dependency_health_alert_states` (
  `target_key` varchar(64) NOT NULL, `layer` varchar(2) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'OK', `consecutive_failures` int NOT NULL DEFAULT 0,
  `last_reason_code` varchar(64) DEFAULT NULL, `last_changed_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`target_key`,`layer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dependency_health_alert_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `target_key` varchar(64) NOT NULL,
  `layer` varchar(2) NOT NULL, `event_type` varchar(16) NOT NULL,
  `reason_code` varchar(64) NOT NULL, `summary` varchar(500) NOT NULL,
  `created_at` datetime(3) NOT NULL, PRIMARY KEY (`id`),
  KEY `idx_dependency_alert_events_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `dashboard_site_conf` (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('dependency_health.alert_failure_threshold','3','number','dependency-health','L2/L3 连续失败告警阈值',0,1,'3','{"min":1,"max":20}',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('dependency_health.history_retention_days','30','number','dependency-health','外部依赖历史保留天数',0,1,'30','{"min":1,"max":365}',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE description=VALUES(description),default_value=VALUES(default_value),validation_json=VALUES(validation_json),updated_at=UTC_TIMESTAMP();

UPDATE `dashboard_site_conf`
SET `category`='dependency-health-legacy', `description`='旧版外部依赖目录，仅用于数据库迁移前兼容回退', `is_runtime_editable`=0, `updated_at`=UTC_TIMESTAMP()
WHERE `conf_key`='dependency_health.targets_json';
