CREATE TABLE IF NOT EXISTS `dependency_health_provider_profiles` (
  `profile_id` varchar(64) NOT NULL,
  `provider_type` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  `environment_id` varchar(64) NOT NULL,
  `category` varchar(64) NOT NULL,
  `config_json` json NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`profile_id`), KEY `idx_dependency_provider_profiles_enabled` (`enabled`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `dependency_health_provider_profiles` (`profile_id`,`provider_type`,`name`,`environment_id`,`category`,`config_json`,`enabled`,`sort_order`) VALUES
('jenkins-hash','jenkins','Jenkins / Hash','hashex','jenkins','{"baseUrlKey":"cicd.executors.hash-jenkins.base_url","usernameKey":"cicd.executors.hash-jenkins.username","secretKey":"cicd.executors.hash-jenkins.api_token","timeoutKey":"cicd.executors.hash-jenkins.timeout_ms"}',1,10),
('jenkins-mgbx','jenkins','Jenkins / MGBX','mgbx','jenkins','{"baseUrlKey":"cicd.executors.mgbx-jenkins.base_url","usernameKey":"cicd.executors.mgbx-jenkins.username","secretKey":"cicd.executors.mgbx-jenkins.api_token","timeoutKey":"cicd.executors.mgbx-jenkins.timeout_ms"}',1,20),
('jenkins-icoin','jenkins','Jenkins / iCoin','icoin','jenkins','{"baseUrlKey":"cicd.executors.icoin-jenkins.base_url","usernameKey":"cicd.executors.icoin-jenkins.username","secretKey":"cicd.executors.icoin-jenkins.api_token","timeoutKey":"cicd.executors.icoin-jenkins.timeout_ms"}',1,30),
('jenkins-tb','jenkins','Jenkins / TB','tb','jenkins','{"baseUrlKey":"cicd.executors.tb-jenkins.base_url","usernameKey":"cicd.executors.tb-jenkins.username","secretKey":"cicd.executors.tb-jenkins.api_token","timeoutKey":"cicd.executors.tb-jenkins.timeout_ms"}',1,40),
('gitlab-monitoring','gitlab','GitLab / 监控配置','hashex','gitlab','{"baseUrlKey":"monitoring.requests.gitlab.base_url","secretKey":"monitoring.requests.gitlab.bot_token","projectIdKey":"monitoring.requests.gitlab.project_id","targetBranchKey":"monitoring.requests.gitlab.target_branch","timeoutKey":"monitoring.requests.gitlab.timeout_ms"}',1,50),
('grafana-mgbx','grafana','Grafana / MGBX','mgbx','observability','{"baseUrlKey":"aiops.logs.environments.mgbx.grafana_base_url","secretKey":"aiops.logs.environments.mgbx.grafana_token","datasourceUidKey":"aiops.logs.environments.mgbx.datasource_uid","timeoutKey":"aiops.logs.environments.mgbx.timeout_ms"}',1,60),
('cliproxy','cliproxy','CLIProxy / AI Ops','global','aiops','{"baseUrlKey":"aiops.cliproxy.base_url","secretKey":"aiops.cliproxy.api_key","modelKey":"aiops.cliproxy.model","timeoutKey":"aiops.cliproxy.timeout_ms"}',1,70),
('icoin-spot-publish','spot-publish','iCoin / 现货推包','icoin','publish','{"baseUrlKey":"cicd.providers.icoin-spot.signin_url","usernameKey":"cicd.providers.icoin-spot.username","secretKey":"cicd.providers.icoin-spot.password"}',1,80),
('bytebase-hashex','bytebase','Bytebase / Hashex','hashex','bytebase','{"baseUrlKey":"bytebase.hashex.base_url","usernameKey":"bytebase.hashex.catalog_email","secretKey":"bytebase.hashex.catalog_service_key"}',1,90)
ON DUPLICATE KEY UPDATE `provider_type`=VALUES(`provider_type`),`name`=VALUES(`name`),`environment_id`=VALUES(`environment_id`),`category`=VALUES(`category`),`config_json`=VALUES(`config_json`),`enabled`=VALUES(`enabled`),`sort_order`=VALUES(`sort_order`),`updated_at`=UTC_TIMESTAMP();
