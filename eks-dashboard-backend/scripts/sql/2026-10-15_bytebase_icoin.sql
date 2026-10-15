INSERT INTO `bytebase_executors`
(`executor_key`,`display_name`,`base_url_conf_key`,`catalog_email_conf_key`,`catalog_key_conf_key`,`reader_email_conf_key`,`reader_key_conf_key`,`submitter_email_conf_key`,`submitter_key_conf_key`,`deployer_email_conf_key`,`deployer_key_conf_key`,`enabled`)
VALUES
('icoin-bytebase','iCoin Bytebase','bytebase.icoin.base_url','bytebase.icoin.catalog_email','bytebase.icoin.catalog_service_key','bytebase.icoin.reader_email','bytebase.icoin.reader_service_key','bytebase.icoin.submitter_email','bytebase.icoin.submitter_service_key','bytebase.icoin.deployer_email','bytebase.icoin.deployer_service_key',1)
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
VALUES ('icoin','icoin-bytebase',NULL,JSON_ARRAY('CATALOG','CHANGE','ROLLOUT'),1)
ON DUPLICATE KEY UPDATE
  `executor_key`=VALUES(`executor_key`),
  `project_filter_json`=VALUES(`project_filter_json`),
  `capabilities_json`=VALUES(`capabilities_json`),
  `enabled`=VALUES(`enabled`),
  `updated_at`=CURRENT_TIMESTAMP(3);

INSERT INTO `dashboard_site_conf`
(`conf_key`,`conf_value`,`value_type`,`category`,`description`,`is_sensitive`,`is_runtime_editable`,`default_value`,`validation_json`,`created_at`,`updated_at`) VALUES
('bytebase.icoin.base_url','','string','bytebase','iCoin Bytebase HTTPS 地址',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.catalog_email','','string','bytebase','iCoin Bytebase 项目目录 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.catalog_service_key','','string','bytebase','iCoin Bytebase 项目目录 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.reader_email','','string','bytebase','iCoin Bytebase 只读 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.reader_service_key','','string','bytebase','iCoin Bytebase 只读 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.submitter_email','','string','bytebase','iCoin Bytebase 变更提交 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.submitter_service_key','','string','bytebase','iCoin Bytebase 变更提交 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.deployer_email','','string','bytebase','iCoin Bytebase 发布 SA',0,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP()),
('bytebase.icoin.deployer_service_key','','string','bytebase','iCoin Bytebase 发布 Service Key',1,1,'',NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  `value_type`=VALUES(`value_type`),
  `category`=VALUES(`category`),
  `description`=VALUES(`description`),
  `is_sensitive`=VALUES(`is_sensitive`),
  `is_runtime_editable`=VALUES(`is_runtime_editable`),
  `updated_at`=UTC_TIMESTAMP();
