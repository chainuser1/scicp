#!/usr/bin/env node
// Pre-bake IDF (Inverse Document Frequency) table into lds-scriptures-sqlite.db
// Eliminates runtime buildIdfTable() computation

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const TOTAL_DOCS = 41995;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create term_idf table
db.exec(`
  DROP TABLE IF EXISTS term_idf;
  CREATE TABLE term_idf (
    term TEXT PRIMARY KEY,
    doc_freq INTEGER NOT NULL,
    idf REAL NOT NULL
  );
`);

// Read from pre-baked FTS5 vocabulary
const rows = db.prepare('SELECT term, doc FROM scriptures_fts_vocab').all();
console.log(`  ${rows.length} vocabulary terms from scriptures_fts_vocab`);

const insert = db.prepare('INSERT INTO term_idf (term, doc_freq, idf) VALUES (?, ?, ?)');
const tx = db.transaction(() => {
  for (const { term, doc } of rows) {
    const idf = Math.log((TOTAL_DOCS + 1) / (doc + 1)) + 1;
    insert.run(term, doc, +idf.toFixed(6));
  }
});
tx();

// Create index for fast lookup
db.exec('CREATE INDEX IF NOT EXISTS idx_term_idf_term ON term_idf(term)');

const count = db.prepare('SELECT COUNT(*) AS n FROM term_idf').get().n;
console.log(`✅ IDF table built: ${count} terms in lds-scriptures-sqlite.db`);

// Spot check
const samples = db.prepare("SELECT term, doc_freq, idf FROM term_idf WHERE term IN ('faith', 'melchizedek', 'the', 'repentance') ORDER BY idf DESC").all();
for (const s of samples) {
  console.log(`   ${s.term.padEnd(15)} df=${String(s.doc_freq).padStart(5)}  idf=${s.idf.toFixed(4)}`);
}

db.close();
