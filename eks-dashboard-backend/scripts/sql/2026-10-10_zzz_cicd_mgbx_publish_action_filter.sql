-- MGBX has both legacy `npmpublish` jobs and standard `*-publish` jobs.
-- Keep the operation-type partition complete for either naming convention.
UPDATE `cicd_environment_bindings`
SET `job_action_filter_json` = CASE `action_type`
  WHEN 'BUILD_DEPLOY'
    THEN JSON_OBJECT('excludeAnyTokens', JSON_ARRAY('npmpublish', 'publish'))
  WHEN 'PACKAGE_PUBLISH'
    THEN JSON_OBJECT('includeAnyTokens', JSON_ARRAY('npmpublish', 'publish'))
  ELSE `job_action_filter_json`
END,
`updated_at` = UTC_TIMESTAMP()
WHERE `environment_id` = 'mgbx'
  AND `provider_type` = 'JENKINS'
  AND `action_type` IN ('BUILD_DEPLOY', 'PACKAGE_PUBLISH');

-- Read-only verification: MGBX must recognize both historical and standard
-- publish job naming conventions without changing its discovery scope.
SELECT `environment_id`, `action_type`, `job_name_pattern`, `job_action_filter_json`
FROM `cicd_environment_bindings`
WHERE `environment_id` = 'mgbx'
  AND `provider_type` = 'JENKINS'
ORDER BY `action_type`;
