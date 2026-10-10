-- One-time repair for the existing hashex Jenkins contract.
-- Execute only after reviewing the current row. The Dashboard UI can perform
-- the same controlled sync later for any already-registered Jenkins Job.

UPDATE `cicd_job_catalog`
SET
  `parameter_schema_json` = '{"version":1,"parameters":[{"name":"GIT_BRANCH","type":"git_branch","required":true,"default":"saas_test","pattern":"^[A-Za-z0-9._/-]{1,128}$"},{"name":"MEEGLE_ID","type":"string","required":false,"default":"","maxLength":128},{"name":"COVERAGE_CALLBACK_ENABLED","type":"boolean","required":false,"default":false}]}',
  `updated_at` = UTC_TIMESTAMP()
WHERE `job_key` = 'hashex-kylin-price-impl'
  AND `environment_id` = 'hashex'
  AND `action_type` = 'BUILD_DEPLOY'
  AND `jenkins_job_full_name` = 'hash-kylin-price-kylin-price-impl';

-- Verify that exactly the intended catalog entry now contains the boolean
-- parameter. Do not expose Jenkins credentials or parameter values here.
SELECT
  `job_key`,
  `environment_id`,
  `action_type`,
  JSON_CONTAINS_PATH(`parameter_schema_json`, 'one', '$.parameters[2]') AS `has_third_parameter`,
  `updated_at`
FROM `cicd_job_catalog`
WHERE `job_key` = 'hashex-kylin-price-impl'
  AND `environment_id` = 'hashex'
  AND `action_type` = 'BUILD_DEPLOY'
  AND `jenkins_job_full_name` = 'hash-kylin-price-kylin-price-impl';
