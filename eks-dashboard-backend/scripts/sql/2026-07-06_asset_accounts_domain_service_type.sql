ALTER TABLE `asset_accounts`
  ADD COLUMN `domain_service_type` varchar(32) NOT NULL DEFAULT 'unknown' AFTER `provider`;

ALTER TABLE `asset_accounts`
  ADD KEY `idx_asset_accounts_domain_service_type` (`domain_service_type`);
