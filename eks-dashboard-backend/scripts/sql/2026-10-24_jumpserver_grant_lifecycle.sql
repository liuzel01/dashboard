-- Durable authorization-cycle identity and lineage for expiry changes / reauthorization.
SET @has_id = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='id');
SET @ddl = IF(@has_id=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `id` BIGINT UNSIGNED NULL FIRST','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @next_binding_id = 0;
UPDATE `jumpserver_user_bundle_bindings` SET `id`=(@next_binding_id:=@next_binding_id+1) WHERE `id` IS NULL ORDER BY `created_at`,`dashboard_user_id`,`bundle_id`;

SET @id_is_primary = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND INDEX_NAME='PRIMARY' AND COLUMN_NAME='id');
SET @ddl = IF(@id_is_primary=0,'ALTER TABLE `jumpserver_user_bundle_bindings` DROP PRIMARY KEY, MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`), ADD UNIQUE KEY `uk_jumpserver_binding_cycle` (`provider_key`,`dashboard_user_id`,`bundle_id`)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='reauthorized_from_binding_id');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `reauthorized_from_binding_id` BIGINT UNSIGNED NULL AFTER `bundle_id`, ADD KEY `idx_jumpserver_binding_lineage` (`reauthorized_from_binding_id`)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='expiration_change_reason');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `expiration_change_reason` VARCHAR(500) NULL AFTER `expires_at`, ADD COLUMN `expiration_changed_by` BIGINT UNSIGNED NULL AFTER `expiration_change_reason`, ADD COLUMN `expiration_changed_at` DATETIME(3) NULL AFTER `expiration_changed_by`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('jumpserver:grant:extend','JumpServer 授权有效期调整',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('jumpserver:grant:reauthorize','JumpServer 历史授权重新授权',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=VALUES(`updated_at`);

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` IN ('jumpserver:grant:extend','jumpserver:grant:reauthorize')
WHERE LOWER(r.name) IN ('admin','管理员');
