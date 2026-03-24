#!/usr/bin/env node
/**
 * Export topical-guide training pairs to JSON for Colab fine-tuning.
 *
 * Output: resources/training-pairs.json
 *   [ { "anchor": "Faith", "positive": "Now faith is the substance of things hoped for..." }, ... ]
 *
 * Upload this file to your Google Colab session, then run the notebook.
 *
 * Usage:
 *   node scripts/export-training-pairs.js
 */

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const ROOT    = path.join(__dirname, '..');
const DB_MAIN = path.join(ROOT, 'resources/db/lds-scriptures-sqlite.db');
const DB_TG   = path.join(ROOT, 'resources/db/topical-guide.db');
const OUT     = path.join(ROOT, 'resources/training-pairs.json');

const main = Database(DB_MAIN, { readonly: true });
const tg   = Database(DB_TG,   { readonly: true });

// verse_id → scripture_text
const verses = new Map();
for (const r of main.prepare('SELECT id, scripture_text FROM verses').all())
  verses.set(r.id, r.scripture_text);

// topic_id → topic name
const topics = new Map();
for (const r of tg.prepare('SELECT id, name FROM topics').all())
  topics.set(r.id, r.name);

// Build (anchor=topic_name, positive=verse_text) pairs
const pairs = [];
for (const r of tg.prepare('SELECT topic_id, verse_id FROM topical_guide').all()) {
  const topic = topics.get(r.topic_id);
  const verse = verses.get(r.verse_id);
  if (topic && verse && verse.length > 20)
    pairs.push({ anchor: topic, positive: verse });
}

// Shuffle deterministically
pairs.sort(() => Math.random() - 0.5);

fs.writeFileSync(OUT, JSON.stringify(pairs, null, 0));
console.log(`Exported ${pairs.length.toLocaleString()} pairs → ${OUT}`);
console.log(`File size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
console.log('Next: upload resources/training-pairs.json to Google Colab');

main.close();
tg.close();
