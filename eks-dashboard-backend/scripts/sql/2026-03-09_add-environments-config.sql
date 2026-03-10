CREATE TABLE `environments_config` (
  `environment_id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `aws_access_key_id` varchar(128) DEFAULT NULL,
  `aws_secret_access_key` varchar(128) DEFAULT NULL,
  `aws_profile` varchar(128) DEFAULT NULL,
  `aws_region` varchar(64) NOT NULL,
  `kube_context` varchar(128) DEFAULT NULL,
  `database_json` json DEFAULT NULL,
  `redis_json` json DEFAULT NULL,
  `jump_server_json` json DEFAULT NULL,
  `tenants_json` json DEFAULT NULL,
  `platforms_json` json DEFAULT NULL,
  `alerts_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`environment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
