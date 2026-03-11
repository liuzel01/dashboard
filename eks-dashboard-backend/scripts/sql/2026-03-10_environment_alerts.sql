CREATE TABLE `environment_alerts` (
  `environment_id` varchar(64) NOT NULL,
  `lark_webhook_url` varchar(500) DEFAULT NULL,
  `failure_threshold` int(11) DEFAULT NULL,
  `cooldown_minutes` int(11) DEFAULT NULL,
  `probe_timeout_ms` int(11) DEFAULT NULL,
  `acceptable_status_codes` varchar(255) DEFAULT NULL,
  `lark_sign_secret` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`environment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;