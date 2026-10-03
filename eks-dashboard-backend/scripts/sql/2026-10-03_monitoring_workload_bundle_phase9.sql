ALTER TABLE `monitoring_requests`
  ADD COLUMN `workload_yaml` mediumtext DEFAULT NULL AFTER `executor_key`,
  ADD COLUMN `workload_namespace` varchar(63) DEFAULT NULL AFTER `workload_yaml`,
  ADD COLUMN `workload_deployment_name` varchar(63) DEFAULT NULL AFTER `workload_namespace`,
  ADD COLUMN `workload_service_name` varchar(63) DEFAULT NULL AFTER `workload_deployment_name`,
  ADD COLUMN `workload_last_check_json` mediumtext DEFAULT NULL AFTER `workload_service_name`,
  ADD COLUMN `workload_last_checked_at` datetime DEFAULT NULL AFTER `workload_last_check_json`;
