CREATE TABLE `tenant_sources` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `tenant_id` int(11) NOT NULL,
  `source_url` varchar(1024) NOT NULL,
  `source_type` varchar(32) NOT NULL DEFAULT 's3',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_env_tenant_source` (`environment_id`,`tenant_id`,`source_url`(191)),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_env` (`environment_id`),
  CONSTRAINT `fk_tenant_sources_tenants` FOREIGN KEY (`environment_id`, `tenant_id`) REFERENCES `tenants` (`environment_id`, `tenant_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4;