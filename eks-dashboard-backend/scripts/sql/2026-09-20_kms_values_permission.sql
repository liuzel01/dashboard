INSERT INTO permissions (`key`, name, created_at, updated_at)
VALUES ('menu:kms-values', 'KMS 配置加解密', UTC_TIMESTAMP(), UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.`key` = 'menu:kms-values'
WHERE r.name = 'admin'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
