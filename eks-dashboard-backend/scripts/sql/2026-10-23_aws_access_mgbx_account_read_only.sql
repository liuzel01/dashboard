INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.mgbx.human_account_read_only_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxHumanAccountReadOnlyRole','string','aws_access','mgbx 用户临时账号资源全面只读 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_account_read_only_policy_arn','arn:aws:iam::931324892624:policy/DashboardMgbxHumanAccountReadOnlyGuardrail','string','aws_access','mgbx 用户临时账号资源全面只读敏感数据 Guardrail Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `conf_value`=VALUES(`conf_value`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `updated_at`=UTC_TIMESTAMP();
