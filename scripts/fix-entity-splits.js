#!/usr/bin/env node
/**
 * fix-entity-splits.js
 *
 * Surgically split merged entity profiles into their correct distinct individuals.
 * Uses verse_id ranges (based on book/chapter) to assign each verse mapping
 * to the correct entity.
 *
 * Entities fixed:
 *   1. Mosiah  → Mosiah I (Omni) + Mosiah II (Mosiah–Ether)
 *   2. Helaman → Helaman son of Benjamin + Helaman I (Alma) + Helaman II (Helaman–3 Nephi)
 *   3. Samuel  → Samuel OT prophet + Samuel the Lamanite
 *   4. Ammon   → Ammon explorer (Mosiah 7-8) + Ammon son of Mosiah (Alma+)
 */

const Database = require('better-sqlite3');
const path = require('path');

const TAGS_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-tags.db');
const SCRIP_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');

const db = new Database(TAGS_PATH);
const scrip = new Database(SCRIP_PATH, { readonly: true });
db.pragma('journal_mode = WAL');

// Helper: get verse_id range for a book
function bookVerseRange(bookTitle) {
  const row = scrip.prepare(`
    SELECT MIN(verse_id) as lo, MAX(verse_id) as hi
    FROM scriptures WHERE book_title = ?
  `).get(bookTitle);
  return row ? [row.lo, row.hi] : [0, 0];
}

// Helper: get verse_id range for a chapter
function chapterVerseRange(bookTitle, chapterNum) {
  const row = scrip.prepare(`
    SELECT MIN(s.verse_id) as lo, MAX(s.verse_id) as hi
    FROM scriptures s
    JOIN chapters c ON s.chapter_id = c.id
    JOIN books b ON c.book_id = b.id
    WHERE b.book_title = ? AND c.chapter_number = ?
  `).get(bookTitle, chapterNum);
  return row ? [row.lo, row.hi] : [0, 0];
}

// Helper: split entity
function splitEntity(oldEid, splits) {
  console.log(`\n── Splitting ${oldEid} ──`);

  // Get old profile
  const oldProf = db.prepare('SELECT * FROM ai_entity_profiles WHERE entity_id = ?').get(oldEid);
  if (!oldProf) { console.log('  ⚠ Profile not found, skipping'); return; }

  // Get all verse mappings
  const allMappings = db.prepare('SELECT verse_id, chapter_id FROM ai_entity_verse_map WHERE entity_id = ?').all(oldEid);
  console.log(`  Old profile: "${oldProf.name}" — ${oldProf.qualifier} (${allMappings.length} verses)`);

  const assigned = new Set();

  for (const split of splits) {
    const { entity_id, name, qualifier, description, versePredicate } = split;

    // Find verses for this split
    const verseRows = allMappings.filter(m => versePredicate(m.verse_id) && !assigned.has(m.verse_id));
    for (const m of verseRows) assigned.add(m.verse_id);

    if (verseRows.length === 0) {
      console.log(`  ${entity_id}: 0 verses (skipping profile creation)`);
      continue;
    }

    // Count distinct chapters
    const chapters = new Set(verseRows.map(r => r.chapter_id));

    // Insert or update profile
    const existing = db.prepare('SELECT entity_id FROM ai_entity_profiles WHERE entity_id = ?').get(entity_id);
    if (existing) {
      db.prepare('UPDATE ai_entity_profiles SET name=?, qualifier=?, description=?, chapter_count=?, verse_count=? WHERE entity_id=?')
        .run(name, qualifier, description, chapters.size, verseRows.length, entity_id);
    } else {
      db.prepare('INSERT INTO ai_entity_profiles (entity_id, name, type, qualifier, description, chapter_count, verse_count) VALUES (?,?,?,?,?,?,?)')
        .run(entity_id, name, oldProf.type, qualifier, description, chapters.size, verseRows.length);
    }

    // Move verse mappings
    const updateStmt = db.prepare('UPDATE ai_entity_verse_map SET entity_id = ? WHERE entity_id = ? AND verse_id = ?');
    db.transaction(() => {
      for (const m of verseRows) {
        updateStmt.run(entity_id, oldEid, m.verse_id);
      }
    })();

    console.log(`  ${entity_id}: "${name}" — ${qualifier} (${verseRows.length} verses, ${chapters.size} chapters)`);
  }

  // Handle any unassigned verses (keep with first split as fallback)
  const remaining = allMappings.filter(m => !assigned.has(m.verse_id));
  if (remaining.length > 0) {
    const fallbackEid = splits[0].entity_id;
    const updateStmt = db.prepare('UPDATE ai_entity_verse_map SET entity_id = ? WHERE entity_id = ? AND verse_id = ?');
    db.transaction(() => {
      for (const m of remaining) updateStmt.run(fallbackEid, oldEid, m.verse_id);
    })();
    // Update verse count
    const total = db.prepare('SELECT COUNT(*) as n FROM ai_entity_verse_map WHERE entity_id = ?').get(fallbackEid).n;
    db.prepare('UPDATE ai_entity_profiles SET verse_count = ? WHERE entity_id = ?').run(total, fallbackEid);
    console.log(`  ${remaining.length} unassigned verses → ${fallbackEid} (total now ${total})`);
  }

  // Delete old profile if different from all splits
  const splitEids = new Set(splits.map(s => s.entity_id));
  if (!splitEids.has(oldEid)) {
    const leftover = db.prepare('SELECT COUNT(*) as n FROM ai_entity_verse_map WHERE entity_id = ?').get(oldEid).n;
    if (leftover === 0) {
      db.prepare('DELETE FROM ai_entity_profiles WHERE entity_id = ?').run(oldEid);
      console.log(`  Deleted old profile ${oldEid}`);
    }
  }
}

// ── Verse ranges ──
const [omniLo, omniHi] = bookVerseRange('Omni');
const [mosLo, mosHi] = bookVerseRange('Mosiah');
const [almaLo, almaHi] = bookVerseRange('Alma');
const [helLo, helHi] = bookVerseRange('Helaman');
const [ne3Lo, ne3Hi] = bookVerseRange('3 Nephi');
const [etherLo, etherHi] = bookVerseRange('Ether');

// OT books for Samuel
const otBooks = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah',
  'Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah',
  'Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum',
  'Habakkuk','Zephaniah','Haggai','Zechariah','Malachi'];
const ntBooks = ['Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians',
  'Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians',
  '1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter',
  '1 John','2 John','3 John','Jude','Revelation'];

// Get OT+NT verse ranges
const otNtVerseIds = new Set();
for (const b of [...otBooks, ...ntBooks]) {
  const [lo, hi] = bookVerseRange(b);
  if (lo && hi) for (let v = lo; v <= hi; v++) otNtVerseIds.add(v);
}

// D&C + POGP
const [dcLo, dcHi] = bookVerseRange('Doctrine and Covenants');
const [mosesLo, mosesHi] = bookVerseRange('Moses');
const [abrahamLo, abrahamHi] = bookVerseRange('Abraham');
const [jshLo, jshHi] = bookVerseRange('Joseph Smith—History');
const [aofLo, aofHi] = bookVerseRange('Articles of Faith');

// Mosiah 1:2 specifically (Helaman son of Benjamin)
const [mos1_2Lo, mos1_2Hi] = chapterVerseRange('Mosiah', 1);

// Mosiah 7-8 (Ammon the explorer)
const [mos7Lo, mos7Hi] = chapterVerseRange('Mosiah', 7);
const [mos8Lo, mos8Hi] = chapterVerseRange('Mosiah', 8);
// Mosiah 21-22 also has Ammon the explorer
const [mos21Lo, mos21Hi] = chapterVerseRange('Mosiah', 21);
const [mos22Lo, mos22Hi] = chapterVerseRange('Mosiah', 22);

console.log(`Verse ranges loaded:`);
console.log(`  Omni: ${omniLo}–${omniHi}`);
console.log(`  Mosiah: ${mosLo}–${mosHi}`);
console.log(`  Alma: ${almaLo}–${almaHi}`);
console.log(`  Helaman: ${helLo}–${helHi}`);
console.log(`  3 Nephi: ${ne3Lo}–${ne3Hi}`);

// ═══════════════════════════════════════════════════════════════════════
//  1. MOSIAH: Split into Mosiah I and Mosiah II
// ═══════════════════════════════════════════════════════════════════════
// Mosiah I — Omni 1:12-24 (led Nephites from Nephi to Zarahemla)
// Mosiah II — Mosiah 1 onward (son of Benjamin, last king)
// Note: Mosiah 1:1-18 is Benjamin talking about Mosiah II, his son.

splitEntity('person:mosiah_king', [
  {
    entity_id: 'person:mosiah_i',
    name: 'Mosiah',
    qualifier: 'father of King Benjamin, led Nephites to Zarahemla',
    description: 'Mosiah I, a Nephite king who led his people from the land of Nephi to Zarahemla. Father of King Benjamin.',
    versePredicate: (vid) => vid >= omniLo && vid <= omniHi,
  },
  {
    entity_id: 'person:mosiah_ii',
    name: 'Mosiah',
    qualifier: 'son of King Benjamin, last Nephite king, father of Ammon, Aaron, Omner, and Himni',
    description: 'Mosiah II, son of King Benjamin. Last king of the Nephites. Established the system of judges. Father of Ammon, Aaron, Omner, and Himni.',
    versePredicate: (vid) => vid >= mosLo,  // Mosiah book onward
  },
]);

// ═══════════════════════════════════════════════════════════════════════
//  2. HELAMAN: Split into three
// ═══════════════════════════════════════════════════════════════════════
// Helaman son of Benjamin — Mosiah 1:2 only
// Helaman I (son of Alma the Younger) — Alma 31–63 (military leader, 2000 warriors)
// Helaman II (son of Helaman I) — Helaman 2 – 3 Nephi 1 (chief judge, prophet)

splitEntity('person:helaman_son_of_alma', [
  {
    entity_id: 'person:helaman_son_of_benjamin',
    name: 'Helaman',
    qualifier: 'son of King Benjamin',
    description: 'Helaman, one of the three sons of King Benjamin. Mentioned in Mosiah 1:2.',
    versePredicate: (vid) => vid >= mos1_2Lo && vid <= mos1_2Hi,  // Mosiah 1 only
  },
  {
    entity_id: 'person:helaman_son_of_alma',
    name: 'Helaman',
    qualifier: 'son of Alma the Younger, leader of the 2,000 stripling warriors',
    description: 'Helaman I, son of Alma the Younger. Led the 2,000 stripling warriors. Keeper of the sacred records. Prominent military and spiritual leader during the Nephite wars.',
    versePredicate: (vid) => vid >= almaLo && vid <= almaHi,  // Alma book
  },
  {
    entity_id: 'person:helaman_ii',
    name: 'Helaman',
    qualifier: 'son of Helaman I, chief judge and prophet, father of Nephi and Lehi',
    description: 'Helaman II, son of Helaman I. Served as chief judge. Father of Nephi and Lehi. Warned his sons to build upon the rock of Christ (Helaman 5:12).',
    versePredicate: (vid) => vid >= helLo,  // Helaman book onward
  },
]);

// ═══════════════════════════════════════════════════════════════════════
//  3. SAMUEL: Split OT prophet from Samuel the Lamanite
// ═══════════════════════════════════════════════════════════════════════

splitEntity('person:samuel_prophet', [
  {
    entity_id: 'person:samuel_ot_prophet',
    name: 'Samuel',
    qualifier: 'Old Testament prophet, last judge of Israel',
    description: 'Samuel, the Old Testament prophet. Son of Hannah and Elkanah. Last judge of Israel. Anointed both Saul and David as kings.',
    versePredicate: (vid) => otNtVerseIds.has(vid) || (vid >= dcLo && vid <= dcHi) || (vid >= mosesLo && vid <= aofHi),
  },
  {
    entity_id: 'person:samuel_the_lamanite',
    name: 'Samuel',
    qualifier: 'Lamanite prophet who prophesied of Christ from the city wall',
    description: 'Samuel the Lamanite, a prophet who stood upon the wall of Zarahemla and prophesied of the coming of Jesus Christ, including the signs of his birth and death.',
    versePredicate: (vid) => vid >= helLo,  // BOM books from Helaman onward
  },
]);

// ═══════════════════════════════════════════════════════════════════════
//  4. AMMON: Split explorer from son of Mosiah
// ═══════════════════════════════════════════════════════════════════════
// Ammon the explorer — Mosiah 7-8, 21-22 (sent by Limhi to find Zarahemla)
// Ammon son of Mosiah — Alma 17+ (missionary to the Lamanites)

splitEntity('person:ammon_missionary', [
  {
    entity_id: 'person:ammon_explorer',
    name: 'Ammon',
    qualifier: 'descendant of Zarahemla, sent by King Limhi to find Zarahemla',
    description: 'Ammon, a strong and mighty man, descendant of Zarahemla. Sent by King Limhi with 15 others to find the land of Zarahemla. Found King Mosiah.',
    versePredicate: (vid) =>
      (vid >= mos7Lo && vid <= mos8Hi) ||   // Mosiah 7-8
      (vid >= mos21Lo && vid <= mos22Hi),     // Mosiah 21-22
  },
  {
    entity_id: 'person:ammon_son_of_mosiah',
    name: 'Ammon',
    qualifier: 'son of King Mosiah II, missionary to the Lamanites',
    description: 'Ammon, son of King Mosiah II. One of the four sons of Mosiah who gave up the throne to serve as missionaries to the Lamanites. Known for defending King Lamoni\'s flocks.',
    versePredicate: (vid) => vid >= almaLo,  // Alma onward
  },
]);

// ═══════════════════════════════════════════════════════════════════════
//  5. Fix qualifier for existing profiles that are wrong
// ═══════════════════════════════════════════════════════════════════════

// Fix aaron_son_of_mosiah to reference Mosiah II specifically
db.prepare("UPDATE ai_entity_profiles SET qualifier = 'son of King Mosiah II, missionary to the Lamanites' WHERE entity_id = 'person:aaron_son_of_mosiah'").run();
console.log('\n  Fixed aaron_son_of_mosiah qualifier');

// Fix benjamin duplicates — merge into benjamin_king
const bens = db.prepare("SELECT entity_id, verse_count FROM ai_entity_profiles WHERE entity_id IN ('person:benjamin','person:benjamin_nephite_king','person:king_benjamin') AND type='person'").all();
if (bens.length > 0) {
  for (const b of bens) {
    if (b.entity_id !== 'person:benjamin_king') {
      db.prepare('UPDATE ai_entity_verse_map SET entity_id = ? WHERE entity_id = ?').run('person:benjamin_king', b.entity_id);
      db.prepare('DELETE FROM ai_entity_profiles WHERE entity_id = ?').run(b.entity_id);
      console.log(`  Merged ${b.entity_id} → person:benjamin_king`);
    }
  }
  const total = db.prepare("SELECT COUNT(*) as n FROM ai_entity_verse_map WHERE entity_id = 'person:benjamin_king'").get().n;
  db.prepare("UPDATE ai_entity_profiles SET verse_count = ?, qualifier = 'son of Mosiah I, father of Mosiah II, great Nephite king' WHERE entity_id = 'person:benjamin_king'").run(total);
  console.log(`  benjamin_king updated: ${total} verses`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Verify
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── Verification ──');
const verifyIds = [
  'person:mosiah_i', 'person:mosiah_ii',
  'person:helaman_son_of_benjamin', 'person:helaman_son_of_alma', 'person:helaman_ii',
  'person:samuel_ot_prophet', 'person:samuel_the_lamanite',
  'person:ammon_explorer', 'person:ammon_son_of_mosiah',
  'person:benjamin_king',
];
for (const eid of verifyIds) {
  const p = db.prepare('SELECT name, qualifier, verse_count FROM ai_entity_profiles WHERE entity_id = ?').get(eid);
  if (p) console.log(`  ${eid}: "${p.name}" — ${p.qualifier} (${p.verse_count}v)`);
  else console.log(`  ${eid}: NOT FOUND`);
}

// Check no orphaned verse_maps
const orphans = db.prepare(`
  SELECT COUNT(*) as n FROM ai_entity_verse_map m
  WHERE NOT EXISTS (SELECT 1 FROM ai_entity_profiles p WHERE p.entity_id = m.entity_id)
`).get().n;
console.log(`\n  Orphaned verse mappings: ${orphans}`);

db.close();
scrip.close();
console.log('\n✅ Entity splits complete');
