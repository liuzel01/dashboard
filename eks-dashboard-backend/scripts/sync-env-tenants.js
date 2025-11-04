#!/usr/bin/env node
/*
  Sync environments and tenants from environments.json into MySQL tables.
  Usage:
    node scripts/sync-env-tenants.js

  Requires backend .env to provide DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE.
*/
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const { DB_HOST, DB_PORT = '3306', DB_USER, DB_PASSWORD, DB_DATABASE } = process.env;
  if (!DB_HOST || !DB_USER || !DB_DATABASE) {
    console.error('[sync] Missing DB envs: DB_HOST/DB_USER/DB_DATABASE');
    process.exit(1);
  }

  const envJsonPath = path.resolve(__dirname, '..', 'environments.json');
  if (!fs.existsSync(envJsonPath)) {
    console.error(`[sync] File not found: ${envJsonPath}`);
    process.exit(1);
  }
  const environments = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));

  const pool = await mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const ddlEnv = `CREATE TABLE IF NOT EXISTS environments_meta (
    environment_id varchar(64) NOT NULL,
    name varchar(255) NOT NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    PRIMARY KEY (environment_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

  const ddlTenants = `CREATE TABLE IF NOT EXISTS tenants (
    id bigint unsigned NOT NULL AUTO_INCREMENT,
    environment_id varchar(64) NOT NULL,
    tenant_id int NOT NULL,
    name varchar(255) NOT NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_env_tenant (environment_id, tenant_id),
    KEY idx_env (environment_id),
    CONSTRAINT fk_tenants_env FOREIGN KEY (environment_id) REFERENCES environments_meta(environment_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

  await pool.execute(ddlEnv);
  await pool.execute(ddlTenants);

  const upsertEnv = `INSERT INTO environments_meta(environment_id, name, created_at, updated_at)
                     VALUES (?, ?, NOW(), NOW())
                     ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW();`;
  const upsertTenant = `INSERT INTO tenants(environment_id, tenant_id, name, created_at, updated_at)
                        VALUES (?, ?, ?, NOW(), NOW())
                        ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW();`;

  for (const env of environments) {
    const envId = env.id;
    const envName = env.name || env.id;
    await pool.execute(upsertEnv, [envId, envName]);

    const tenants = Array.isArray(env.tenants) ? env.tenants : [];
    for (const t of tenants) {
      await pool.execute(upsertTenant, [envId, Number(t.id), t.name || String(t.id)]);
    }
  }

  await pool.end();
  console.log('[sync] Done.');
}

main().catch((e) => {
  console.error('[sync] Failed:', e);
  process.exit(1);
});

