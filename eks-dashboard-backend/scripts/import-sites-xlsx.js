#!/usr/bin/env node
/*
  Bulk import sites from an Excel .xlsx file (first sheet).

  Columns supported (header names, case-insensitive):
    environment_id, tenant_id, name, hosts (or host), port, is_https, notes

  Usage:
    node scripts/import-sites-xlsx.js ./sites.xlsx

  Requires:
    - Backend .env for DB connection (DB_HOST, ...)
    - npm install xlsx
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.error('Missing dependency: xlsx. Please run: npm i xlsx');
  process.exit(1);
}

function parseBool(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return 1;
  if (s === '0' || s === 'false' || s === 'no') return 0;
  return null;
}

function splitHosts(s) {
  return String(s)
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function normalizeRow(obj) {
  const map = {};
  for (const k of Object.keys(obj || {})) {
    map[k.trim().toLowerCase()] = obj[k];
  }
  return {
    environment_id: map.environment_id ?? map.env ?? '',
    tenant_id: map.tenant_id ?? map.tenant ?? '',
    name: map.name ?? map.title ?? '',
    hosts: map.hosts ?? map.host ?? '',
    port: map.port ?? '',
    is_https: map.is_https ?? map.https ?? '',
    notes: map.notes ?? '',
  };
}

async function main() {
  const file = process.argv[1] && process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-sites-xlsx.js <xlsx-file>');
    process.exit(1);
  }
  const xlsxPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(xlsxPath)) {
    console.error(`File not found: ${xlsxPath}`);
    process.exit(1);
  }

  const { DB_HOST, DB_PORT = '3306', DB_USER, DB_PASSWORD, DB_DATABASE } = process.env;
  if (!DB_HOST || !DB_USER || !DB_DATABASE) {
    console.error('Missing DB envs: DB_HOST/DB_USER/DB_DATABASE');
    process.exit(1);
  }

  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const rows = raw.map(normalizeRow);

  const pool = await mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: 'Z',
  });

  const insertSql = `INSERT INTO site_monitors
    (environment_id, tenant_id, name, host, port, is_https, environment_label, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`;

  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      const envId = r.environment_id;
      if (!envId) throw new Error('environment_id is required');
      const name = r.name || '';
      const port = Number(r.port || '0');
      if (!port) throw new Error('port is required');
      const isHttps = parseBool(r.is_https);
      if (isHttps === null) throw new Error('is_https must be 1/0/true/false');
      const tenantId = r.tenant_id ? Number(r.tenant_id) : null;
      const notes = r.notes || null;
      const hosts = splitHosts(r.hosts || '');
      if (hosts.length === 0) throw new Error('hosts is required');
      for (const h of hosts) {
        await pool.execute(insertSql, [envId, tenantId, name, h, port, isHttps, null, notes]);
        ok += 1;
      }
    } catch (e) {
      console.error('Import row failed:', r, e.message || e);
      fail += 1;
    }
  }

  await pool.end();
  console.log(`Done. Inserted=${ok}, FailedRows=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

