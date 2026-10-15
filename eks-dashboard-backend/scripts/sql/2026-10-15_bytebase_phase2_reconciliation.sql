-- MySQL 5.7 compatible: ADD COLUMN IF NOT EXISTS is unavailable.
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='issue_status');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `issue_status` VARCHAR(32) NULL AFTER `rollout_name`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='approval_status');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `approval_status` VARCHAR(32) NULL AFTER `issue_status`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='rollout_status');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `rollout_status` VARCHAR(32) NULL AFTER `approval_status`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='task_summary_json');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `task_summary_json` JSON NULL AFTER `rollout_status`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='release_confirmed_at');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `release_confirmed_at` DATETIME(3) NULL AFTER `task_summary_json`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='last_reconciled_at');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `last_reconciled_at` DATETIME(3) NULL AFTER `release_confirmed_at`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_column = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bytebase_requests' AND column_name='terminal_at');
SET @ddl = IF(@has_column=0,'ALTER TABLE `bytebase_requests` ADD COLUMN `terminal_at` DATETIME(3) NULL AFTER `last_reconciled_at`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `bytebase_request_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `from_status` VARCHAR(32) NULL,
  `to_status` VARCHAR(32) NULL,
  `summary` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_bytebase_events_request` (`request_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
