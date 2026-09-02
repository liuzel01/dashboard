-- Phase 4: one-time, short-lived authorization for a reviewed real ServiceMonitor apply.
-- Run once after 2026-09-02_monitoring_requests_phase3.sql.
CREATE TABLE `monitoring_real_apply_authorizations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `request_id` varchar(64) NOT NULL,
  `mr_iid` int unsigned NOT NULL,
  `commit_sha` char(40) NOT NULL,
  `granted_by_user_id` bigint unsigned NOT NULL,
  `comment` varchar(1000) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `consumed_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_monitoring_real_apply_active` (`request_id`,`consumed_at`,`revoked_at`,`expires_at`),
  CONSTRAINT `fk_monitoring_real_apply_request` FOREIGN KEY (`request_id`) REFERENCES `monitoring_requests` (`request_id`),
  CONSTRAINT `fk_monitoring_real_apply_granter` FOREIGN KEY (`granted_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE `monitoring_real_apply_executions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `request_id` varchar(64) NOT NULL,
  `authorization_id` bigint unsigned NOT NULL,
  `mr_iid` int unsigned NOT NULL,
  `commit_sha` char(40) NOT NULL,
  `executed_by` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_monitoring_real_apply_execution_request` (`request_id`,`created_at`),
  CONSTRAINT `fk_monitoring_real_apply_execution_request` FOREIGN KEY (`request_id`) REFERENCES `monitoring_requests` (`request_id`),
  CONSTRAINT `fk_monitoring_real_apply_execution_authorization` FOREIGN KEY (`authorization_id`) REFERENCES `monitoring_real_apply_authorizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
