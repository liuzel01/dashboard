-- Provider 配置档案只保存引用标识；真实 Token、密码、AK/SK 始终仅由后端通过 dashboard_site_conf 读取。
ALTER TABLE `dependency_health_targets`
  ADD COLUMN `provider_profile` varchar(64) DEFAULT NULL AFTER `probe_module`;

UPDATE `dependency_health_targets`
SET `provider_profile` = CASE `target_key`
  WHEN 'jenkins-hashex' THEN 'jenkins-hash'
  WHEN 'jenkins-hashdev' THEN 'jenkins-hash'
  WHEN 'jenkins-mgbx' THEN 'jenkins-mgbx'
  WHEN 'jenkins-icoin' THEN 'jenkins-icoin'
  WHEN 'jenkins-tb' THEN 'jenkins-tb'
  WHEN 'gitlab-api' THEN 'gitlab-monitoring'
  WHEN 'grafana-mgbx' THEN 'grafana-mgbx'
  WHEN 'cliproxy-api' THEN 'cliproxy'
  WHEN 'icoin-spot-publish' THEN 'icoin-spot-publish'
  WHEN 'bytebase-hashex' THEN 'bytebase-hashex'
  ELSE `provider_profile`
END
WHERE `target_key` IN (
  'jenkins-hashex','jenkins-hashdev','jenkins-mgbx','jenkins-icoin','jenkins-tb',
  'gitlab-api','grafana-mgbx','cliproxy-api','icoin-spot-publish','bytebase-hashex'
);
