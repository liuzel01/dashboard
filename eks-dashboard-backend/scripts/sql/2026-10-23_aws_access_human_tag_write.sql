INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.hashex.human_tag_write_role_arn','arn:aws:iam::290368114919:role/DashboardHashexHumanTagWriteRole','string','aws_access','hashex 用户临时治理标签写入 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `description`=VALUES(`description`),`updated_at`=UTC_TIMESTAMP();
