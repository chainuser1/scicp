#!/usr/bin/env node
/**
 * Pre-bake doctrinal/POV classification tags for every English verse using
 * Xenova/distilbert-base-uncased-mnli (zero-shot classification).
 *
 * Run once locally:  node scripts/compute-tags.js
 * Takes ~10-30 minutes depending on CPU. Results stored in verse-tags.db.
 * 
 * POV labels:  "spoken by God", "spoken by prophet", "narrative", "prayer"
 * Doctrine labels: "faith", "repentance", "grace", "judgment", "love",
 *                  "resurrection", "eternal life", "covenants", "obedience"
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR   = path.resolve(__dirname, '../resources/db');
const db       = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true });
const db_tags  = new Database(path.join(DB_DIR, 'verse-tags.db'));

db_tags.exec(`
  CREATE TABLE IF NOT EXISTS verse_doctrine_tags (
    verse_id    INTEGER PRIMARY KEY,
    pov         TEXT,
    labels_json TEXT
  );
`);

const POV_LABELS      = ['spoken by God', 'spoken by a prophet', 'historical narrative', 'prayer or praise'];
const DOCTRINE_LABELS = ['faith', 'repentance', 'grace', 'judgment', 'love', 'resurrection', 'eternal life', 'covenants', 'obedience'];
const THRESHOLD       = 0.25; // minimum score to include a doctrine label

const ins = db_tags.prepare(`
  INSERT OR REPLACE INTO verse_doctrine_tags (verse_id, pov, labels_json)
  VALUES (?, ?, ?)
`);

const batchInsert = db_tags.transaction((items) => {
  for (const item of items) ins.run(item.verse_id, item.pov, item.labels_json);
});

async function main() {
  const { pipeline } = await import('@xenova/transformers');
  console.log('Loading DistilBERT MNLI pipeline…');
  const classifier = await pipeline('zero-shot-classification', 'Xenova/distilbert-base-uncased-mnli');
  console.log('Pipeline ready.');

  const already = new Set(db_tags.prepare('SELECT verse_id FROM verse_doctrine_tags').all().map(r => r.verse_id));
  const verses   = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all()
                     .filter(v => !already.has(v.verse_id));
  console.log(`Computing tags for ${verses.length} verses (${already.size} already done)…`);

  const BATCH = 50;
  let done = 0;
  let batch = [];

  for (const v of verses) {
    // POV classification
    const povResult  = await classifier(v.scripture_text, POV_LABELS, { multi_label: false });
    const pov        = povResult.labels[0]; // top label

    // Doctrine classification (multi-label)
    const docResult  = await classifier(v.scripture_text, DOCTRINE_LABELS, { multi_label: true });
    const labels     = docResult.labels
      .map((lbl, i) => ({ label: lbl, score: docResult.scores[i] }))
      .filter(x => x.score >= THRESHOLD)
      .sort((a, b) => b.score - a.score);

    batch.push({ verse_id: v.verse_id, pov, labels_json: JSON.stringify(labels) });
    done++;

    if (batch.length >= BATCH) {
      batchInsert(batch);
      batch = [];
      process.stdout.write(`\r${done + already.size}/${verses.length + already.size}`);
    }
  }
  if (batch.length) batchInsert(batch);
  console.log(`\nDone. ${done} verses tagged.`);
  db.close();
  db_tags.close();
}

main().catch(err => { console.error(err); process.exit(1); });
