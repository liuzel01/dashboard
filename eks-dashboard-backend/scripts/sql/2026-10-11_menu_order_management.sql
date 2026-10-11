CREATE TABLE IF NOT EXISTS `dashboard_menu_order` (
  `scope` VARCHAR(32) NOT NULL,
  `order_json` JSON NOT NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`scope`),
  KEY `idx_dashboard_menu_order_updated_at` (`updated_at`)
);

INSERT INTO `permissions` (`key`, `name`, `created_at`, `updated_at`)
VALUES ('menu:menu-management', '菜单排序管理', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `updated_at` = UTC_TIMESTAMP();

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`key` = 'menu:menu-management'
WHERE LOWER(r.`name`) IN ('admin', '管理员')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
