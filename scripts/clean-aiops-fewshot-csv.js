#!/usr/bin/env node

/**
 * Clean AI-Ops few-shot CSV files and write normalized files into import directory.
 *
 * Usage:
 *   node scripts/clean-aiops-fewshot-csv.js
 *   node scripts/clean-aiops-fewshot-csv.js --in docs/ai-ops-fewshot-data --out docs/ai-ops-fewshot-data/import
 *   node scripts/clean-aiops-fewshot-csv.js --only nl2sql_fewshot_cases.csv,table_dictionary.csv
 */

const fs = require('fs');
const path = require('path');

const FILE_SPECS = {
  'nl2sql_fewshot_cases.csv': {
    headers: [
      'case_id',
      'priority',
      'business_domain',
      'intent_type',
      'user_question',
      'expected_sql',
      'expected_output_shape',
      'must_conditions',
      'forbidden_patterns',
      'allowed_databases',
      'allowed_tables',
      'default_limit',
      'max_limit',
      'time_range_hint',
      'review_status',
      'owner',
      'reviewer',
      'last_updated',
      'notes',
    ],
    required: ['case_id', 'user_question', 'expected_sql'],
  },
  'table_dictionary.csv': {
    headers: [
      'database_name',
      'table_name',
      'column_name',
      'data_type',
      'is_nullable',
      'is_primary_key',
      'is_indexed',
      'is_join_key',
      'is_filter_hot',
      'business_meaning',
      'sample_values',
      'pii_level',
      'aliases',
      'owner',
      'last_updated',
      'notes',
    ],
    required: ['database_name', 'table_name', 'column_name', 'business_meaning'],
  },
  'join_relations.csv': {
    headers: [
      'relation_id',
      'left_database',
      'left_table',
      'left_column',
      'right_database',
      'right_table',
      'right_column',
      'join_type',
      'typical_query_purpose',
      'notes',
    ],
    required: [
      'relation_id',
      'left_database',
      'left_table',
      'left_column',
      'right_database',
      'right_table',
      'right_column',
    ],
  },
  'enum_dictionary.csv': {
    headers: [
      'enum_id',
      'database_name',
      'table_name',
      'column_name',
      'enum_value',
      'enum_label',
      'business_description',
      'notes',
    ],
    required: [
      'enum_id',
      'database_name',
      'table_name',
      'column_name',
      'enum_value',
      'enum_label',
    ],
  },
  'nl2mongo_fewshot_cases.csv': {
    headers: [
      'case_id',
      'priority',
      'business_domain',
      'intent_type',
      'user_question',
      'expected_mongo_statement',
      'expected_output_shape',
      'must_conditions',
      'forbidden_patterns',
      'allowed_databases',
      'allowed_collections',
      'default_limit',
      'max_limit',
      'time_range_hint',
      'review_status',
      'owner',
      'reviewer',
      'last_updated',
      'notes',
    ],
    required: ['case_id', 'user_question', 'expected_mongo_statement'],
  },
  'mongo_collection_dictionary.csv': {
    headers: [
      'database_name',
      'collection_name',
      'field_path',
      'bson_type',
      'is_nullable',
      'is_indexed',
      'is_filter_hot',
      'business_meaning',
      'sample_values',
      'pii_level',
      'aliases',
      'owner',
      'last_updated',
      'notes',
    ],
    required: ['database_name', 'collection_name', 'field_path', 'business_meaning'],
  },
  'mongo_relations.csv': {
    headers: [
      'relation_id',
      'left_database',
      'left_collection',
      'left_field_path',
      'right_database',
      'right_collection',
      'right_field_path',
      'relation_type',
      'preferred_pattern',
      'typical_query_purpose',
      'notes',
    ],
    required: [
      'relation_id',
      'left_database',
      'left_collection',
      'left_field_path',
      'right_database',
      'right_collection',
      'right_field_path',
    ],
  },
  'mongo_enum_dictionary.csv': {
    headers: [
      'enum_id',
      'database_name',
      'collection_name',
      'field_path',
      'enum_value',
      'enum_label',
      'business_description',
      'notes',
    ],
    required: [
      'enum_id',
      'database_name',
      'collection_name',
      'field_path',
      'enum_value',
      'enum_label',
    ],
  },
};

const IDENTIFIER_COLUMNS = new Set([
  'database_name',
  'table_name',
  'collection_name',
  'column_name',
  'field_path',
  'left_database',
  'left_table',
  'left_column',
  'left_collection',
  'left_field_path',
  'right_database',
  'right_table',
  'right_column',
  'right_collection',
  'right_field_path',
  'allowed_databases',
  'allowed_tables',
  'allowed_collections',
  'pii_level',
  'priority',
  'join_type',
  'relation_type',
  'review_status',
  'intent_type',
]);

function parseArgs(argv) {
  const args = { inDir: 'docs/ai-ops-fewshot-data', outDir: 'docs/ai-ops-fewshot-data/import', only: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') {
      args.inDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--out') {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--only') {
      const raw = String(argv[i + 1] || '').trim();
      args.only = raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : [];
      i += 1;
      continue;
    }
  }
  return args;
}

function normalizeHeaderKey(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function parseCsv(csvText) {
  const text = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function toCsv(rows) {
  const escaped = rows.map((row) =>
    row
      .map((cell) => {
        const value = String(cell ?? '');
        if (/["\n,]/.test(value)) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(','),
  );
  return `${escaped.join('\n')}\n`;
}

function normalizeMultiValue(value) {
  return String(value || '')
    .replace(/[，、；]/g, ';')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*,\s*/g, ';')
    .replace(/;+$/g, '')
    .replace(/^;+/, '')
    .trim()
    .toLowerCase();
}

function normalizeCellByHeader(header, value) {
  const raw = String(value || '').replace(/\u00A0/g, ' ').trim();
  if (!raw) return '';

  if (header === 'allowed_databases' || header === 'allowed_tables' || header === 'allowed_collections') {
    return normalizeMultiValue(raw);
  }
  if (header === 'must_conditions' || header === 'forbidden_patterns') {
    return normalizeMultiValue(raw);
  }
  if (header === 'review_status') {
    const v = raw.toLowerCase();
    if (['draft', 'reviewed', 'approved'].includes(v)) return v;
    return v;
  }
  if (header === 'priority') {
    return raw.toUpperCase();
  }
  if (IDENTIFIER_COLUMNS.has(header)) {
    return raw.toLowerCase();
  }
  return raw;
}

function checkRowWarnings(fileName, headers, row, lineNo) {
  const warnings = [];
  const col = (name) => row[headers.indexOf(name)] || '';

  if (fileName === 'nl2sql_fewshot_cases.csv') {
    const sql = col('expected_sql').toLowerCase();
    if (sql && !/^(select|show|explain|with)\b/.test(sql)) {
      warnings.push(`line ${lineNo}: expected_sql is not read-only SQL`);
    }
    if (sql && /\b(from|join)\s+[a-z_][a-z0-9_]*\b/.test(sql) && !/\b(from|join)\s+[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\b/.test(sql)) {
      warnings.push(`line ${lineNo}: possible unqualified table reference in expected_sql`);
    }
  }

  if (fileName === 'table_dictionary.csv') {
    const dataType = col('data_type');
    if (dataType && /\s/.test(dataType)) {
      warnings.push(`line ${lineNo}: data_type contains spaces, please double-check`);
    }
  }
  return warnings;
}

function cleanFile(fileName, inDir, outDir) {
  const inputPath = path.resolve(inDir, fileName);
  const outputPath = path.resolve(outDir, fileName);
  const spec = FILE_SPECS[fileName];
  const report = {
    file: fileName,
    inputPath,
    outputPath,
    exists: fs.existsSync(inputPath),
    rowCountInput: 0,
    rowCountOutput: 0,
    droppedEmptyRows: 0,
    warnings: [],
    skipped: false,
  };

  if (!report.exists) {
    report.skipped = true;
    report.warnings.push('file not found, skipped');
    return report;
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCsv(raw);
  report.rowCountInput = Math.max(parsed.length - 1, 0);
  if (parsed.length === 0) {
    report.skipped = true;
    report.warnings.push('empty file');
    return report;
  }

  const sourceHeader = parsed[0].map(normalizeHeaderKey);
  const sourceIndexByHeader = new Map();
  sourceHeader.forEach((h, idx) => sourceIndexByHeader.set(h, idx));

  const missingHeader = spec.headers.filter((h) => !sourceIndexByHeader.has(h));
  if (missingHeader.length > 0) {
    report.warnings.push(`missing header(s): ${missingHeader.join(', ')}`);
  }

  const outputRows = [spec.headers.slice()];
  for (let i = 1; i < parsed.length; i += 1) {
    const inputRow = parsed[i] || [];
    const rawJoined = inputRow.join('').trim();
    if (!rawJoined) {
      report.droppedEmptyRows += 1;
      continue;
    }

    const row = spec.headers.map((header) => {
      const idx = sourceIndexByHeader.get(header);
      const value = typeof idx === 'number' && idx >= 0 ? inputRow[idx] : '';
      return normalizeCellByHeader(header, value);
    });

    const isAllEmpty = row.every((v) => !String(v || '').trim());
    if (isAllEmpty) {
      report.droppedEmptyRows += 1;
      continue;
    }

    for (const requiredHeader of spec.required) {
      const idx = spec.headers.indexOf(requiredHeader);
      if (idx >= 0 && !row[idx]) {
        report.warnings.push(`line ${i + 1}: missing required field "${requiredHeader}"`);
      }
    }

    report.warnings.push(...checkRowWarnings(fileName, spec.headers, row, i + 1));
    outputRows.push(row);
  }

  report.rowCountOutput = Math.max(outputRows.length - 1, 0);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCsv(outputRows), 'utf8');
  return report;
}

function main() {
  const args = parseArgs(process.argv);
  const inDir = path.resolve(args.inDir);
  const outDir = path.resolve(args.outDir);

  const files = args.only && args.only.length > 0 ? args.only : Object.keys(FILE_SPECS);
  const unknown = files.filter((name) => !FILE_SPECS[name]);
  if (unknown.length > 0) {
    console.error(`Unknown file spec: ${unknown.join(', ')}`);
    process.exit(1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inDir,
    outDir,
    files: [],
  };

  for (const fileName of files) {
    report.files.push(cleanFile(fileName, inDir, outDir));
  }

  const reportPath = path.resolve(outDir, 'clean-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const totalWarnings = report.files.reduce((sum, file) => sum + file.warnings.length, 0);
  console.log(`Cleaned ${report.files.length} file(s). Output directory: ${outDir}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Total warnings: ${totalWarnings}`);

  for (const file of report.files) {
    console.log(
      `- ${file.file}: input=${file.rowCountInput}, output=${file.rowCountOutput}, droppedEmpty=${file.droppedEmptyRows}, warnings=${file.warnings.length}${file.skipped ? ' (skipped)' : ''}`,
    );
  }
}

main();
