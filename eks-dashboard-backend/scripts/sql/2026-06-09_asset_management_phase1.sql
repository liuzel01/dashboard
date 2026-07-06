CREATE TABLE IF NOT EXISTS `credential_refs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ref_name` varchar(128) NOT NULL,
  `ref_type` varchar(64) NOT NULL DEFAULT 'other',
  `storage_type` varchar(64) NOT NULL DEFAULT 'other',
  `storage_path` varchar(512) DEFAULT NULL,
  `related_account_id` bigint(20) unsigned DEFAULT NULL,
  `visibility_level` varchar(64) DEFAULT NULL,
  `owner` varchar(128) DEFAULT NULL,
  `remark` text,
  `created_by` varchar(64) DEFAULT NULL,
  `updated_by` varchar(64) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_credential_refs_type` (`ref_type`),
  KEY `idx_credential_refs_storage_type` (`storage_type`),
  KEY `idx_credential_refs_related_account` (`related_account_id`),
  KEY `idx_credential_refs_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `asset_accounts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `account_name` varchar(128) NOT NULL,
  `account_type` varchar(64) NOT NULL DEFAULT 'other',
  `provider` varchar(64) DEFAULT NULL,
  `domain_service_type` varchar(32) NOT NULL DEFAULT 'unknown',
  `domain_service_types` json DEFAULT NULL,
  `login_url` varchar(512) DEFAULT NULL,
  `account_identifier` varchar(255) DEFAULT NULL,
  `owner` varchar(128) DEFAULT NULL,
  `department` varchar(128) DEFAULT NULL,
  `usage_scope` text,
  `environment_scope` varchar(255) DEFAULT NULL,
  `credential_ref_id` bigint(20) unsigned DEFAULT NULL,
  `mfa_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(32) NOT NULL DEFAULT 'active',
  `remark` text,
  `created_by` varchar(64) DEFAULT NULL,
  `updated_by` varchar(64) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_accounts_type` (`account_type`),
  KEY `idx_asset_accounts_provider` (`provider`),
  KEY `idx_asset_accounts_domain_service_type` (`domain_service_type`),
  KEY `idx_asset_accounts_status` (`status`),
  KEY `idx_asset_accounts_owner` (`owner`),
  KEY `idx_asset_accounts_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `asset_resources` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `resource_name` varchar(128) NOT NULL,
  `resource_type` varchar(64) NOT NULL DEFAULT 'other',
  `provider` varchar(64) DEFAULT NULL,
  `account_id` bigint(20) unsigned DEFAULT NULL,
  `resource_identifier` varchar(255) DEFAULT NULL,
  `console_url` varchar(512) DEFAULT NULL,
  `environment` varchar(128) DEFAULT NULL,
  `tenant` varchar(128) DEFAULT NULL,
  `business` varchar(128) DEFAULT NULL,
  `usage_desc` text,
  `owner` varchar(128) DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'active',
  `remark` text,
  `created_by` varchar(64) DEFAULT NULL,
  `updated_by` varchar(64) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_resources_type` (`resource_type`),
  KEY `idx_asset_resources_provider` (`provider`),
  KEY `idx_asset_resources_account` (`account_id`),
  KEY `idx_asset_resources_env_tenant` (`environment`, `tenant`),
  KEY `idx_asset_resources_status` (`status`),
  KEY `idx_asset_resources_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `asset_domains` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `domain` varchar(255) NOT NULL,
  `root_domain` varchar(255) DEFAULT NULL,
  `provider` varchar(64) DEFAULT NULL,
  `account_id` bigint(20) unsigned DEFAULT NULL,
  `resource_id` bigint(20) unsigned DEFAULT NULL,
  `icp_status` varchar(32) NOT NULL DEFAULT 'unknown',
  `icp_entity` varchar(255) DEFAULT NULL,
  `dns_provider` varchar(64) DEFAULT NULL,
  `cdn_provider` varchar(64) DEFAULT NULL,
  `environment` varchar(128) DEFAULT NULL,
  `tenant` varchar(128) DEFAULT NULL,
  `business` varchar(128) DEFAULT NULL,
  `usage_desc` text,
  `owner` varchar(128) DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'unknown',
  `remark` text,
  `created_by` varchar(64) DEFAULT NULL,
  `updated_by` varchar(64) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_asset_domains_domain` (`domain`),
  KEY `idx_asset_domains_root` (`root_domain`),
  KEY `idx_asset_domains_account` (`account_id`),
  KEY `idx_asset_domains_resource` (`resource_id`),
  KEY `idx_asset_domains_env_tenant` (`environment`, `tenant`),
  KEY `idx_asset_domains_status` (`status`),
  KEY `idx_asset_domains_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `asset_change_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `asset_type` varchar(64) NOT NULL,
  `asset_id` bigint(20) unsigned DEFAULT NULL,
  `action` varchar(32) NOT NULL,
  `before_data` json DEFAULT NULL,
  `after_data` json DEFAULT NULL,
  `operator` varchar(64) DEFAULT NULL,
  `remark` varchar(512) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_change_logs_asset` (`asset_type`, `asset_id`),
  KEY `idx_asset_change_logs_action` (`action`),
  KEY `idx_asset_change_logs_operator` (`operator`),
  KEY `idx_asset_change_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO permissions (`key`, name, created_at, updated_at)
VALUES ('menu:asset-management', '资产管理', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP();

-- Current Phase 1 scope is admin-only. If the built-in admin role exists,
-- bind the new menu permission to it so the menu appears immediately after
-- applying this migration. Other roles still require manual assignment.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.`key` = 'menu:asset-management'
WHERE r.name = 'admin'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
