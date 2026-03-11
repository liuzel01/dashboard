-- Rename environment_id from "mega" to "mgbx"
-- Review counts before running. Use a transaction to stay safe.

START TRANSACTION;

-- 1) Ensure target exists in environments_meta
-- (If it does not, uncomment the insert below)
-- INSERT INTO environments_meta (environment_id, name, created_at, updated_at)
-- VALUES ('mgbx', 'mega-生产', UTC_TIMESTAMP(), UTC_TIMESTAMP())
-- ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP();

-- 2) Move config (if only mega exists in environments_config)
UPDATE environments_config
SET environment_id = 'mgbx'
WHERE environment_id = 'mega';

-- 3) Update foreign keys / references
UPDATE tenants SET environment_id = 'mgbx' WHERE environment_id = 'mega';
UPDATE environment_alerts SET environment_id = 'mgbx' WHERE environment_id = 'mega';
UPDATE site_monitors SET environment_id = 'mgbx' WHERE environment_id = 'mega';
UPDATE site_monitor_checks SET environment_id = 'mgbx' WHERE environment_id = 'mega';
UPDATE tenant_sources SET environment_id = 'mgbx' WHERE environment_id = 'mega';

-- 4) Remove old meta row (keep mgbx only)
DELETE FROM environments_meta WHERE environment_id = 'mega';

COMMIT;
