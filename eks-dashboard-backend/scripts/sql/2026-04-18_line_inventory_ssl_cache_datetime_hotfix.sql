-- 说明：
-- 1) 本次报错根因是应用写入了 ISO8601（带 T/Z）到 DATETIME 字段。
-- 2) 正式修复在应用层：写入前统一转为 `YYYY-MM-DD HH:MM:SS`（UTC）。
-- 3) 本 SQL 作为库结构校正/留档脚本，确保缓存表结构与预期一致。

ALTER TABLE `line_inventory_ssl_cache`
  MODIFY COLUMN `ssl_expire_at` datetime DEFAULT NULL COMMENT 'UTC时间，格式: YYYY-MM-DD HH:MM:SS',
  MODIFY COLUMN `last_checked_at` datetime NOT NULL,
  MODIFY COLUMN `expires_at` datetime NOT NULL;

-- 可选：清理历史异常值（如曾出现 0 日期）。
UPDATE `line_inventory_ssl_cache`
SET `ssl_expire_at` = NULL
WHERE `ssl_expire_at` = '0000-00-00 00:00:00';
