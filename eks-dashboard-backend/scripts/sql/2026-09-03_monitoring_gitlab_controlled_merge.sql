-- Controlled GitLab merge metadata for monitoring-resource requests.
-- Apply once before enabling monitoring.requests.gitlab.merge.enabled.
ALTER TABLE `monitoring_requests`
  ADD COLUMN `gitlab_merged_at` datetime DEFAULT NULL AFTER `commit_sha`,
  ADD COLUMN `gitlab_merge_commit_sha` char(40) DEFAULT NULL AFTER `gitlab_merged_at`,
  ADD COLUMN `gitlab_merge_error` varchar(1000) DEFAULT NULL AFTER `gitlab_merge_commit_sha`,
  ADD KEY `idx_monitoring_requests_gitlab_merge` (`gitlab_merged_at`);
