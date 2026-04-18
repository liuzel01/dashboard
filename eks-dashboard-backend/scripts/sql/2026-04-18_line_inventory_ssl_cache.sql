CREATE TABLE `line_inventory_ssl_cache` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `host` varchar(255) NOT NULL,
  `provider` enum('aliyun_dcdn','aws_global','aliyun_esa','unknown') NOT NULL DEFAULT 'unknown',
  `ssl_expire_at` datetime DEFAULT NULL,
  `ssl_days_left` int(11) DEFAULT NULL,
  `source` enum('dcdn_api','tls_probe','unknown') NOT NULL DEFAULT 'unknown',
  `last_checked_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `last_error` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_env_host` (`environment_id`,`host`),
  KEY `idx_env_expires_at` (`environment_id`,`expires_at`),
  KEY `idx_env_provider` (`environment_id`,`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
