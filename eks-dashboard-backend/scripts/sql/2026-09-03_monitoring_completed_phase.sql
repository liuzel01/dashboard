-- Phase 7: terminal completed state after a successful real Apply.
-- Run after 2026-09-03_monitoring_gitlab_controlled_merge.sql.
-- Backfill safely: only already-successful apply executions can complete an APPROVED request.
UPDATE monitoring_requests r
JOIN monitoring_jenkins_executions e ON e.request_id = r.request_id
SET r.status = 'COMPLETED', r.updated_at = UTC_TIMESTAMP()
WHERE r.status = 'APPROVED' AND e.mode = 'apply' AND e.status = 'SUCCESS';

-- Preserve an auditable state transition for migrated historical success records.
INSERT INTO monitoring_request_events (request_id,event_type,actor_user_id,actor_username,from_status,to_status,comment,created_at)
SELECT r.request_id,'REAL_APPLY_SUCCEEDED',r.approver_user_id,u.username,'APPROVED','COMPLETED',CONCAT('历史回填：Jenkins #',e.build_number,' SUCCESS'),UTC_TIMESTAMP()
FROM monitoring_requests r
JOIN monitoring_jenkins_executions e ON e.request_id = r.request_id AND e.mode = 'apply' AND e.status = 'SUCCESS'
JOIN users u ON u.id = r.approver_user_id
WHERE r.status = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM monitoring_request_events x WHERE x.request_id = r.request_id AND x.event_type = 'REAL_APPLY_SUCCEEDED' AND x.to_status = 'COMPLETED');
