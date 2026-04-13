ALTER TABLE `aiops_sql_audit`
  ADD COLUMN IF NOT EXISTS `sql_type` varchar(16) DEFAULT NULL AFTER `row_count`,
  ADD COLUMN IF NOT EXISTS `risk_level` varchar(16) DEFAULT NULL AFTER `sql_type`;

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
