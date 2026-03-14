#!/usr/bin/env node
/**
 * compute-entities-lds.js
 * Extracts people and places from LDS chapter summaries (already in chapter_summaries table)
 * for Book of Mormon, D&C, and Pearl of Great Price chapters.
 *
 * Strategy: parse the LDS.org chapter heading summaries (e.g. "Nephi begins the record—
 * Lehi sees in vision...") to identify proper nouns and classify as people vs places
 * using curated dictionaries.
 *
 * Usage:
 *   node scripts/compute-entities-lds.js          # process all triple combo chapters
 *   node scripts/compute-entities-lds.js --reset  # clear existing triple combo entities first
 */

const Database = require('better-sqlite3');
const path = require('path');

const SCRIPTURES_DB = path.join(__dirname, '../resources/db/lds-scriptures-sqlite.db');
const TAGS_DB       = path.join(__dirname, '../resources/db/verse-tags.db');

const RESET = process.argv.includes('--reset');

// ── Curated Name Dictionaries ─────────────────────────────────────────────────

// Book of Mormon people (canonical names as they appear in LDS summaries)
const BOM_PEOPLE = new Set([
  // Lehite family
  'Lehi', 'Sariah', 'Nephi', 'Sam', 'Laman', 'Lemuel', 'Jacob', 'Joseph',
  'Zoram', 'Ishmael', 'Laban', 'Enos', 'Jarom', 'Omni', 'Amaron', 'Chemish',
  // Mosiah / Benjamin
  'Mosiah', 'King Benjamin', 'Benjamin', 'King Mosiah', 'Zeniff', 'Noah', 'King Noah',
  'Gideon', 'Limhi', 'King Limhi', 'Abinadi', 'Alma',
  // Alma / Sons of Mosiah
  'Ammon', 'Aaron', 'Omner', 'Himni', 'Lamoni', 'King Lamoni',
  'Anti-Nephi-Lehi', 'Amulek', 'Zeezrom', 'Korihor', 'Nehor', 'Amlici',
  // Helaman / Stripling warriors
  'Helaman', 'Captain Moroni', 'Moroni', 'Pahoran', 'Teancum',
  'Gadianton', 'Kishkumen', 'Morianton',
  // Christ / 3 Nephi
  'Samuel', 'Nephi', 'Timothy', 'Jonas',
  // 4 Nephi / Mormon / Moroni
  'Mormon', 'Ammaron', 'Ether', 'Coriantumr', 'Jared', 'Moriancumer',
  'Shiz', 'Akish', 'Lib', 'Riplakish', 'Kib', 'Orihah',
  // Groups
  'Nephites', 'Lamanites', 'Jaredites', 'Mulekites', 'Ammonites',
  'Zoramites', 'Anti-Nephi-Lehies', 'Gadianton Robbers',
  // Prophets referenced
  'Isaiah', 'Moses', 'Elijah', 'Abraham', 'Adam', 'Eve',
  'Noah', 'Enoch', 'Melchizedek', 'Ezekiel', 'Jeremiah', 'Zenos', 'Zenock', 'Neum',
  // Jesus Christ references
  'Jesus Christ', 'Jesus', 'Christ', 'Messiah', 'Emmanuel',
  'Holy Ghost', 'Holy Spirit',
  // Other individuals
  'Aminadab', 'Mathoni', 'Mathonihah', 'Kumenonhi', 'Jeremiah',
  'Seantum', 'Lachoneus', 'Gidgiddoni',
]);

// Book of Mormon places
const BOM_PLACES = new Set([
  'Jerusalem', 'Zarahemla', 'Bountiful', 'Cumorah', 'Manti',
  'Land of Nephi', 'City of Nephi', 'Nephi', 'Lehi-Nephi',
  'Land of Zarahemla', 'Wilderness', 'Red Sea', 'Arabian',
  'Jershon', 'Melek', 'Sidom', 'Ammonihah', 'Noah',
  'Gideon', 'Helam', 'Amulon', 'Middoni', 'Ishmael',
  'Land of Ishmael', 'Midian', 'Mulek', 'City of Mulek',
  'Morianton', 'Lehi', 'Moroni', 'Omner', 'Girgashites',
  'Land of Bountiful', 'Irreantum', 'Ablom', 'Moron',
  'Desolation', 'Land of Desolation', 'Land of Many Waters',
  'Hill Cumorah', 'Hill Ramah', 'River Sidon', 'Sidon',
  'Egypt', 'Babylon', 'Israel', 'Canaan', 'Jordan',
  'Promised Land', 'Arabian Peninsula',
]);

// D&C / Church History people
const DC_PEOPLE = new Set([
  'Joseph Smith', 'Joseph', 'Hyrum Smith', 'Hyrum', 'Emma Smith', 'Emma',
  'Oliver Cowdery', 'Oliver', 'Martin Harris', 'Martin',
  'David Whitmer', 'David', 'Peter Whitmer', 'John Whitmer',
  'Sidney Rigdon', 'Sidney', 'Newel Whitney', 'Frederick Williams',
  'William McLellin', 'Lyman Johnson', 'Orson Hyde', 'Orson Pratt',
  'Parley Pratt', 'John Taylor', 'Brigham Young', 'Heber Kimball',
  'Willard Richards', 'John C. Bennett', 'William Marks',
  'Newel Knight', 'Joseph Knight', 'Edward Partridge', 'Isaac Morley',
  'John Corrill', 'Lyman Wight', 'John Murdock', 'Harvey Whitlock',
  'Simeon Carter', 'Philo Dibble', 'Luke Johnson', 'Ezra Booth',
  'Thomas Marsh', 'David Patten',
  // Angelic/heavenly beings
  'John the Baptist', 'Peter', 'James', 'John', 'Moroni', 'Elijah',
  'Elias', 'Moses', 'Abraham', 'Michael', 'Gabriel',
  // Groups
  'Elders', 'Saints',
]);

// D&C places / Church History places
const DC_PLACES = new Set([
  'Kirtland', 'Nauvoo', 'Far West', 'Adam-ondi-Ahman',
  'Missouri', 'Ohio', 'Illinois', 'New York',
  'Fayette', 'Harmony', 'Pennsylvania', 'Palmyra',
  'Jackson County', 'Clay County', 'Caldwell County',
  'Hiram', 'Independence', 'Zion',
  'Liberty Jail', 'Carthage',
  'New Jerusalem', 'Mount Zion',
]);

// Pearl of Great Price people
const POGP_PEOPLE = new Set([
  'Moses', 'God', 'Satan', 'Enoch', 'Adam', 'Eve', 'Cain', 'Abel',
  'Seth', 'Noah', 'Abraham', 'Sarah', 'Hagar', 'Lot',
  'Isaac', 'Ishmael', 'Jacob', 'Joseph', 'Pharaoh',
  'Elias', 'Elijah', 'Michael', 'Gabriel', 'Lucifer',
  'Joseph Smith', 'Oliver Cowdery', 'Moroni',
  'Christ', 'Jesus', 'Jesus Christ', 'Holy Ghost',
]);

// Pearl of Great Price places
const POGP_PLACES = new Set([
  'Eden', 'Garden of Eden', 'Egypt', 'Canaan', 'Ur',
  'Haran', 'Israel', 'Jerusalem', 'Zion', 'Enoch',
  'Land of the Chaldeans', 'City of Enoch',
  'Land of Egypt', 'Land of Canaan',
]);

// Combined sets for fast lookup
const ALL_PEOPLE = new Set([...BOM_PEOPLE, ...DC_PEOPLE, ...POGP_PEOPLE]);
const ALL_PLACES = new Set([...BOM_PLACES, ...DC_PLACES, ...POGP_PLACES]);

// Additional classifier: canonical forms for partial matches
const PEOPLE_PATTERNS = [
  // Title + name patterns
  /\bKing\s+([A-Z][a-z]+)\b/g,
  /\bProphet\s+([A-Z][a-z]+)\b/g,
  /\bBrother\s+([A-Z][a-z]+)\b/g,
  /\bSon(?:s)?\s+of\s+([A-Z][a-z]+)\b/g,
];

const PLACE_PATTERNS = [
  /\bLand\s+of\s+([A-Z][a-z]+)\b/g,
  /\bCity\s+of\s+([A-Z][a-z]+)\b/g,
  /\bHill\s+([A-Z][a-z]+)\b/g,
  /\bRiver\s+([A-Z][a-z]+)\b/g,
  /\bWaters?\s+of\s+([A-Z][a-z]+)\b/g,
  /\bPlain\s+of\s+([A-Z][a-z]+)\b/g,
  /\bValley\s+of\s+([A-Z][a-z]+)\b/g,
];

// ── Extraction ────────────────────────────────────────────────────────────────

function extractFromSummary(summaryText) {
  if (!summaryText) return { people: [], places: [] };

  const people = new Set();
  const places = new Set();

  // 1. Multi-word proper nouns first (higher specificity)
  const multiWord = summaryText.match(/\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})+\b/g) || [];
  for (const name of multiWord) {
    const clean = name.trim();
    if (ALL_PEOPLE.has(clean)) people.add(clean);
    else if (ALL_PLACES.has(clean)) places.add(clean);
  }

  // 2. Single proper nouns
  const singleWord = summaryText.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  for (const name of singleWord) {
    if (ALL_PEOPLE.has(name)) people.add(name);
    else if (ALL_PLACES.has(name)) places.add(name);
  }

  // 3. Pattern-based extraction (Land of X, City of X, King X, etc.)
  for (const pat of PEOPLE_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(summaryText)) !== null) {
      const extracted = m[0].trim(); // full match like "King Benjamin"
      people.add(extracted);
    }
  }
  for (const pat of PLACE_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(summaryText)) !== null) {
      const extracted = m[0].trim();
      places.add(extracted);
    }
  }

  return {
    people: [...people],
    places: [...places],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const sdb = new Database(SCRIPTURES_DB, { readonly: true });
  const tdb = new Database(TAGS_DB);

  // Get all triple combination chapters (volume_id 3=BOM, 4=D&C, 5=PoGP)
  const tripleBooks = sdb.prepare(
    'SELECT id, volume_id, book_title FROM books WHERE volume_id IN (3,4,5)'
  ).all();
  const tripleBookIds = tripleBooks.map(b => b.id);

  const tripleChapters = sdb.prepare(
    `SELECT c.id as chapter_id, c.book_id, c.chapter_number, b.volume_id, b.book_title
     FROM chapters c JOIN books b ON c.book_id = b.id
     WHERE c.book_id IN (${tripleBookIds.join(',')})
     ORDER BY c.id`
  ).all();

  console.log(`Triple combo chapters: ${tripleChapters.length}`);

  // Get chapter summaries
  const summaryMap = {};
  const summaryRows = tdb.prepare(
    `SELECT chapter_id, summary_text FROM chapter_summaries WHERE chapter_id IN (${tripleChapters.map(c => c.chapter_id).join(',')})`
  ).all();
  summaryRows.forEach(r => { summaryMap[r.chapter_id] = r.summary_text; });
  console.log(`Summaries found: ${summaryRows.length}`);

  // Get verse IDs per chapter
  const getVerseIds = sdb.prepare('SELECT id FROM verses WHERE chapter_id = ?');

  // Get/upsert verse entities
  const getCurrentEntity = tdb.prepare(
    'SELECT people, places, entities_json FROM verse_entities WHERE verse_id = ?'
  );
  const upsertEntity = tdb.prepare(`
    INSERT INTO verse_entities (verse_id, people, places, entities_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(verse_id) DO UPDATE SET
      people = excluded.people,
      places = excluded.places,
      entities_json = excluded.entities_json
  `);

  let processed = 0, withData = 0;

  const processAll = tdb.transaction(() => {
    for (const chap of tripleChapters) {
      const summaryText = summaryMap[chap.chapter_id] || '';
      const { people, places } = extractFromSummary(summaryText);

      if (people.length === 0 && places.length === 0) {
        processed++;
        continue;
      }

      const verseIds = getVerseIds.all(chap.chapter_id).map(r => r.id);
      for (const vid of verseIds) {
        const existing = getCurrentEntity.get(vid);
        let existingPeople = [], existingPlaces = [];
        if (existing) {
          try {
            const ej = JSON.parse(existing.entities_json || '{}');
            existingPeople = ej.people || [];
            existingPlaces = ej.places || [];
          } catch {}
        }

        // Merge: LDS summary names + existing NER (dedup by base name)
        const seenP = new Set(existingPeople.map(n => n.replace(/\s*\([^)]+\)/,'').toLowerCase()));
        const mergedPeople = [...existingPeople, ...people.filter(n => !seenP.has(n.toLowerCase()))];

        const seenPl = new Set(existingPlaces.map(n => n.toLowerCase()));
        const mergedPlaces = [...existingPlaces, ...places.filter(n => !seenPl.has(n.toLowerCase()))];

        const entJson = JSON.stringify({ people: mergedPeople, places: mergedPlaces });
        upsertEntity.run(vid, mergedPeople.join(', '), mergedPlaces.join(', '), entJson);
      }

      processed++;
      withData++;
    }
  });

  processAll();

  console.log(`Done. ${processed} chapters processed, ${withData} with extracted names`);

  // Final stats
  const stats = tdb.prepare("SELECT COUNT(*) as n FROM verse_entities WHERE people != '' AND people IS NOT NULL").get();
  const statsp = tdb.prepare("SELECT COUNT(*) as n FROM verse_entities WHERE places != '' AND places IS NOT NULL").get();
  console.log(`verse_entities — people: ${stats.n}, places: ${statsp.n}`);

  // Sample output
  console.log('\nSample BOM verses after enrichment:');
  const bomStart = tripleChapters[0];
  const sampleVerses = sdb.prepare('SELECT id FROM verses WHERE chapter_id = ? LIMIT 3').all(bomStart.chapter_id);
  for (const v of sampleVerses) {
    const row = tdb.prepare('SELECT people, places FROM verse_entities WHERE verse_id = ?').get(v.id);
    if (row) console.log(`  v${v.id}: people=[${row.people}] places=[${row.places}]`);
  }

  sdb.close();
  tdb.close();
}

main().catch(err => { console.error(err); process.exit(1); });
