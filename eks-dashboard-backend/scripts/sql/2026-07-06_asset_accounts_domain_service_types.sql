ALTER TABLE `asset_accounts`
  ADD COLUMN `domain_service_types` json DEFAULT NULL AFTER `domain_service_type`;

UPDATE `asset_accounts`
SET `domain_service_types` = JSON_ARRAY(`domain_service_type`)
WHERE `domain_service_type` IS NOT NULL
  AND `domain_service_type` <> ''
  AND (`domain_service_types` IS NULL OR JSON_LENGTH(`domain_service_types`) = 0);
