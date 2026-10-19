-- Record denied and naturally expired JumpServer portal ticket lifecycle events.
-- Idempotent for environments that already ran the Phase 1-3 migration.

SET @has_column = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'jumpserver_portal_tickets'
     AND COLUMN_NAME = 'expired_event_at'
);

SET @ddl = IF(
  @has_column = 0,
  'ALTER TABLE `jumpserver_portal_tickets` ADD COLUMN `expired_event_at` DATETIME(3) NULL AFTER `consumed_at`',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
