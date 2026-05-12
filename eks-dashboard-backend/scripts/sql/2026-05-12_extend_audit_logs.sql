SET @db_name = DATABASE();

-- target_id 原 varchar(64) 对 S3 bucket/key、路径类资源可能过短，扩展到 512。
SET @target_id_len = (
  SELECT CHARACTER_MAXIMUM_LENGTH
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'target_id'
);
SET @ddl_target_id = IF(
  @target_id_len IS NOT NULL AND @target_id_len < 512,
  'ALTER TABLE `audit_logs` MODIFY COLUMN `target_id` varchar(512) DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_target_id FROM @ddl_target_id;
EXECUTE stmt_target_id;
DEALLOCATE PREPARE stmt_target_id;

-- actor/display 信息
SET @has_actor_username = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'actor_username');
SET @ddl_actor_username = IF(@has_actor_username = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `actor_username` varchar(128) DEFAULT NULL AFTER `actor_user_id`', 'SELECT 1');
PREPARE stmt_actor_username FROM @ddl_actor_username; EXECUTE stmt_actor_username; DEALLOCATE PREPARE stmt_actor_username;

SET @has_actor_display_name = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'actor_display_name');
SET @ddl_actor_display_name = IF(@has_actor_display_name = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `actor_display_name` varchar(128) DEFAULT NULL AFTER `actor_username`', 'SELECT 1');
PREPARE stmt_actor_display_name FROM @ddl_actor_display_name; EXECUTE stmt_actor_display_name; DEALLOCATE PREPARE stmt_actor_display_name;

-- 环境/API 来源
SET @has_environment_id = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'environment_id');
SET @ddl_environment_id = IF(@has_environment_id = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `environment_id` varchar(64) DEFAULT NULL AFTER `actor_display_name`', 'SELECT 1');
PREPARE stmt_environment_id FROM @ddl_environment_id; EXECUTE stmt_environment_id; DEALLOCATE PREPARE stmt_environment_id;

SET @has_method = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'method');
SET @ddl_method = IF(@has_method = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `method` varchar(16) DEFAULT NULL AFTER `environment_id`', 'SELECT 1');
PREPARE stmt_method FROM @ddl_method; EXECUTE stmt_method; DEALLOCATE PREPARE stmt_method;

SET @has_path = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'path');
SET @ddl_path = IF(@has_path = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `path` varchar(512) DEFAULT NULL AFTER `method`', 'SELECT 1');
PREPARE stmt_path FROM @ddl_path; EXECUTE stmt_path; DEALLOCATE PREPARE stmt_path;

SET @has_menu_key = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'menu_key');
SET @ddl_menu_key = IF(@has_menu_key = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `menu_key` varchar(128) DEFAULT NULL AFTER `path`', 'SELECT 1');
PREPARE stmt_menu_key FROM @ddl_menu_key; EXECUTE stmt_menu_key; DEALLOCATE PREPARE stmt_menu_key;

-- 操作展示名
SET @has_action_name = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action_name');
SET @ddl_action_name = IF(@has_action_name = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `action_name` varchar(255) DEFAULT NULL AFTER `action`', 'SELECT 1');
PREPARE stmt_action_name FROM @ddl_action_name; EXECUTE stmt_action_name; DEALLOCATE PREPARE stmt_action_name;

-- 摘要；保留旧 meta 字段用于兼容，也新增 request/response summary。
SET @has_request_summary = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'request_summary');
SET @ddl_request_summary = IF(@has_request_summary = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `request_summary` json DEFAULT NULL AFTER `meta`', 'SELECT 1');
PREPARE stmt_request_summary FROM @ddl_request_summary; EXECUTE stmt_request_summary; DEALLOCATE PREPARE stmt_request_summary;

SET @has_response_summary = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'response_summary');
SET @ddl_response_summary = IF(@has_response_summary = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `response_summary` json DEFAULT NULL AFTER `request_summary`', 'SELECT 1');
PREPARE stmt_response_summary FROM @ddl_response_summary; EXECUTE stmt_response_summary; DEALLOCATE PREPARE stmt_response_summary;

-- 结果/排查信息
SET @has_status = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'status');
SET @ddl_status = IF(@has_status = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `status` varchar(32) DEFAULT NULL AFTER `response_summary`', 'SELECT 1');
PREPARE stmt_status FROM @ddl_status; EXECUTE stmt_status; DEALLOCATE PREPARE stmt_status;

SET @has_status_code = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'status_code');
SET @ddl_status_code = IF(@has_status_code = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `status_code` int DEFAULT NULL AFTER `status`', 'SELECT 1');
PREPARE stmt_status_code FROM @ddl_status_code; EXECUTE stmt_status_code; DEALLOCATE PREPARE stmt_status_code;

SET @has_error_message = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'error_message');
SET @ddl_error_message = IF(@has_error_message = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `error_message` text DEFAULT NULL AFTER `status_code`', 'SELECT 1');
PREPARE stmt_error_message FROM @ddl_error_message; EXECUTE stmt_error_message; DEALLOCATE PREPARE stmt_error_message;

SET @has_duration_ms = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'duration_ms');
SET @ddl_duration_ms = IF(@has_duration_ms = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `duration_ms` int DEFAULT NULL AFTER `error_message`', 'SELECT 1');
PREPARE stmt_duration_ms FROM @ddl_duration_ms; EXECUTE stmt_duration_ms; DEALLOCATE PREPARE stmt_duration_ms;

SET @has_ip = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'ip');
SET @ddl_ip = IF(@has_ip = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `ip` varchar(64) DEFAULT NULL AFTER `duration_ms`', 'SELECT 1');
PREPARE stmt_ip FROM @ddl_ip; EXECUTE stmt_ip; DEALLOCATE PREPARE stmt_ip;

SET @has_user_agent = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'user_agent');
SET @ddl_user_agent = IF(@has_user_agent = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `user_agent` varchar(512) DEFAULT NULL AFTER `ip`', 'SELECT 1');
PREPARE stmt_user_agent FROM @ddl_user_agent; EXECUTE stmt_user_agent; DEALLOCATE PREPARE stmt_user_agent;

SET @has_trace_id = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'trace_id');
SET @ddl_trace_id = IF(@has_trace_id = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `trace_id` varchar(128) DEFAULT NULL AFTER `user_agent`', 'SELECT 1');
PREPARE stmt_trace_id FROM @ddl_trace_id; EXECUTE stmt_trace_id; DEALLOCATE PREPARE stmt_trace_id;

-- 索引。MySQL 5.7 无 CREATE INDEX IF NOT EXISTS，使用 information_schema 判断。
SET @has_idx_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_created');
SET @ddl_idx_created = IF(@has_idx_created = 0, 'CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`)', 'SELECT 1');
PREPARE stmt_idx_created FROM @ddl_idx_created; EXECUTE stmt_idx_created; DEALLOCATE PREPARE stmt_idx_created;

SET @has_idx_status_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_status_created');
SET @ddl_idx_status_created = IF(@has_idx_status_created = 0, 'CREATE INDEX `idx_audit_status_created` ON `audit_logs` (`status`, `created_at`)', 'SELECT 1');
PREPARE stmt_idx_status_created FROM @ddl_idx_status_created; EXECUTE stmt_idx_status_created; DEALLOCATE PREPARE stmt_idx_status_created;

SET @has_idx_method_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_method_created');
SET @ddl_idx_method_created = IF(@has_idx_method_created = 0, 'CREATE INDEX `idx_audit_method_created` ON `audit_logs` (`method`, `created_at`)', 'SELECT 1');
PREPARE stmt_idx_method_created FROM @ddl_idx_method_created; EXECUTE stmt_idx_method_created; DEALLOCATE PREPARE stmt_idx_method_created;

SET @has_idx_env_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_env_created');
SET @ddl_idx_env_created = IF(@has_idx_env_created = 0, 'CREATE INDEX `idx_audit_env_created` ON `audit_logs` (`environment_id`, `created_at`)', 'SELECT 1');
PREPARE stmt_idx_env_created FROM @ddl_idx_env_created; EXECUTE stmt_idx_env_created; DEALLOCATE PREPARE stmt_idx_env_created;
