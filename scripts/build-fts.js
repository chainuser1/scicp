#!/usr/bin/env node
/**
 * build-fts.js — Ensures all 9 scripture .db files in resources/db/ have
 * pre-built FTS5 virtual tables (scriptures_fts).
 *
 * Uses the shared scripture-engine's initializeFts() so the schema
 * (tokenize = "porter ascii", same columns) is identical to what the
 * backend creates at runtime.
 *
 * Usage:
 *   node scripts/build-fts.js            # no-op if FTS tables already exist
 *   node scripts/build-fts.js --force    # drop + recreate all FTS tables
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { BetterSqliteAdapter } = require('../shared/db-adapter');
const { initializeFts } = require('../shared/scripture-engine');

const DB_DIR = path.resolve(__dirname, '../resources/db');
const FORCE = process.argv.includes('--force');

// All 9 DB files — labels match backend/index.js initializeFts calls
const DB_FILES = {
  'lds-scriptures-sqlite.db':      'English',
  'tagalog-scriptures-sqlite.db':  'Tagalog',
  'cebuano-scriptures-sqlite.db':  'Cebuano',
  'spanish-scriptures-sqlite.db':  'Spanish',
  'greek-scriptures-sqlite.db':    'Greek',
  'ilocano-scriptures-sqlite.db':  'Ilocano',
  'japanese-scriptures-sqlite.db': 'Japanese',
  'nrsvue-scriptures-sqlite.db':   'NRSVUE',
  'waray-scriptures-sqlite.db':    'Waray',
};

const log = {
  info:  (...args) => console.log(...args),
  warn:  (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

let processed = 0;
let skipped = 0;

console.log(`build-fts: scanning ${DB_DIR}`);
if (FORCE) console.log('  --force: will drop + recreate all FTS tables\n');

for (const [filename, label] of Object.entries(DB_FILES)) {
  const dbPath = path.join(DB_DIR, filename);
  if (!fs.existsSync(dbPath)) {
    console.warn(`  SKIP ${filename} (file not found)`);
    skipped++;
    continue;
  }

  console.log(`\n--- ${label} (${filename}) ---`);
  const raw = new Database(dbPath);
  const adapter = new BetterSqliteAdapter(raw);

  initializeFts(adapter, label, { forceRebuild: FORCE, log });

  raw.close();
  processed++;
}

console.log(`\nDone: ${processed} processed, ${skipped} skipped.`);
