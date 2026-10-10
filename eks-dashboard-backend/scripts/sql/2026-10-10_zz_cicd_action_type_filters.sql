-- Separate operation-type filtering from the environment discovery range.
-- The ALTER is safe to rerun on installations that already have the column.
SET @schema_name = DATABASE();
SET @add_action_filter_column = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `cicd_environment_bindings` ADD COLUMN `job_action_filter_json` JSON NULL AFTER `job_name_pattern`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'cicd_environment_bindings'
    AND column_name = 'job_action_filter_json'
);
PREPARE add_action_filter_column FROM @add_action_filter_column;
EXECUTE add_action_filter_column;
DEALLOCATE PREPARE add_action_filter_column;

-- Only fill bindings that have not received an explicit filter yet. The
-- existing job_name_pattern remains the environment-level discovery boundary.
UPDATE `cicd_environment_bindings`
SET `job_action_filter_json` = CASE
  WHEN `environment_id` = 'mgbx' AND `action_type` = 'BUILD_DEPLOY'
    THEN JSON_OBJECT('excludeAnyTokens', JSON_ARRAY('npmpublish'))
  WHEN `environment_id` = 'mgbx' AND `action_type` = 'PACKAGE_PUBLISH'
    THEN JSON_OBJECT('includeAnyTokens', JSON_ARRAY('npmpublish'))
  WHEN `action_type` = 'BUILD_DEPLOY'
    THEN JSON_OBJECT('excludeAnyTokens', JSON_ARRAY('publish'))
  WHEN `action_type` = 'PACKAGE_PUBLISH'
    THEN JSON_OBJECT('includeAnyTokens', JSON_ARRAY('publish'))
  ELSE NULL
END,
`updated_at` = UTC_TIMESTAMP()
WHERE `provider_type` = 'JENKINS'
  AND `action_type` IN ('BUILD_DEPLOY', 'PACKAGE_PUBLISH')
  AND `job_action_filter_json` IS NULL;

-- Read-only verification: each Jenkins binding has both its independent
-- environment discovery range and its operation-type filter.
SELECT `environment_id`, `action_type`, `job_name_pattern`, `job_action_filter_json`
FROM `cicd_environment_bindings`
WHERE `provider_type` = 'JENKINS'
ORDER BY `environment_id`, `action_type`;
