START TRANSACTION;

DELETE rp
FROM role_permissions rp
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.`key` = 'aiops:sql:execute';

DELETE FROM permissions
WHERE `key` = 'aiops:sql:execute';

COMMIT;
