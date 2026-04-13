-- MySQL 5.7 compatible (no ADD COLUMN IF NOT EXISTS)
-- Current database
SET @db_name = DATABASE();

-- Add sql_type if missing
SET @has_sql_type = (
  SELECT COUNT(1)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'aiops_sql_audit'
    AND COLUMN_NAME = 'sql_type'
);
SET @ddl_sql_type = IF(
  @has_sql_type = 0,
  'ALTER TABLE `aiops_sql_audit` ADD COLUMN `sql_type` varchar(16) DEFAULT NULL AFTER `row_count`',
  'SELECT 1'
);
PREPARE stmt_sql_type FROM @ddl_sql_type;
EXECUTE stmt_sql_type;
DEALLOCATE PREPARE stmt_sql_type;

-- Add risk_level if missing
SET @has_risk_level = (
  SELECT COUNT(1)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'aiops_sql_audit'
    AND COLUMN_NAME = 'risk_level'
);
SET @ddl_risk_level = IF(
  @has_risk_level = 0,
  'ALTER TABLE `aiops_sql_audit` ADD COLUMN `risk_level` varchar(16) DEFAULT NULL AFTER `sql_type`',
  'SELECT 1'
);
PREPARE stmt_risk_level FROM @ddl_risk_level;
EXECUTE stmt_risk_level;
DEALLOCATE PREPARE stmt_risk_level;

UPDATE `aiops_sql_audit`
SET
  `sql_type` = CASE
    WHEN LOWER(COALESCE(`executed_sql`, `generated_sql`, '')) REGEXP '^(create|alter|drop|truncate|rename|grant|revoke)\\b' THEN 'ddl'
    WHEN LOWER(COALESCE(`executed_sql`, `generated_sql`, '')) REGEXP '^(insert|update|delete|replace|merge)\\b' THEN 'write'
    WHEN LOWER(COALESCE(`executed_sql`, `generated_sql`, '')) REGEXP '^(select|show|explain|with)\\b' THEN 'read'
    ELSE COALESCE(`sql_type`, 'unknown')
  END,
  `risk_level` = CASE
    WHEN LOWER(COALESCE(`executed_sql`, `generated_sql`, '')) REGEXP '^(create|alter|drop|truncate|rename|grant|revoke)\\b' THEN 'critical'
    WHEN LOWER(COALESCE(`executed_sql`, `generated_sql`, '')) REGEXP '^(insert|update|delete|replace|merge)\\b' THEN 'high'
    WHEN LOWER(COALESCE(`executed_sql`, `generated_sql`, '')) REGEXP '^(select|show|explain|with)\\b' THEN 'low'
    ELSE COALESCE(`risk_level`, 'medium')
  END
WHERE `sql_type` IS NULL OR `risk_level` IS NULL;
