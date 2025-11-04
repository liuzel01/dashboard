-- Add acceptable_status_codes to site_monitors and environment_alerts
ALTER TABLE `site_monitors`
  ADD COLUMN `acceptable_status_codes` VARCHAR(255) NULL AFTER `notes`;

ALTER TABLE `environment_alerts`
  ADD COLUMN `acceptable_status_codes` VARCHAR(255) NULL AFTER `probe_timeout_ms`;

-- Optional: create environment_alerts table if not exists (safety for dev envs)
-- CREATE TABLE IF NOT EXISTS `environment_alerts` (
--   `environment_id` varchar(64) NOT NULL,
--   `lark_webhook_url` text,
--   `failure_threshold` int DEFAULT NULL,
--   `cooldown_minutes` int DEFAULT NULL,
--   `probe_timeout_ms` int DEFAULT NULL,
--   `acceptable_status_codes` varchar(255) DEFAULT NULL,
--   `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
--   `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--   PRIMARY KEY (`environment_id`)
-- );
