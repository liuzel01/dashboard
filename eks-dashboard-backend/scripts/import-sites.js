#!/usr/bin/env node
/*
  Bulk import sites into site_monitors.

  Input: CSV file path passed as first arg. CSV headers required:
    environment_id,tenant_id,name,hosts,port,is_https,notes

  Notes:
  - hosts: one or multiple domains/IP, separated by comma or whitespace (e.g. "a.example.com,b.example.com").
  - tenant_id: optional (empty allowed)
  - is_https: 1/0 or true/false (case-insensitive)
  - port: number

  Usage:
    node scripts/import-sites.js ./sites.csv

  Requires backend .env to provide DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

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

function parseCsv(content) {
  // RFC4180-style CSV parser with support for quoted fields, embedded commas,
  // and CRLF/ LF newlines. Trims outer whitespace of fields.
  // Returns array of objects keyed by header row.
  if (!content) return [];
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const rows = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = content[i + 1];
        if (next === '"') {
          field += '"';
          i += 1; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        record.push(field.trim());
        field = '';
      } else if (ch === '\r') {
        // ignore, handle on \n
      } else if (ch === '\n') {
        record.push(field.trim());
        rows.push(record);
        record = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  // push last field/record if any
  if (field.length > 0 || record.length > 0) {
    record.push(field.trim());
    rows.push(record);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  const dataRows = rows.slice(1).filter((r) => r && r.some((c) => String(c).trim().length > 0));
  return dataRows.map((cols) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = String(cols[i] ?? '').trim();
    });
    return obj;
  });
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-sites.js <csv-file>');
    process.exit(1);
  }
  const csvPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const { DB_HOST, DB_PORT = '3306', DB_USER, DB_PASSWORD, DB_DATABASE } = process.env;
  if (!DB_HOST || !DB_USER || !DB_DATABASE) {
    console.error('Missing DB envs: DB_HOST/DB_USER/DB_DATABASE');
    process.exit(1);
  }

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

  // Detect if file is actually an XLSX (ZIP, starts with PK) to prevent confusing errors.
  const magic = fs.readFileSync(csvPath, { encoding: null, flag: 'r' }).slice(0, 2).toString('utf8');
  if (magic === 'PK') {
    console.error('\n[import-sites] The file appears to be an Excel .xlsx (ZIP) file, not plain CSV.');
    console.error('Please export/save as "CSV (UTF-8)" or use the XLSX importer:');
    console.error('  node scripts/import-sites-xlsx.js path/to/file.xlsx    (requires: npm i xlsx)');
    process.exit(1);
  }
  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(content);
  if (rows.length === 0) {
    console.log('No rows to import.');
    process.exit(0);
  }

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
      const hosts = splitHosts(r.hosts || r.host || '');
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
