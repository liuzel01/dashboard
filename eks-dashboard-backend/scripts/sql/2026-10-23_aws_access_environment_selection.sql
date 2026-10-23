INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.hashex.human_tag_write_policy_arn','arn:aws:iam::290368114919:policy/DashboardHashexHumanTagWritePolicy','string','aws_access','hashex 用户临时治理标签写入 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.human_security_group_write_policy_arn','arn:aws:iam::290368114919:policy/DashboardHashexHumanSecurityGroupRulePolicy','string','aws_access','hashex 用户临时安全组入站规则维护 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.human_s3_write_policy_arn','arn:aws:iam::290368114919:policy/DashboardHashexHumanS3WritePolicy','string','aws_access','hashex 用户临时 S3 对象写入 Policy ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `conf_value`=VALUES(`conf_value`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `updated_at`=UTC_TIMESTAMP();
