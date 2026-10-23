INSERT INTO `aws_cloud_accounts`
  (`environment_id`,`account_id`,`display_name`,`partition_name`,`default_regions_json`,`platform_audit_role_arn`,`enabled`)
VALUES
  ('mgbx','931324892624','MGBX AWS','aws',JSON_ARRAY('ap-southeast-1'),'arn:aws:iam::931324892624:role/DashboardMgbxPlatformAuditRole',1)
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
  ON a.environment_id='mgbx' AND a.account_id='931324892624'
WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.mgbx.enabled','true','boolean','aws_access','启用 mgbx AWS 临时访问',0,1,'false',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.broker_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxCredentialBrokerRole','string','aws_access','mgbx Credential Broker Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_read_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxHumanReadRole','string','aws_access','mgbx 用户临时只读 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_tag_write_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxHumanTagWriteRole','string','aws_access','mgbx 用户临时治理标签写入 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_tag_write_policy_arn','arn:aws:iam::931324892624:policy/DashboardMgbxHumanTagWritePolicy','string','aws_access','mgbx 用户临时治理标签写入 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_security_group_write_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxHumanSecurityGroupWriteRole','string','aws_access','mgbx 用户临时安全组入站规则维护 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_security_group_write_policy_arn','arn:aws:iam::931324892624:policy/DashboardMgbxHumanSecurityGroupRulePolicy','string','aws_access','mgbx 用户临时安全组入站规则维护 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.security_group_write_scope','["arn:aws:ec2:ap-southeast-1:931324892624:security-group/*"]','json','aws_access','mgbx 用户临时安全组入站规则维护账号区域范围',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_s3_write_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxHumanS3WriteRole','string','aws_access','mgbx 用户临时 S3 对象写入 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_s3_write_policy_arn','arn:aws:iam::931324892624:policy/DashboardMgbxHumanS3WritePolicy','string','aws_access','mgbx 用户临时 S3 对象写入 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.s3_write_scope','[{"resourceAccount":"931324892624","bucket":"*","prefix":"*"}]','json','aws_access','mgbx 用户临时 S3 对象写入账号范围',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
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
