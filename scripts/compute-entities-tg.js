#!/usr/bin/env node
/**
 * Compute named entities (people + places) for every verse using a curated
 * dictionary of LDS scripture figures and geographic names.
 *
 * Uses exact-word-boundary text matching against a comprehensive known-names
 * dictionary — avoids NLP false positives like "King Mosiah, rich".
 *
 * Run once:  node scripts/compute-entities-tg.js
 * Reset old: node scripts/compute-entities-tg.js --reset
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR  = path.resolve(__dirname, '../resources/db');
const db      = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true });
const db_tags = new Database(path.join(DB_DIR, 'verse-tags.db'));

const RESET = process.argv.includes('--reset');

// ── PEOPLE dictionary ────────────────────────────────────────────────────────
// Canonical LDS scripture figures. Each entry is a person name string that
// will be matched as a whole word in verse text (word-boundary regex).
const KNOWN_PEOPLE = [
  // Old Testament
  'Aaron','Abel','Abigail','Abimelech','Abner','Absalom','Abraham','Abram',
  'Adam','Agabus','Agrippa','Ahab','Ahaz','Ahasuerus','Ahijah','Ahimelech',
  'Ahithophel','Amaziah','Amos','Ananias','Andrew','Anna','Apollos','Aquila',
  'Artaxerxes','Asa','Asaph','Azariah','Balaam','Balak','Barnabas','Bartholomew',
  'Bathsheba','Benjamin','Bezaleel','Boaz','Cain','Caleb','Cornelius','Cyrus',
  'Daniel','Darius','David','Deborah','Dinah','Dorcas','Eber','Eleazar',
  'Eli','Elijah','Elisha','Elisabeth','Elizabeth','Enoch','Ephraim','Esau',
  'Esther','Eve','Ezekiel','Ezra','Felix','Festus','Gabriel','Gad','Gideon',
  'Goliath','Habakkuk','Hagar','Ham','Haman','Hannah','Herod','Hezekiah',
  'Hosea','Hymenaeus','Isaac','Isaiah','Ishmael','Jacob','James','Japheth',
  'Jeremiah','Jesse','Jethro','Jezebel','Joab','Job','Joel','John','Jonah',
  'Jonathan','Joseph','Josiah','Joshua','Judah','Judas','Laban','Lazarus',
  'Leah','Levi','Lot','Luke','Malachi','Mark','Martha','Mary','Matthew',
  'Melchizedek','Methuselah','Micah','Miriam','Mordecai','Moses','Naaman',
  'Naomi','Nathan','Nebuchadnezzar','Nehemiah','Nicodemus','Noah','Obadiah',
  'Onesimus','Paul','Peter','Pharaoh','Philip','Philemon','Potiphar',
  'Rachel','Rebekah','Rebecca','Reuben','Ruth','Samson','Samuel','Sarah',
  'Sarai','Saul','Seth','Shem','Silas','Simeon','Solomon','Stephen',
  'Thomas','Timothy','Titus','Zacchaeus','Zechariah','Zedekiah','Zerubbabel',
  'Zipporah','Elias','Gehazi','Micaiah','Nabal','Lot','Baasha','Omri',
  'Jehu','Jezebel','Jehoiakim','Huldah','Jehoshaphat','Cornelius',
  'Barabbas','Matthias','Nathanael','Thaddaeus',
  // Book of Mormon
  'Abinadi','Alma','Amalickiah','Aminadi','Ammon','Amulek','Antipas',
  'Antipus','Coriantumr','Enos','Ether','Gidgiddoni','Helaman','Jarom',
  'Korihor','Lachoneus','Lamoni','Lehi','Lehonti','Limhi','Mormon',
  'Moroni','Mosiah','Moronihah','Mulek','Nephi','Omni','Pahoran','Sariah',
  'Shiblon','Teancum','Zeniff','Zerahemnah','Zoram','Abish','Aminadab',
  'Corianton','Gazelem','Gideon','Hagoth','Himni','Omner','Seantum',
  'Seezoram','Shemnon','Shiz','Shule','Sidom','Zeezrom','Amaron','Amaleki',
  'Benjamin','Samuel','Amgid','Helorum','Luram','Mathoni','Mathonihah',
  'Jeremiah','Nephi','Jacob','Enos','Jarom','Omni',
  // Doctrine & Covenants / Church History
  'Hyrum','Oliver','Emma',
  // Jesus Christ forms
  'Jesus','Christ','Jehovah','Emmanuel','Immanuel','Messiah',
  // Heavenly Father forms
  'Elohim',
];

// ── PLACES dictionary ─────────────────────────────────────────────────────────
const KNOWN_PLACES = [
  // Old Testament geography
  'Abarim','Achaia','Antioch','Assyria','Babylon','Bethel','Bethlehem',
  'Canaan','Carmel','Damascus','Egypt','Galilee','Gethsemane','Gilead',
  'Hebron','Israel','Jericho','Jerusalem','Jordan','Lebanon',
  'Mesopotamia','Midian','Nazareth','Nineveh','Samaria','Sinai','Zion',
  'Beersheba','Bethany','Bethphage','Bethsaida','Caesarea','Capernaum',
  'Corinth','Emmaus','Ephesus','Galatia','Joppa','Kadesh','Macedonia',
  'Moab','Philippi','Rome','Thessalonica','Tyre','Succoth','Rameses',
  'Edom','Ammon','Midian','Shiloh','Mizpah','Gilgal','Bethlehem',
  'Sodom','Gomorrah','Zoar','Haran','Ur','Eden','Shechem','Dothan',
  'Peniel','Penuel','Paran','Marah','Elim','Meribah','Horeb','Negev',
  'Goshen','Nile','Euphrates','Tigris','Hermon','Lebanon','Tabor',
  'Moriah','Ararat','Shinar','Babel','Tarsus','Athens','Malta',
  // Book of Mormon geography
  'Bountiful','Cumorah','Helam','Hermounts','Jershon','Melek',
  'Zarahemla','Sidon','Ripliancum','Onidah','Sidom',
  'Moriancumer','Irreantum',
  // Doctrinal places
  'Paradise','Gethsemane',
  // Compound proper geography in scriptures
  'Galilee','Bethany',
];

// ── Build regex matchers ──────────────────────────────────────────────────────
// Sort longest first so "Jesus Christ" matches before "Jesus"
const sortedPeople = [...new Set(KNOWN_PEOPLE)].sort((a, b) => b.length - a.length);
const sortedPlaces = [...new Set(KNOWN_PLACES)].sort((a, b) => b.length - a.length);

// Escape special regex chars in names
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Build a single big alternation regex for efficiency
const peopleRe = new RegExp(`\\b(${sortedPeople.map(escRe).join('|')})\\b`, 'g');
const placesRe  = new RegExp(`\\b(${sortedPlaces.map(escRe).join('|')})\\b`, 'g');

function extractEntities(text) {
  const people = [...new Set([...text.matchAll(peopleRe)].map(m => m[1]))];
  const places  = [...new Set([...text.matchAll(placesRe)].map(m => m[1]))];
  return { people, places };
}

// ── Ensure table exists ───────────────────────────────────────────────────────
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

if (RESET) {
  db_tags.exec('DELETE FROM verse_entities');
  console.log('Cleared existing verse_entities');
}

// ── Process all verses ────────────────────────────────────────────────────────
const verses = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all();
console.log(`Processing ${verses.length} verses…`);

const ins = db_tags.prepare(`
  INSERT OR REPLACE INTO verse_entities (verse_id, people, places, entities_json)
  VALUES (?, ?, ?, ?)
`);

const batchInsert = db_tags.transaction((items) => {
  for (const item of items) ins.run(item.verse_id, item.people, item.places, item.entities_json);
});

const BATCH = 1000;
let done = 0;
let batch = [];

for (const v of verses) {
  const { people, places } = extractEntities(v.scripture_text || '');
  batch.push({
    verse_id:      v.verse_id,
    people:        people.join('|'),
    places:        places.join('|'),
    entities_json: JSON.stringify({ people, places }),
  });
  done++;
  if (batch.length >= BATCH) {
    batchInsert(batch);
    batch = [];
    process.stdout.write(`\r${done}/${verses.length}`);
  }
}
if (batch.length) batchInsert(batch);

console.log(`\nDone. ${done} verses processed.`);

// ── Stats ─────────────────────────────────────────────────────────────────────
const withPeople = db_tags.prepare("SELECT COUNT(*) AS c FROM verse_entities WHERE people != ''").get().c;
const withPlaces  = db_tags.prepare("SELECT COUNT(*) AS c FROM verse_entities WHERE places != ''").get().c;
console.log(`Verses with people: ${withPeople},  with places: ${withPlaces}`);

// Sample
const sample = db_tags.prepare(
  "SELECT verse_id, people, places FROM verse_entities WHERE people != '' LIMIT 8"
).all();
for (const s of sample) {
  console.log(`  verse ${s.verse_id}: people=[${s.people}] places=[${s.places}]`);
}

db.close();
db_tags.close();
