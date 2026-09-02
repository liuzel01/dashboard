-- Phase 3: Dashboard monitoring-resource request and approval workflow.
-- This migration does not call Jenkins, create GitLab MRs, or apply Kubernetes resources.
CREATE TABLE IF NOT EXISTS `monitoring_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `request_id` varchar(64) NOT NULL,
  `status` varchar(24) NOT NULL,
  `requester_user_id` bigint unsigned NOT NULL,
  `app_id` varchar(63) NOT NULL,
  `resource_type` varchar(32) NOT NULL,
  `resource_name` varchar(63) NOT NULL,
  `resource_path` varchar(512) NOT NULL,
  `reason` varchar(1000) NOT NULL,
  `mr_iid` int unsigned DEFAULT NULL,
  `commit_sha` char(40) DEFAULT NULL,
  `approver_user_id` bigint unsigned DEFAULT NULL,
  `approval_comment` varchar(1000) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `uniq_monitoring_requests_request_id` (`request_id`),
  KEY `idx_monitoring_requests_status_updated` (`status`,`updated_at`), KEY `idx_monitoring_requests_requester` (`requester_user_id`),
  CONSTRAINT `fk_monitoring_requests_requester` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_monitoring_requests_approver` FOREIGN KEY (`approver_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `monitoring_request_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `request_id` varchar(64) NOT NULL, `event_type` varchar(48) NOT NULL,
  `actor_user_id` bigint unsigned NOT NULL, `actor_username` varchar(128) NOT NULL, `from_status` varchar(24) DEFAULT NULL, `to_status` varchar(24) DEFAULT NULL,
  `comment` varchar(1000) DEFAULT NULL, `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`), KEY `idx_monitoring_request_events_request_created` (`request_id`,`created_at`),
  CONSTRAINT `fk_monitoring_request_events_request` FOREIGN KEY (`request_id`) REFERENCES `monitoring_requests` (`request_id`),
  CONSTRAINT `fk_monitoring_request_events_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO permissions (`key`,name,created_at,updated_at) VALUES
('menu:monitoring-requests','监控资源申请',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('monitoring-requests:approve','监控资源申请审批',UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('monitoring-requests:manage','监控资源申请管理',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE name=VALUES(name),updated_at=UTC_TIMESTAMP();
INSERT INTO role_permissions (role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.`key` IN ('menu:monitoring-requests','monitoring-requests:approve','monitoring-requests:manage') WHERE r.name='admin' ON DUPLICATE KEY UPDATE role_id=VALUES(role_id);
