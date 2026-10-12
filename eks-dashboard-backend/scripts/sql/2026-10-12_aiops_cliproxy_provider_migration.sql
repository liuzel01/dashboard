INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
SELECT 'aiops.cliproxy.base_url', `conf_value`, 'string', 'aiops', 'AI Ops cliproxy OpenAI-compatible API Base URL', 0, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `dashboard_site_conf` WHERE `conf_key`='aiops.openclaw.base_url'
ON DUPLICATE KEY UPDATE `conf_value`=VALUES(`conf_value`), `category`='aiops', `description`=VALUES(`description`), `updated_at`=UTC_TIMESTAMP();

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
SELECT 'aiops.cliproxy.api_key', `conf_value`, 'string', 'aiops', 'AI Ops cliproxy 专用 API Key', 1, 1, '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `dashboard_site_conf` WHERE `conf_key`='aiops.openclaw.token'
ON DUPLICATE KEY UPDATE `conf_value`=VALUES(`conf_value`), `category`='aiops', `description`=VALUES(`description`), `is_sensitive`=1, `updated_at`=UTC_TIMESTAMP();

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('aiops.cliproxy.model', 'gpt-5.6-terra', 'string', 'aiops', 'AI Ops cliproxy 受控模型', 0, 1, 'gpt-5.6-terra', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('aiops.cliproxy.timeout_ms', '20000', 'number', 'aiops', 'cliproxy chat/completions 请求超时（毫秒）', 0, 1, '20000', '{"min":1000}', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `category`='aiops', `description`=VALUES(`description`), `default_value`=VALUES(`default_value`), `validation_json`=VALUES(`validation_json`), `updated_at`=UTC_TIMESTAMP();

UPDATE `dashboard_site_conf`
SET `conf_value`='cliproxy', `default_value`='cliproxy', `description`='AI Ops LLM provider（当前使用 cliproxy）', `validation_json`='{"enum":["cliproxy"]}', `updated_at`=UTC_TIMESTAMP()
WHERE `conf_key`='aiops.llm.provider';

UPDATE `dashboard_site_conf`
SET `category`='aiops-legacy', `is_runtime_editable`=0, `description`=CONCAT('兼容旧配置：已迁移；', COALESCE(`description`, '')), `updated_at`=UTC_TIMESTAMP()
WHERE `conf_key` IN ('aiops.openclaw.base_url','aiops.openclaw.token','aiops.openclaw.model','aiops.openclaw.timeout_ms');
