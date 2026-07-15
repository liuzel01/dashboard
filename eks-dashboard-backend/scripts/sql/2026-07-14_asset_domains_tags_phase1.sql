ALTER TABLE `asset_domains`
  ADD COLUMN `tags` json DEFAULT NULL AFTER `business`;

ALTER TABLE `asset_domains`
  ADD KEY `idx_asset_domains_env_tenant_status` (`environment`, `tenant`, `status`);
