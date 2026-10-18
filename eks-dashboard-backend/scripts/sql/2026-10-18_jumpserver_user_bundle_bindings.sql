-- Decouple Dashboard feature RBAC from JumpServer asset entitlements.
-- Existing role bindings are retained for audit/rollback but are no longer
-- consumed by the synchronization path.
CREATE TABLE IF NOT EXISTS `jumpserver_user_bundle_bindings` (
  `provider_key` VARCHAR(64) NOT NULL DEFAULT 'primary',
  `dashboard_user_id` BIGINT UNSIGNED NOT NULL,
  `bundle_id` BIGINT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`provider_key`,`dashboard_user_id`,`bundle_id`),
  KEY `idx_jumpserver_user_bundle` (`bundle_id`,`dashboard_user_id`),
  CONSTRAINT `fk_jumpserver_user_binding_bundle`
    FOREIGN KEY (`bundle_id`) REFERENCES `jumpserver_access_bundles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Preserve only entitlements that were already materialized successfully.
-- Do not expand every legacy role member into a direct asset grant.
INSERT IGNORE INTO `jumpserver_user_bundle_bindings`
  (`provider_key`,`dashboard_user_id`,`bundle_id`,`enabled`,`created_by`)
SELECT g.provider_key,g.dashboard_user_id,g.bundle_id,1,
       COALESCE(MIN(rb.created_by),g.dashboard_user_id)
  FROM jumpserver_grant_states g
  LEFT JOIN jumpserver_role_bindings rb
    ON rb.bundle_id=g.bundle_id AND rb.enabled=1
 WHERE g.status='SYNCED' AND g.remote_permission_id IS NOT NULL
 GROUP BY g.provider_key,g.dashboard_user_id,g.bundle_id;
