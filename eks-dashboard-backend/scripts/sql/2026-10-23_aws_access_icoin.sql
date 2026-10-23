INSERT INTO `aws_cloud_accounts`
  (`environment_id`,`account_id`,`display_name`,`partition_name`,`default_regions_json`,`platform_audit_role_arn`,`enabled`)
VALUES
  ('icoin','412235698072','iCoin AWS','aws',JSON_ARRAY('ap-southeast-1'),'arn:aws:iam::412235698072:role/DashboardIcoinPlatformAuditRole',1)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `default_regions_json`=VALUES(`default_regions_json`),
  `platform_audit_role_arn`=VALUES(`platform_audit_role_arn`),
  `enabled`=VALUES(`enabled`),
  `updated_at`=CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `aws_cloud_account_role_scopes`
  (`role_id`,`cloud_account_id`,`created_by_user_id`)
SELECT r.id,a.id,NULL
FROM roles r
JOIN aws_cloud_accounts a
  ON a.environment_id='icoin' AND a.account_id='412235698072'
WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.icoin.enabled','true','boolean','aws_access','启用 icoin AWS 临时访问',0,1,'false',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.broker_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinCredentialBrokerRole','string','aws_access','icoin Credential Broker Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_read_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinHumanReadRole','string','aws_access','icoin 用户临时受控资源配置只读 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_account_read_only_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinHumanAccountReadOnlyRole','string','aws_access','icoin 用户临时账号资源全面只读 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_account_read_only_policy_arn','arn:aws:iam::412235698072:policy/DashboardIcoinHumanAccountReadOnlyGuardrail','string','aws_access','icoin 账号资源全面只读敏感数据 Guardrail Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_tag_write_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinHumanTagWriteRole','string','aws_access','icoin 用户临时治理标签写入 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_tag_write_policy_arn','arn:aws:iam::412235698072:policy/DashboardIcoinHumanTagWritePolicy','string','aws_access','icoin 用户临时治理标签写入 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_security_group_write_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinHumanSecurityGroupWriteRole','string','aws_access','icoin 用户临时安全组入站规则维护 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_security_group_write_policy_arn','arn:aws:iam::412235698072:policy/DashboardIcoinHumanSecurityGroupRulePolicy','string','aws_access','icoin 用户临时安全组入站规则维护 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.security_group_write_scope','["arn:aws:ec2:ap-southeast-1:412235698072:security-group/*"]','json','aws_access','icoin 用户临时安全组入站规则维护账号区域范围',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_s3_write_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinHumanS3WriteRole','string','aws_access','icoin 用户临时 S3 对象写入 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_s3_write_policy_arn','arn:aws:iam::412235698072:policy/DashboardIcoinHumanS3WritePolicy','string','aws_access','icoin 用户临时 S3 对象写入 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.s3_write_scope','[{"resourceAccount":"412235698072","bucket":"*","prefix":"*"}]','json','aws_access','icoin 用户临时 S3 对象写入账号范围',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_temporary_admin_role_arn','arn:aws:iam::412235698072:role/DashboardIcoinHumanTemporaryAdminRole','string','aws_access','icoin 用户临时运维管理员 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_temporary_admin_iam_policy_arn','arn:aws:iam::412235698072:policy/DashboardIcoinTemporaryAdminIamPolicy','string','aws_access','icoin 临时运维管理员受控 IAM 写策略 ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.icoin.human_temporary_admin_boundary_arn','arn:aws:iam::412235698072:policy/DashboardIcoinTemporaryAdminBoundary','string','aws_access','icoin 临时运维管理员 Permissions Boundary ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `conf_value`=VALUES(`conf_value`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `default_value`=VALUES(`default_value`),
  `validation_json`=VALUES(`validation_json`),
  `updated_at`=UTC_TIMESTAMP();
