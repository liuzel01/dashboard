-- Per-binding JumpServer asset authorization expiry and durable auto-revocation state.
SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='expires_at');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `expires_at` DATETIME(3) NULL AFTER `enabled`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='revocation_status');
SET @ddl = IF(@has_column=0,"ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `revocation_status` ENUM('ACTIVE','PENDING','REVOKED','FAILED') NOT NULL DEFAULT 'ACTIVE' AFTER `expires_at`",'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='revoked_at');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `revoked_at` DATETIME(3) NULL AFTER `revocation_status`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='revocation_attempts');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `revocation_attempts` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `revoked_at`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='next_retry_at');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `next_retry_at` DATETIME(3) NULL AFTER `revocation_attempts`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND COLUMN_NAME='last_revoke_error');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD COLUMN `last_revoke_error` VARCHAR(1000) NULL AFTER `next_retry_at`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_index = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_user_bundle_bindings' AND INDEX_NAME='idx_jumpserver_binding_expiry');
SET @ddl = IF(@has_index=0,'ALTER TABLE `jumpserver_user_bundle_bindings` ADD KEY `idx_jumpserver_binding_expiry` (`provider_key`,`revocation_status`,`expires_at`,`next_retry_at`)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
