INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.hashex.human_security_group_write_role_arn','arn:aws:iam::290368114919:role/DashboardHashexHumanSecurityGroupWriteRole','string','aws_access','hashex 用户临时安全组入站规则维护 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.security_group_write_scope','["arn:aws:ec2:ap-east-1:290368114919:security-group/*"]','json','aws_access','hashex 用户临时安全组入站规则维护账号区域范围',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.human_s3_write_role_arn','arn:aws:iam::290368114919:role/DashboardHashexHumanS3WriteRole','string','aws_access','hashex 用户临时 S3 对象写入 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.hashex.s3_write_scope','[{"resourceAccount":"290368114919","bucket":"*","prefix":"*"}]','json','aws_access','hashex 用户临时 S3 对象写入账号范围',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `conf_value`=VALUES(`conf_value`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `updated_at`=UTC_TIMESTAMP();

DELETE FROM `dashboard_site_conf`
WHERE `conf_key` IN (
  'aws_access.hashex.human_s3_prefix_write_role_arn',
  'aws_access.hashex.s3_prefix_write_scope'
);
