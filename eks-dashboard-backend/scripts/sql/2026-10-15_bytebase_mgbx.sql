INSERT INTO `bytebase_executors`
(`executor_key`,`display_name`,`base_url_conf_key`,`catalog_email_conf_key`,`catalog_key_conf_key`,`reader_email_conf_key`,`reader_key_conf_key`,`submitter_email_conf_key`,`submitter_key_conf_key`,`deployer_email_conf_key`,`deployer_key_conf_key`,`enabled`)
VALUES
('mgbx-bytebase','MGBX Bytebase','bytebase.mgbx.base_url','bytebase.mgbx.catalog_email','bytebase.mgbx.catalog_service_key','bytebase.mgbx.reader_email','bytebase.mgbx.reader_service_key','bytebase.mgbx.submitter_email','bytebase.mgbx.submitter_service_key','bytebase.mgbx.deployer_email','bytebase.mgbx.deployer_service_key',1)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `base_url_conf_key`=VALUES(`base_url_conf_key`),
  `catalog_email_conf_key`=VALUES(`catalog_email_conf_key`),
  `catalog_key_conf_key`=VALUES(`catalog_key_conf_key`),
  `reader_email_conf_key`=VALUES(`reader_email_conf_key`),
  `reader_key_conf_key`=VALUES(`reader_key_conf_key`),
  `submitter_email_conf_key`=VALUES(`submitter_email_conf_key`),
  `submitter_key_conf_key`=VALUES(`submitter_key_conf_key`),
  `deployer_email_conf_key`=VALUES(`deployer_email_conf_key`),
  `deployer_key_conf_key`=VALUES(`deployer_key_conf_key`),
  `enabled`=VALUES(`enabled`),
  `updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `bytebase_environment_bindings`
(`environment_id`,`executor_key`,`project_filter_json`,`capabilities_json`,`enabled`)
VALUES ('mgbx','mgbx-bytebase',NULL,JSON_ARRAY('CATALOG','CHANGE','ROLLOUT'),1)
ON DUPLICATE KEY UPDATE
  `executor_key`=VALUES(`executor_key`),
  `project_filter_json`=VALUES(`project_filter_json`),
  `capabilities_json`=VALUES(`capabilities_json`),
  `enabled`=VALUES(`enabled`),
  `updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `dashboard_site_conf`
(`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('bytebase.mgbx.base_url','','string','bytebase','MGBX Bytebase HTTPS 地址',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.catalog_email','','string','bytebase','MGBX Bytebase 项目目录 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.catalog_service_key','','string','bytebase','MGBX Bytebase 项目目录 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.reader_email','','string','bytebase','MGBX Bytebase 只读 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.reader_service_key','','string','bytebase','MGBX Bytebase 只读 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.submitter_email','','string','bytebase','MGBX Bytebase 变更提交 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.submitter_service_key','','string','bytebase','MGBX Bytebase 变更提交 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.deployer_email','','string','bytebase','MGBX Bytebase 发布 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.mgbx.deployer_service_key','','string','bytebase','MGBX Bytebase 发布 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `updated_at`=UTC_TIMESTAMP();
