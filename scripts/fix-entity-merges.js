#!/usr/bin/env node
/**
 * fix-entity-merges.js
 *
 * Merge duplicate entity profiles that refer to the same individual.
 * The AI extraction created separate profiles for the same person
 * with slightly different entity_ids or qualifiers.
 */

const Database = require('better-sqlite3');
const path = require('path');

const TAGS_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-tags.db');
const db = new Database(TAGS_PATH);
db.pragma('journal_mode = WAL');

let mergeCount = 0;

function mergeInto(keepEid, absorbEids, newName, newQualifier, newDescription) {
  const keep = db.prepare('SELECT * FROM ai_entity_profiles WHERE entity_id = ?').get(keepEid);
  if (!keep) { console.log(`  ⚠ ${keepEid} not found, skipping`); return; }

  for (const absorbEid of absorbEids) {
    const absorb = db.prepare('SELECT * FROM ai_entity_profiles WHERE entity_id = ?').get(absorbEid);
    if (!absorb) continue;

    // Move verse mappings (skip duplicates via INSERT OR IGNORE)
    const mappings = db.prepare('SELECT verse_id, chapter_id FROM ai_entity_verse_map WHERE entity_id = ?').all(absorbEid);
    const ins = db.prepare('INSERT OR IGNORE INTO ai_entity_verse_map (entity_id, verse_id, chapter_id) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (const m of mappings) ins.run(keepEid, m.verse_id, m.chapter_id);
    })();

    // Delete old mappings and profile
    db.prepare('DELETE FROM ai_entity_verse_map WHERE entity_id = ?').run(absorbEid);
    db.prepare('DELETE FROM ai_entity_profiles WHERE entity_id = ?').run(absorbEid);
    console.log(`  Merged ${absorbEid} (${absorb.verse_count}v) → ${keepEid}`);
    mergeCount++;
  }

  // Update profile
  const total = db.prepare('SELECT COUNT(*) as n FROM ai_entity_verse_map WHERE entity_id = ?').get(keepEid).n;
  const chapters = db.prepare('SELECT COUNT(DISTINCT chapter_id) as n FROM ai_entity_verse_map WHERE entity_id = ?').get(keepEid).n;
  if (newName) db.prepare('UPDATE ai_entity_profiles SET name = ? WHERE entity_id = ?').run(newName, keepEid);
  if (newQualifier) db.prepare('UPDATE ai_entity_profiles SET qualifier = ? WHERE entity_id = ?').run(newQualifier, keepEid);
  if (newDescription) db.prepare('UPDATE ai_entity_profiles SET description = ? WHERE entity_id = ?').run(newDescription, keepEid);
  db.prepare('UPDATE ai_entity_profiles SET verse_count = ?, chapter_count = ? WHERE entity_id = ?').run(total, chapters, keepEid);
  console.log(`  → ${keepEid}: ${total}v, ${chapters} chapters`);
}

function fixQualifier(eid, qualifier, description) {
  const r = db.prepare('UPDATE ai_entity_profiles SET qualifier = ?, description = ? WHERE entity_id = ?').run(qualifier, description, eid);
  if (r.changes) console.log(`  Fixed ${eid} qualifier`);
}

console.log('=== Merging duplicate entities ===\n');

// ── David: 3 profiles → 1 ──
console.log('David:');
mergeInto('person:david_king_of_israel',
  ['person:david_son_of_jesse', 'person:david_king_of_judah'],
  'David', 'king of Israel, son of Jesse',
  'David, son of Jesse, shepherd, warrior, poet, king of Israel and Judah. Ancestor of Jesus Christ.');

// ── Daniel: 3 duplicates for the same prophet → 1 ──
console.log('\nDaniel:');
mergeInto('person:daniel_prophet',
  ['person:daniel', 'person:daniel_bible'],
  'Daniel', 'prophet, interpreter of dreams and visions',
  'Daniel, Hebrew prophet who served in the courts of Babylon. Known for the lion\'s den, interpreting Nebuchadnezzar\'s dreams, and apocalyptic visions.');

// ── Ammoron: 2 → 1 ──
console.log('\nAmmoron:');
mergeInto('person:ammoron_lamanite_king',
  ['person:ammoron'],
  'Ammoron', 'Lamanite king, brother of Amalickiah',
  'Ammoron, brother of Amalickiah. Became king of the Lamanites after Amalickiah\'s death. Commanded the Lamanite armies against the Nephites.');

// ── Akish: 2 → 1 ──
console.log('\nAkish:');
mergeInto('person:akish',
  ['person:akish_jaredite'],
  'Akish', 'Jaredite king and conspirator, son of Kimnor',
  'Akish, son of Kimnor. A Jaredite who established secret combinations and conspired for power.');

// ── Asaph: likely all the same Levite musician (1 Chronicles era) ──
console.log('\nAsaph:');
mergeInto('person:asaph_son_of_berechiah',
  ['person:asaph_singer', 'person:asaph_levite', 'person:asaph_ancestor', 'person:asaph'],
  'Asaph', 'Levite, son of Berechiah, chief musician and psalmist',
  'Asaph, son of Berechiah. Levite chief musician appointed by David. Author of Psalms 50, 73-83.');
// Note: asaph_father_of_joah and asaph_keeper are likely different people, keep them separate.

// ── Lehi: merge patriarch duplicates (lehi, lehi_nephite_patriarch, lehi_patriarch are same person) ──
console.log('\nLehi (patriarch):');
mergeInto('person:lehi',
  ['person:lehi_nephite_patriarch', 'person:lehi_patriarch'],
  'Lehi', 'Nephite patriarch, prophet, father of Nephi, Sam, Jacob, Joseph, Laman, and Lemuel',
  'Lehi, a prophet who led his family from Jerusalem to the promised land around 600 BC. Father of Nephi, Sam, Jacob, Joseph, Laman, and Lemuel.');

// ── Lehi son of Helaman: merge duplicates ──
console.log('\nLehi (son of Helaman):');
mergeInto('person:lehi_son_of_helaman',
  ['person:lehi_son_of_helaman2'],
  'Lehi', 'son of Helaman II, brother of Nephi, missionary',
  'Lehi, son of Helaman II. Brother of Nephi. Together they were cast into prison and delivered by God with fire (Helaman 5).');

// ── Benjamin son of Jacob vs tribal leader (both OT Benjamin) ──
console.log('\nBenjamin (OT):');
mergeInto('person:benjamin_son_of_jacob',
  ['person:benjamin_tribal_leader', 'person:benjamin_tribe'],
  'Benjamin', 'youngest son of Jacob and Rachel, ancestor of the tribe of Benjamin',
  'Benjamin, youngest son of Jacob and Rachel. His birth caused Rachel\'s death. Ancestor of the tribe of Benjamin, Saul, and the apostle Paul.');

// ── Pharaoh: merge person:pharaoh + title:pharaoh (both refer to rulers of Egypt generically) ──
// Actually these should stay separate — one is a person type, one is a title type. Skip.

// ── Fix wrong qualifiers ──
console.log('\n=== Fixing qualifiers ===');

fixQualifier('person:jesus_christ', 'Jesus Christ, Son of God, Savior and Redeemer',
  'Jesus Christ, the Son of God. Known as Jehovah in the Old Testament, the Messiah, the Lamb of God. Central figure of all scripture.');

fixQualifier('person:god_the_father', 'Heavenly Father, Elohim, Creator',
  'God the Eternal Father. Creator of heaven and earth. Father of the spirits of all mankind.');

fixQualifier('person:holy_ghost', 'the Holy Ghost, third member of the Godhead',
  'The Holy Ghost, also called the Holy Spirit, Spirit of God, or Comforter. Third member of the Godhead. A personage of spirit.');

fixQualifier('person:jacob', 'son of Isaac and Rebekah, father of the twelve tribes of Israel',
  'Jacob, later named Israel. Son of Isaac and Rebekah. Father of twelve sons who became the twelve tribes of Israel.');

fixQualifier('person:joseph_smith', 'Prophet, founder of The Church of Jesus Christ of Latter-day Saints',
  'Joseph Smith Jr., the Prophet. Translated the Book of Mormon, received revelations, and organized The Church of Jesus Christ of Latter-day Saints in 1830.');

fixQualifier('person:nephi_son_of_lehi', 'son of Lehi, prophet, author of 1 Nephi and 2 Nephi',
  'Nephi, son of Lehi and Sariah. Faithful prophet who led his family to the promised land. Author of 1 Nephi and 2 Nephi.');

fixQualifier('person:alma_the_younger', 'son of Alma the Elder, prophet and first chief judge of the Nephites',
  'Alma the Younger, son of Alma the Elder. Initially rebelled against the church but was converted by an angel. Became the first chief judge and high priest of the Nephites.');

fixQualifier('person:moroni_captain', 'Captain Moroni, chief captain of the Nephite armies',
  'Captain Moroni, chief captain of the Nephite armies. Known for the Title of Liberty. Led the Nephites during many wars against the Lamanites (Alma 43-62).');

fixQualifier('person:moroni_son_of_mormon', 'son of Mormon, last Nephite prophet, abridger and sealer of the Book of Mormon',
  'Moroni, son of Mormon. The last Nephite prophet. Completed his father\'s record, added the book of Ether and his own book of Moroni. Buried the gold plates and later appeared to Joseph Smith as an angel.');

// ── Fix Lehi brother of Nephi (this is actually Lehi the military leader, companion of Moroni) ──
console.log('\nLehi (military):');
mergeInto('person:lehi_nephite_leader',
  ['person:lehi_brother_of_nephi'],
  'Lehi', 'Nephite military leader, companion of Captain Moroni',
  'Lehi, a Nephite military leader and captain. Served alongside Captain Moroni during the wars with the Lamanites.');

// ── Verify ──
console.log('\n=== Verification ===');
const orphans = db.prepare(`
  SELECT COUNT(*) as n FROM ai_entity_verse_map m
  WHERE NOT EXISTS (SELECT 1 FROM ai_entity_profiles p WHERE p.entity_id = m.entity_id)
`).get().n;
console.log(`Orphaned verse mappings: ${orphans}`);
console.log(`Total merges performed: ${mergeCount}`);

const totalProfiles = db.prepare('SELECT COUNT(*) as n FROM ai_entity_profiles').get().n;
console.log(`Total entity profiles remaining: ${totalProfiles}`);

db.close();
console.log('\n✅ Entity merges and qualifier fixes complete');
