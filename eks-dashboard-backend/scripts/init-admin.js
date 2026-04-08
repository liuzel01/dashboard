const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const DEFAULT_PERMISSIONS = [
  { key: 'menu:environments', name: '环境管理' },
  { key: 'menu:s3-upload', name: 'S3 上传' },
  { key: 'menu:deployments', name: 'EKS 部署' },
  { key: 'menu:jump-servers', name: 'Windows 跳板机' },
  { key: 'menu:data-query', name: '查询中心' },
  { key: 'menu:security-groups', name: '安全组管理' },
  { key: 'menu:lines', name: '线路列表' },
  { key: 'menu:site-monitors', name: '站点监控' },
  { key: 'menu:access-control', name: '账号管理' },
  { key: 'menu:ai-ops', name: 'AI 运维' },
  { key: 'aiops:qa', name: 'AI 问答' },
  { key: 'aiops:sql:generate', name: 'AI SQL 生成' },
  { key: 'aiops:sql:execute', name: 'AI SQL 执行' },
  { key: 'aiops:incident:analyze', name: '故障定位分析' },
  { key: 'aiops:slowlog:analyze', name: '慢查询分析' },
  { key: 'aiops:notify:lark', name: 'AI 告警推送 Lark' },
];

const parseArg = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
};

const hasFlag = (flag) => process.argv.includes(flag);

const generatePassword = () => {
  const raw = crypto.randomBytes(9).toString('base64');
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length >= 12) return cleaned.slice(0, 12);
  return `${cleaned}${crypto.randomBytes(4).toString('hex')}`.slice(0, 12);
};

const hashPassword = (password) => {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `${salt}$${hash}`;
};

async function main() {
  const username = (parseArg('--username') || 'admin').trim();
  const roleName = (parseArg('--role') || '管理员').trim();
  let password = parseArg('--password');
  const force = hasFlag('--force');

  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER;
  const passwordEnv = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE;

  if (!host || !user || !database) {
    console.error('Missing DB envs: DB_HOST/DB_USER/DB_DATABASE');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password: passwordEnv,
    database,
    timezone: 'Z',
  });

  try {
    await conn.beginTransaction();

    // Permissions
    for (const perm of DEFAULT_PERMISSIONS) {
      await conn.execute(
        `INSERT INTO permissions (\`key\`, name, created_at, updated_at)
         VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = UTC_TIMESTAMP()`,
        [perm.key, perm.name],
      );
    }

    // Role
    const [roleRows] = await conn.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', [roleName]);
    let roleId = roleRows[0]?.id;
    if (!roleId) {
      const [roleResult] = await conn.execute(
        'INSERT INTO roles (name, description, created_at, updated_at) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        [roleName, '系统管理员'],
      );
      roleId = roleResult.insertId;
    }

    // User
    const [userRows] = await conn.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    let userId = userRows[0]?.id;

    if (userId && !force) {
      await conn.commit();
      console.log(`User "${username}" already exists (id=${userId}). Use --force to reset.`);
      return;
    }

    if (!password) {
      password = generatePassword();
    }

    const passwordHash = hashPassword(password);

    if (!userId) {
      const [userResult] = await conn.execute(
        'INSERT INTO users (username, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        [username, passwordHash, 'active'],
      );
      userId = userResult.insertId;
    } else {
      await conn.execute(
        'UPDATE users SET password_hash = ?, status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
        [passwordHash, 'active', userId],
      );
    }

    // User role
    await conn.execute(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
      [userId, roleId],
    );

    // Role permissions: assign all permissions
    const [permRows] = await conn.execute('SELECT id FROM permissions');
    for (const perm of permRows) {
      await conn.execute(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE role_id = role_id',
        [roleId, perm.id],
      );
    }

    await conn.commit();
    console.log(`Admin ready. username=${username} role=${roleName}`);
    if (password) {
      console.log(`Password: ${password}`);
    }
  } catch (err) {
    await conn.rollback();
    console.error(err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
