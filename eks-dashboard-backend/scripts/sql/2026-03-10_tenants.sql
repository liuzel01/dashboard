CREATE TABLE `tenants` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `environment_id` varchar(64) NOT NULL,
  `tenant_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_env_tenant` (`environment_id`,`tenant_id`),
  KEY `idx_env` (`environment_id`),
  CONSTRAINT `fk_tenants_env` FOREIGN KEY (`environment_id`) REFERENCES `environments_meta` (`environment_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4;