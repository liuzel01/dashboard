ALTER TABLE `monitoring_requests`
  ADD COLUMN `prometheus_rule_alert_name` varchar(128) DEFAULT NULL AFTER `reason`,
  ADD COLUMN `prometheus_rule_expr` varchar(600) DEFAULT NULL AFTER `prometheus_rule_alert_name`,
  ADD COLUMN `prometheus_rule_for` varchar(16) DEFAULT NULL AFTER `prometheus_rule_expr`,
  ADD COLUMN `prometheus_rule_severity` varchar(16) DEFAULT NULL AFTER `prometheus_rule_for`,
  ADD COLUMN `prometheus_rule_summary` varchar(240) DEFAULT NULL AFTER `prometheus_rule_severity`,
  ADD COLUMN `prometheus_rule_description` varchar(1000) DEFAULT NULL AFTER `prometheus_rule_summary`,
  ADD COLUMN `prometheus_rule_owner` varchar(64) DEFAULT NULL AFTER `prometheus_rule_description`,
  ADD COLUMN `prometheus_rule_runbook_url` varchar(500) DEFAULT NULL AFTER `prometheus_rule_owner`,
  ADD KEY `idx_monitoring_requests_prom_rule_alert_name` (`prometheus_rule_alert_name`);
