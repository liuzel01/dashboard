ALTER TABLE `monitoring_requests`
  ADD COLUMN `workload_service_job_name` varchar(255) DEFAULT NULL AFTER `workload_service_name`;
