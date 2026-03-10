const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_DATABASE'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE,
  timezone: 'Z',
};

const filePath = path.resolve(__dirname, '..', 'environments.json');
if (!fs.existsSync(filePath)) {
  console.error(`Missing environments.json at: ${filePath}`);
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8');
let envs;
try {
  envs = JSON.parse(raw);
} catch (e) {
  console.error('Failed to parse environments.json');
  process.exit(1);
}

if (!Array.isArray(envs)) {
  console.error('environments.json must be an array');
  process.exit(1);
}

const toJson = (value) => (value === undefined ? null : JSON.stringify(value));

(async () => {
  const conn = await mysql.createConnection(dbConfig);
  try {
    for (const env of envs) {
      if (!env.id || !env.name || !env.aws_region) {
        console.warn(`Skip invalid env: ${JSON.stringify(env)}`);
        continue;
      }

      await conn.execute(
        `INSERT INTO environments_config
          (environment_id, name, aws_access_key_id, aws_secret_access_key, aws_profile, aws_region, kube_context,
           database_json, redis_json, jump_server_json, tenants_json, platforms_json, alerts_json, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          aws_access_key_id = VALUES(aws_access_key_id),
          aws_secret_access_key = VALUES(aws_secret_access_key),
          aws_profile = VALUES(aws_profile),
          aws_region = VALUES(aws_region),
          kube_context = VALUES(kube_context),
          database_json = VALUES(database_json),
          redis_json = VALUES(redis_json),
          jump_server_json = VALUES(jump_server_json),
          tenants_json = VALUES(tenants_json),
          platforms_json = VALUES(platforms_json),
          alerts_json = VALUES(alerts_json),
          updated_at = UTC_TIMESTAMP()`,
        [
          env.id,
          env.name,
          env.aws_access_key_id || null,
          env.aws_secret_access_key || null,
          env.aws_profile || null,
          env.aws_region,
          env.kubeContext || null,
          toJson(env.database),
          toJson(env.redis),
          toJson(env.jumpServer),
          toJson(env.tenants),
          toJson(env.platforms),
          toJson(env.alerts),
        ],
      );

      await conn.execute(
        `INSERT INTO environments_meta (environment_id, name, created_at, updated_at)
         VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP()`,
        [env.id, env.name],
      );
    }

    console.log(`Imported ${envs.length} environments.`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
