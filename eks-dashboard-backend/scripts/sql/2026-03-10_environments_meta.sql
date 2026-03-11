CREATE TABLE `environments_meta` (
  `environment_id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`environment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;