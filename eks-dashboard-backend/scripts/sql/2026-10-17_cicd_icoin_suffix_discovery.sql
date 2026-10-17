-- Keep the existing iCoin prefixes and additionally include Jenkins jobs whose
-- names end with "icoin". This intentionally excludes names ending in
-- "icointest" and applies to both Jenkins action bindings.
UPDATE `cicd_environment_bindings`
SET `job_name_pattern` = '^(icoin-.*|icoinweb.*|.*icoin)$',
    `updated_at` = UTC_TIMESTAMP()
WHERE `environment_id` = 'icoin'
  AND `provider_type` = 'JENKINS'
  AND `action_type` IN ('BUILD_DEPLOY', 'PACKAGE_PUBLISH');

SELECT `environment_id`, `action_type`, `job_name_pattern`
FROM `cicd_environment_bindings`
WHERE `environment_id` = 'icoin'
  AND `provider_type` = 'JENKINS'
ORDER BY `action_type`;
