CREATE TABLE `site_monitor_checks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `site_id` bigint(20) unsigned NOT NULL,
  `checked_at` datetime NOT NULL,
  `dns_ok` tinyint(1) DEFAULT NULL,
  `resolved_ips` text,
  `tcp_latency_ms` int(11) DEFAULT NULL,
  `http_status` int(11) DEFAULT NULL,
  `ssl_valid` tinyint(1) DEFAULT NULL,
  `ssl_issuer` varchar(255) DEFAULT NULL,
  `ssl_subject` varchar(255) DEFAULT NULL,
  `ssl_not_before` datetime DEFAULT NULL,
  `ssl_not_after` datetime DEFAULT NULL,
  `error` text,
  PRIMARY KEY (`id`),
  KEY `idx_site_time` (`site_id`,`checked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;