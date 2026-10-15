INSERT INTO `dependency_health_targets`
  (`target_key`,`name`,`environment_id`,`category`,`url`,`probe_module`,`enabled`,`sort_order`)
SELECT
  'bytebase-hashex','Hashex Bytebase','hashex','database-governance',
  CONCAT(TRIM(TRAILING '/' FROM `conf_value`),'/v1/actuator/info'),
  'http_reachable',1,260
FROM `dashboard_site_conf`
WHERE `conf_key`='bytebase.hashex.base_url' AND TRIM(`conf_value`)<>''
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`),
  `environment_id`=VALUES(`environment_id`),
  `category`=VALUES(`category`),
  `url`=VALUES(`url`),
  `probe_module`=VALUES(`probe_module`),
  `enabled`=VALUES(`enabled`),
  `sort_order`=VALUES(`sort_order`),
  `updated_at`=UTC_TIMESTAMP(3);
