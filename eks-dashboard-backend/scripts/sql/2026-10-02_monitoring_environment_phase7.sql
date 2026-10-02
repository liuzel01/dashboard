ALTER TABLE `monitoring_requests`
  ADD COLUMN `environment_id` varchar(64) NOT NULL DEFAULT 'hashex' AFTER `requester_user_id`,
  ADD COLUMN `target_branch` varchar(128) NOT NULL DEFAULT 'hash-jenkins' AFTER `environment_id`,
  ADD COLUMN `repository_environment_path` varchar(128) NOT NULL DEFAULT 'hash' AFTER `target_branch`,
  ADD COLUMN `executor_key` varchar(128) NOT NULL DEFAULT 'hash-jenkins' AFTER `repository_environment_path`,
  ADD KEY `idx_monitoring_requests_environment_updated` (`environment_id`, `updated_at`);

UPDATE `monitoring_requests`
SET `environment_id` = 'hashex',
    `target_branch` = 'hash-jenkins',
    `repository_environment_path` = 'hash',
    `executor_key` = 'hash-jenkins'
WHERE `environment_id` = '' OR `environment_id` IS NULL;
