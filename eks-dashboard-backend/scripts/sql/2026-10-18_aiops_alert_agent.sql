INSERT INTO `dashboard_site_conf`
(`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aiops.alerts.agent.enabled','false','boolean','aiops-alerts','是否启用基于已采集证据的受控 AI 告警分析',0,1,'false',NULL,NOW(),NOW()),
('aiops.alerts.agent.max_evidence','30','number','aiops-alerts','单次 AI 告警分析最多输入的证据数量',0,1,'30','{"min":5,"max":40}',NOW(),NOW())
ON DUPLICATE KEY UPDATE
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `default_value`=VALUES(`default_value`),
  `validation_json`=VALUES(`validation_json`),
  `updated_at`=NOW();
