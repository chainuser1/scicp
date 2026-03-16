#!/usr/bin/env node
// Pre-bake normalized entity search indexes into verse-tags.db
// Eliminates runtime buildEntityCache() JSON parsing and normalization

const Database = require('better-sqlite3');
const path = require('path');

const TAGS_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-tags.db');
const MAIN_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');

const tagsDb = new Database(TAGS_PATH);
const mainDb = new Database(MAIN_PATH, { readonly: true });
tagsDb.pragma('journal_mode = WAL');

function normalizeEntityName(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// Create pre-baked tables
tagsDb.exec(`
  DROP TABLE IF EXISTS entity_person_index;
  DROP TABLE IF EXISTS entity_place_index;
  DROP TABLE IF EXISTS verse_entity_cache;

  CREATE TABLE entity_person_index (
    name_normalized TEXT NOT NULL,
    verse_id INTEGER NOT NULL,
    PRIMARY KEY (name_normalized, verse_id)
  );

  CREATE TABLE entity_place_index (
    name_normalized TEXT NOT NULL,
    verse_id INTEGER NOT NULL,
    PRIMARY KEY (name_normalized, verse_id)
  );

  CREATE TABLE verse_entity_cache (
    verse_id INTEGER PRIMARY KEY,
    people TEXT NOT NULL DEFAULT '[]',
    places TEXT NOT NULL DEFAULT '[]'
  );
`);

// Get chapter → verse mapping from main DB
const chapterVerses = {};
const rows = mainDb.prepare('SELECT id, chapter_id FROM verses').all();
for (const { id, chapter_id } of rows) {
  if (!chapterVerses[chapter_id]) chapterVerses[chapter_id] = [];
  chapterVerses[chapter_id].push(id);
}
console.log(`  ${Object.keys(chapterVerses).length} chapters mapped`);

// Read chapter_entities from verse-tags.db
const chapters = tagsDb.prepare('SELECT chapter_id, entities_json FROM chapter_entities').all();
console.log(`  ${chapters.length} chapters with entity data`);

const personIndex = new Map(); // normalized_name → Set<verse_id>
const placeIndex = new Map();
const verseEntities = new Map(); // verse_id → {people: Set, places: Set}

for (const { chapter_id, entities_json } of chapters) {
  let entities;
  try { entities = JSON.parse(entities_json); } catch { continue; }
  const verseIds = chapterVerses[chapter_id] || [];
  if (verseIds.length === 0) continue;

  const people = entities.people || entities.People || [];
  const places = entities.places || entities.Places || [];

  for (const name of people) {
    const norm = normalizeEntityName(name);
    if (!norm) continue;
    if (!personIndex.has(norm)) personIndex.set(norm, new Set());
    for (const vid of verseIds) {
      personIndex.get(norm).add(vid);
      if (!verseEntities.has(vid)) verseEntities.set(vid, { people: new Set(), places: new Set() });
      verseEntities.get(vid).people.add(name);
    }
  }

  for (const name of places) {
    const norm = normalizeEntityName(name);
    if (!norm) continue;
    if (!placeIndex.has(norm)) placeIndex.set(norm, new Set());
    for (const vid of verseIds) {
      placeIndex.get(norm).add(vid);
      if (!verseEntities.has(vid)) verseEntities.set(vid, { people: new Set(), places: new Set() });
      verseEntities.get(vid).places.add(name);
    }
  }
}

// Insert person index
const insertPerson = tagsDb.prepare('INSERT OR IGNORE INTO entity_person_index (name_normalized, verse_id) VALUES (?, ?)');
const insertPlace = tagsDb.prepare('INSERT OR IGNORE INTO entity_place_index (name_normalized, verse_id) VALUES (?, ?)');
const insertVerse = tagsDb.prepare('INSERT OR REPLACE INTO verse_entity_cache (verse_id, people, places) VALUES (?, ?, ?)');

const tx = tagsDb.transaction(() => {
  let personRows = 0, placeRows = 0;
  for (const [name, verseIds] of personIndex) {
    for (const vid of verseIds) { insertPerson.run(name, vid); personRows++; }
  }
  for (const [name, verseIds] of placeIndex) {
    for (const vid of verseIds) { insertPlace.run(name, vid); placeRows++; }
  }
  for (const [vid, ent] of verseEntities) {
    insertVerse.run(vid, JSON.stringify([...ent.people]), JSON.stringify([...ent.places]));
  }
  console.log(`  ${personRows} person-verse pairs, ${placeRows} place-verse pairs`);
  console.log(`  ${verseEntities.size} verses with entity data`);
});
tx();

// Indexes for search
tagsDb.exec(`
  CREATE INDEX IF NOT EXISTS idx_epi_name ON entity_person_index(name_normalized);
  CREATE INDEX IF NOT EXISTS idx_epli_name ON entity_place_index(name_normalized);
`);

console.log(`✅ Entity indexes built: ${personIndex.size} people, ${placeIndex.size} places`);
tagsDb.close();
mainDb.close();
