-- Store immutable snapshots when a JumpServer Asset Permission is reused as
-- an authorization template. The source permission itself is never modified.
-- ADD COLUMN IF NOT EXISTS is not portable across supported MySQL versions.
SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_access_bundles' AND COLUMN_NAME='actions_json');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_access_bundles` ADD COLUMN `actions_json` JSON NULL AFTER `protocols_json`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_access_bundles' AND COLUMN_NAME='source_permission_id');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_access_bundles` ADD COLUMN `source_permission_id` VARCHAR(64) NULL AFTER `actions_json`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_access_bundles' AND COLUMN_NAME='source_permission_name');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_access_bundles` ADD COLUMN `source_permission_name` VARCHAR(128) NULL AFTER `source_permission_id`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='jumpserver_access_bundles' AND COLUMN_NAME='source_snapshot_hash');
SET @ddl = IF(@has_column=0,'ALTER TABLE `jumpserver_access_bundles` ADD COLUMN `source_snapshot_hash` CHAR(64) NULL AFTER `source_permission_name`','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `jumpserver_access_bundles`
   SET `actions_json`=JSON_ARRAY('connect')
 WHERE `actions_json` IS NULL;
