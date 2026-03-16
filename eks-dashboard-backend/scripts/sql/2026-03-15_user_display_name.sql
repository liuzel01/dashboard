SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'display_name'
);

SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE users ADD COLUMN display_name varchar(128) DEFAULT NULL AFTER username',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users
SET display_name = username
WHERE display_name IS NULL OR display_name = '';
