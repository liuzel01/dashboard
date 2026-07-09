SET @db_name = DATABASE();

INSERT INTO permissions (`key`, name, created_at, updated_at)
SELECT 'menu:ssl-certificates', 'SSL证书申请与导出', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM dual
WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE `key` = 'menu:ssl-certificates'
);

CREATE TABLE IF NOT EXISTS `ssl_certificate_export_meta` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `certificate_id` bigint NOT NULL,
  `last_exported_at` datetime DEFAULT NULL,
  `last_exported_by` varchar(128) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ssl_cert_export_meta_cert` (`certificate_id`),
  KEY `idx_ssl_cert_export_meta_exported_at` (`last_exported_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
