#!/usr/bin/env node
import fs from 'node:fs';
import mysql from '../eks-dashboard-backend/node_modules/mysql2/promise.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const jsonPath = process.argv.find((arg, idx, arr) => idx > 1 && !arg.startsWith('--') && arr[idx - 1] !== '--env') || 'reports/sap-c02-import-all.json';
const envPath = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'eks-dashboard-backend/.env';

function loadEnv(path) {
  const env = {};
  const text = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return { ...env, ...process.env };
}

const env = loadEnv(envPath);
const items = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const byNo = new Map(items.map((item) => [String(item.sourceQuestionNo), item]));

const conn = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  timezone: 'Z',
  dateStrings: true,
});

const [examRows] = await conn.execute('SELECT id FROM cert_exams WHERE code = ? LIMIT 1', ['SAP-C02']);
if (!examRows.length) throw new Error('SAP-C02 exam not found');
const examId = examRows[0].id;

const [rows] = await conn.execute(
  'SELECT id, source_question_no AS sourceQuestionNo, source_answer AS sourceAnswer FROM cert_questions WHERE exam_id = ? AND source = ? ORDER BY id ASC',
  [examId, 'pdf'],
);

const updates = [];
for (const row of rows) {
  const next = byNo.get(String(row.sourceQuestionNo));
  if (!next) continue;
  const nextAnswer = String(next.sourceAnswer || '').trim();
  const currentAnswer = String(row.sourceAnswer || '').trim();
  if (nextAnswer && nextAnswer !== currentAnswer) {
    updates.push({ id: row.id, sourceQuestionNo: row.sourceQuestionNo, from: currentAnswer, to: nextAnswer, explanation: next.explanation || null });
  }
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', dbRows: rows.length, jsonItems: items.length, updates: updates.length, sample: updates.slice(0, 20) }, null, 2));

if (apply && updates.length) {
  await conn.beginTransaction();
  try {
    for (const item of updates) {
      await conn.execute(
        'UPDATE cert_questions SET source_answer = ?, explanation = COALESCE(?, explanation), updated_at = UTC_TIMESTAMP() WHERE id = ?',
        [item.to, item.explanation, item.id],
      );
    }
    await conn.commit();
    console.log(`updated ${updates.length} rows`);
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}

await conn.end();
