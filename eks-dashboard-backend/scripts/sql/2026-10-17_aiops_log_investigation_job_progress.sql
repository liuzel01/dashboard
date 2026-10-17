ALTER TABLE `aiops_log_investigation_jobs`
  ADD COLUMN `stage` varchar(32) DEFAULT NULL AFTER `status`,
  ADD COLUMN `stage_detail_json` json DEFAULT NULL AFTER `stage`,
  ADD COLUMN `heartbeat_at` datetime DEFAULT NULL AFTER `stage_detail_json`;
