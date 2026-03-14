#!/usr/bin/env node
/**
 * Compute named entities (people + places) for every English verse using Compromise.js
 * and store them in resources/db/verse-tags.db.
 *
 * Run once locally:  node scripts/compute-entities.js
 * Takes ~2-5 minutes for ~41,000 verses.
 */
const path = require('path');
const Database = require('better-sqlite3');
const nlp = require('compromise');

const DB_DIR   = path.resolve(__dirname, '../resources/db');
const db       = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true });
const db_tags  = new Database(path.join(DB_DIR, 'verse-tags.db'));

db_tags.exec(`
  CREATE TABLE IF NOT EXISTS verse_entities (
    verse_id      INTEGER PRIMARY KEY,
    people        TEXT,
    places        TEXT,
    entities_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_entity_people ON verse_entities(people);
  CREATE INDEX IF NOT EXISTS idx_entity_places ON verse_entities(places);
`);

const verses = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all();
console.log(`Processing ${verses.length} verses…`);

const ins = db_tags.prepare(`
  INSERT OR REPLACE INTO verse_entities (verse_id, people, places, entities_json)
  VALUES (?, ?, ?, ?)
`);

const batchInsert = db_tags.transaction((items) => {
  for (const item of items) ins.run(item.verse_id, item.people, item.places, item.entities_json);
});

const BATCH = 500;
let done = 0;
let batch = [];

for (const v of verses) {
  const doc = nlp(v.scripture_text);
  const people = [...new Set(doc.people().out('array').map(p => p.trim()).filter(p => p.length > 1 && p.length < 40))];
  const places = [...new Set(doc.places().out('array').map(p => p.trim()).filter(p => p.length > 1 && p.length < 40))];
  const all = {
    people,
    places,
    // Also grab generic proper nouns not caught by people/places
    nouns: doc.nouns().toTitleCase().out('array').filter(n => n.length > 2).slice(0, 10),
  };
  batch.push({
    verse_id:     v.verse_id,
    people:       people.join('|'),
    places:       places.join('|'),
    entities_json: JSON.stringify(all),
  });
  done++;
  if (batch.length >= BATCH) {
    batchInsert(batch);
    batch = [];
    process.stdout.write(`\r${done}/${verses.length}`);
  }
}
if (batch.length) { batchInsert(batch); }
console.log(`\nDone. ${done} verses processed.`);
db.close();
db_tags.close();
