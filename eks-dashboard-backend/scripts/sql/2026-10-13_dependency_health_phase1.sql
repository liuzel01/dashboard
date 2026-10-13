INSERT IGNORE INTO `permissions` (`key`, `name`, `created_at`, `updated_at`)
VALUES ('menu:dependency-health', '外部依赖健康', UTC_TIMESTAMP(), UTC_TIMESTAMP());

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT DISTINCT rp.role_id, target_permission.id
FROM `role_permissions` rp
JOIN `permissions` source_permission ON source_permission.id = rp.permission_id
JOIN `permissions` target_permission ON target_permission.`key` = 'menu:dependency-health'
WHERE source_permission.`key` = 'menu:site-monitors';

INSERT INTO `dashboard_site_conf`
  (`conf_key`, `conf_value`, `value_type`, `category`, `description`, `is_sensitive`, `is_runtime_editable`, `default_value`, `validation_json`, `created_at`, `updated_at`)
VALUES
  ('dependency_health.blackbox_base_url', 'http://127.0.0.1:9115', 'string', 'dependency-health', 'Dashboard 后端访问 Blackbox Exporter 的地址', 0, 1, 'http://127.0.0.1:9115', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('dependency_health.timeout_ms', '12000', 'number', 'dependency-health', '单个外部依赖探测超时（毫秒）', 0, 1, '12000', '{"min":1000,"max":30000}', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('dependency_health.targets_json', '[{"key":"dashboard-frontend","name":"Dashboard 前端","environmentId":"global","category":"dashboard","url":"http://10.100.166.109:5173/"},{"key":"dashboard-backend","name":"Dashboard 后端","environmentId":"global","category":"dashboard","url":"http://10.100.166.109:3000/api/oncall/health"},{"key":"jenkins-hashex","name":"Hashex Jenkins","environmentId":"hashex","category":"jenkins","url":"http://10.2.0.116:8080/login"},{"key":"jenkins-hashdev","name":"Hashdev Jenkins","environmentId":"hashdev","category":"jenkins","url":"http://10.2.0.116:8080/login"},{"key":"jenkins-mgbx","name":"MGBX Jenkins","environmentId":"mgbx","category":"jenkins","url":"http://10.100.174.192:8080/login"},{"key":"jenkins-icoin","name":"iCoin Jenkins","environmentId":"icoin","category":"jenkins","url":"http://172.31.18.229:8080/login"},{"key":"jenkins-tb","name":"TB Jenkins","environmentId":"tb","category":"jenkins","url":"http://10.80.160.79:8080/login"},{"key":"line-inventory","name":"线路探测清单服务","environmentId":"global","category":"probe-service","url":"http://172.31.29.3:3000/api/probes/latest"}]', 'json', 'dependency-health', '受控外部依赖探测目录；禁止包含凭据', 0, 1, '[]', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type` = VALUES(`value_type`),
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `is_sensitive` = VALUES(`is_sensitive`),
  `is_runtime_editable` = VALUES(`is_runtime_editable`),
  `default_value` = VALUES(`default_value`),
  `validation_json` = VALUES(`validation_json`),
  `updated_at` = UTC_TIMESTAMP();
