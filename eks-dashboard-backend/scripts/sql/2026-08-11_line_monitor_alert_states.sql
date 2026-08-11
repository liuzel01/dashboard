-- 多地域线路探针的 Dashboard 告警状态；不保存探测原始数据。
CREATE TABLE IF NOT EXISTS `line_monitor_alert_states` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `line_id` bigint(20) unsigned DEFAULT NULL,
  `line_url` varchar(500) NOT NULL,
  `failure_count` int(11) NOT NULL DEFAULT '0',
  `last_status` varchar(32) DEFAULT NULL,
  `last_checked_at` datetime DEFAULT NULL,
  `last_ok_at` datetime DEFAULT NULL,
  `last_alert_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_line_monitor_env_url` (`environment_id`, `line_url`),
  KEY `idx_line_monitor_env_status` (`environment_id`, `last_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
