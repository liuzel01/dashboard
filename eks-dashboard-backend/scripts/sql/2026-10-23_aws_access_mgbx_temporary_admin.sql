INSERT INTO `permissions` (`key`,`name`,`created_at`,`updated_at`) VALUES
('aws-access:grant:temporary-admin','AWS 临时运维管理员授权',UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`updated_at`=UTC_TIMESTAMP();

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.`key`='aws-access:grant:temporary-admin'
WHERE LOWER(r.name)='admin';

INSERT INTO `dashboard_site_conf`
  (`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`)
VALUES
('aws_access.mgbx.human_temporary_admin_role_arn','arn:aws:iam::931324892624:role/DashboardMgbxHumanTemporaryAdminRole','string','aws_access','mgbx 用户临时运维管理员 Role ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_temporary_admin_iam_policy_arn','arn:aws:iam::931324892624:policy/DashboardMgbxTemporaryAdminIamPolicy','string','aws_access','mgbx 临时运维管理员受控 IAM 写策略 ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('aws_access.mgbx.human_temporary_admin_boundary_arn','arn:aws:iam::931324892624:policy/DashboardMgbxTemporaryAdminBoundary','string','aws_access','mgbx 临时运维管理员 Permissions Boundary ARN',0,1,NULL,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `conf_value`=VALUES(`conf_value`),
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `updated_at`=UTC_TIMESTAMP();
