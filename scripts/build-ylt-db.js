#!/usr/bin/env node
'use strict';

/**
 * build-ylt-db.js — Build ylt-scriptures-sqlite.db from Young's Literal Translation
 *
 * YLT is fully public domain (Robert Young, 1862 / revised 1898).
 * Source: scrollmapper/bible_databases on GitHub — formats/csv/YLT.csv
 *   Format: Book (name), Chapter, Verse, Text
 *
 * Strategy:
 *   - volumes / books / chapters : copied from lds-scriptures-sqlite.db  (stable IDs)
 *   - Bible verses (book_id 1–66)  : scripture_text from YLT CSV
 *   - Non-Bible verses (BoM/D&C/PGP, book_id 67+) : copied from lds-scriptures-sqlite.db
 *
 * Run:
 *   node scripts/build-ylt-db.js
 *
 * Pre-download the CSV first if not already cached:
 *   curl -L "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv/YLT.csv" \
 *        -o resources/db/ylt-raw.csv
 */

const path    = require('path');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const Database = require('better-sqlite3');

const DB_DIR    = path.join(__dirname, '..', 'resources', 'db');
const LDS_PATH  = path.join(DB_DIR, 'lds-scriptures-sqlite.db');
const OUT_PATH  = path.join(DB_DIR, 'ylt-scriptures-sqlite.db');
const CSV_CACHE = path.join(DB_DIR, 'ylt-raw.csv');

const CSV_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv/YLT.csv';

// ── Book name → LDS book_id mapping ──────────────────────────────────────────
// scrollmapper YLT CSV uses full names with Roman numerals (I, II, III)
const BOOK_NAME_TO_ID = {
  'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
  'Joshua': 6, 'Judges': 7, 'Ruth': 8,
  'I Samuel': 9, 'II Samuel': 10, 'I Kings': 11, 'II Kings': 12,
  'I Chronicles': 13, 'II Chronicles': 14,
  'Ezra': 15, 'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19,
  'Proverbs': 20, 'Ecclesiastes': 21, 'Song of Solomon': 22,
  'Isaiah': 23, 'Jeremiah': 24, 'Lamentations': 25, 'Ezekiel': 26, 'Daniel': 27,
  'Hosea': 28, 'Joel': 29, 'Amos': 30, 'Obadiah': 31, 'Jonah': 32, 'Micah': 33,
  'Nahum': 34, 'Habakkuk': 35, 'Zephaniah': 36, 'Haggai': 37, 'Zechariah': 38,
  'Malachi': 39,
  'Matthew': 40, 'Mark': 41, 'Luke': 42, 'John': 43, 'Acts': 44,
  'Romans': 45, 'I Corinthians': 46, 'II Corinthians': 47, 'Galatians': 48,
  'Ephesians': 49, 'Philippians': 50, 'Colossians': 51,
  'I Thessalonians': 52, 'II Thessalonians': 53,
  'I Timothy': 54, 'II Timothy': 55, 'Titus': 56, 'Philemon': 57,
  'Hebrews': 58, 'James': 59, 'I Peter': 60, 'II Peter': 61,
  'I John': 62, 'II John': 63, 'III John': 64, 'Jude': 65,
  'Revelation of John': 66,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => {
      file.close();
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

/**
 * Strip YLT markup tags from text.
 *
 * YLT CSV contains OSIS-style inline markup:
 *   <FI>word<Fi>   — italics (supplied word, keep the word)
 *   <RF>...<Rf>    — footnote reference (discard entirely)
 *   <CM>           — section break (discard)
 *   <CL>           — line break in poetry (replace with space)
 *   <WT>tag<Wt>    — Strong's number tag (discard)
 *   <WH>...<Wh>    — Hebrew word (discard markup, keep word)
 */
function cleanYltText(text) {
  // Remove footnote blocks entirely: <RF>...<Rf>
  text = text.replace(/<RF>[^<]*<Rf>/g, '');
  // Strong's number tags: discard
  text = text.replace(/<WT>[^<]*<Wt>/g, '');
  // Hebrew word tags: keep text inside
  text = text.replace(/<WH>([^<]*)<Wh>/g, '$1');
  // Italic markers: keep text inside
  text = text.replace(/<FI>([^<]*)<Fi>/g, '$1');
  text = text.replace(/<FO>([^<]*)<Fo>/g, '$1');
  // Section/line breaks
  text = text.replace(/<CL>/g, ' ');
  text = text.replace(/<CM>/g, ' ');
  // Remove any remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Clean up dashes used instead of em-dashes for verse continuation
  // Normalize whitespace
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

/**
 * Parse scrollmapper YLT.csv → Map<bookId, Map<chapter, Map<verse, text>>>
 * Format: Book,Chapter,Verse,Text  (Book is name, Chapter/Verse are integers)
 */
function parseYltCsv(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  const data = new Map(); // bookId → chapter → verse → text
  let skipped = 0;

  for (const raw of lines) {
    const line = raw.trim();
    // Skip header line
    if (!line || line.startsWith('Book,')) continue;

    // Split: first comma = end of book name, second = chapter, third = verse, rest = text
    // Book names can contain commas (none in practice for Bible, but be safe)
    // Format is: BookName,ChapterNum,VerseNum,TextContent
    const firstComma  = line.indexOf(',');
    if (firstComma < 0) continue;
    const secondComma = line.indexOf(',', firstComma + 1);
    if (secondComma < 0) continue;
    const thirdComma  = line.indexOf(',', secondComma + 1);
    if (thirdComma < 0) continue;

    const bookName = line.slice(0, firstComma).trim();
    const chapter  = parseInt(line.slice(firstComma + 1, secondComma), 10);
    const verse    = parseInt(line.slice(secondComma + 1, thirdComma), 10);
    let   text     = line.slice(thirdComma + 1);

    // Remove surrounding CSV quotes if any
    if (text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1).replace(/""/g, '"');
    }

    const bookId = BOOK_NAME_TO_ID[bookName];
    if (!bookId) { skipped++; continue; }

    text = cleanYltText(text);
    if (!text) continue;

    if (!data.has(bookId)) data.set(bookId, new Map());
    const cMap = data.get(bookId);
    if (!cMap.has(chapter)) cMap.set(chapter, new Map());
    cMap.get(chapter).set(verse, text);
  }

  if (skipped > 0) console.warn(`  Warning: ${skipped} rows had unrecognised book names`);
  return data;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Download CSV if not cached
  if (!fs.existsSync(CSV_CACHE)) {
    console.log(`Downloading YLT CSV from:\n  ${CSV_URL}`);
    try {
      await download(CSV_URL, CSV_CACHE);
      console.log(`  Saved to ${CSV_CACHE}`);
    } catch (err) {
      console.error('Download failed:', err.message);
      console.error('Please download manually:');
      console.error(`  curl -L "${CSV_URL}" -o "${CSV_CACHE}"`);
      process.exit(1);
    }
  } else {
    console.log(`Using cached CSV: ${CSV_CACHE}`);
  }

  // 2. Parse YLT data
  console.log('Parsing YLT CSV...');
  const ylt = parseYltCsv(CSV_CACHE);
  let yltVerseCount = 0;
  for (const cMap of ylt.values()) for (const vMap of cMap.values()) yltVerseCount += vMap.size;
  console.log(`  Parsed ${yltVerseCount} YLT verses across ${ylt.size} Bible books.`);

  // 3. Remove old output DB
  if (fs.existsSync(OUT_PATH)) {
    fs.unlinkSync(OUT_PATH);
    console.log(`Removed existing ${path.basename(OUT_PATH)}`);
  }

  // 4. Open DBs
  const lds = new Database(LDS_PATH, { readonly: true });
  const out = new Database(OUT_PATH);

  // 5. Create schema
  out.exec(`
    CREATE TABLE volumes (
      id INTEGER PRIMARY KEY, volume_title TEXT, volume_long_title TEXT,
      volume_subtitle TEXT, volume_short_title TEXT, volume_lds_url TEXT
    );
    CREATE TABLE books (
      id INTEGER PRIMARY KEY, volume_id INTEGER REFERENCES volumes(id) ON DELETE CASCADE,
      book_title TEXT, book_long_title TEXT, book_subtitle TEXT,
      book_short_title TEXT, book_lds_url TEXT
    );
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY, book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      chapter_number INTEGER
    );
    CREATE TABLE verses (
      id INTEGER PRIMARY KEY, chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
      verse_number INTEGER, scripture_text TEXT
    );
    CREATE TABLE configuration (revision INTEGER, schema_version TEXT);
    CREATE VIEW scriptures AS
      SELECT
        vol.id  AS volume_id,
        b.id    AS book_id,
        c.id    AS chapter_id,
        v.id    AS verse_id,
        vol.volume_title,
        b.book_title,
        vol.volume_long_title,
        b.book_long_title,
        vol.volume_subtitle,
        b.book_subtitle,
        vol.volume_short_title,
        b.book_short_title,
        vol.volume_lds_url,
        b.book_lds_url,
        c.chapter_number,
        v.verse_number,
        v.scripture_text,
        b.book_title       || ' ' || c.chapter_number || ':' || v.verse_number AS verse_title,
        b.book_short_title || ' ' || c.chapter_number || ':' || v.verse_number AS verse_short_title
      FROM volumes vol
      INNER JOIN books    b  ON b.volume_id  = vol.id
      INNER JOIN chapters c  ON c.book_id    = b.id
      INNER JOIN verses   v  ON v.chapter_id = c.id
      ORDER BY vol.id, b.id, c.id, v.id;
  `);

  out.exec('BEGIN');

  const insVol   = out.prepare('INSERT INTO volumes VALUES (?,?,?,?,?,?)');
  const insBook  = out.prepare('INSERT INTO books VALUES (?,?,?,?,?,?,?)');
  const insCh    = out.prepare('INSERT INTO chapters VALUES (?,?,?)');
  const insVerse = out.prepare('INSERT INTO verses VALUES (?,?,?,?)');

  for (const v of lds.prepare('SELECT * FROM volumes').all())
    insVol.run(v.id, v.volume_title, v.volume_long_title, v.volume_subtitle, v.volume_short_title, v.volume_lds_url);
  for (const b of lds.prepare('SELECT * FROM books').all())
    insBook.run(b.id, b.volume_id, b.book_title, b.book_long_title, b.book_subtitle, b.book_short_title, b.book_lds_url);
  for (const c of lds.prepare('SELECT * FROM chapters').all())
    insCh.run(c.id, c.book_id, c.chapter_number);

  // 6. Insert verses
  const allVerses = lds.prepare(`
    SELECT v.id, v.chapter_id, v.verse_number, c.chapter_number,
           b.id AS book_id, b.volume_id, v.scripture_text AS ldsText
    FROM verses v
    JOIN chapters c ON c.id = v.chapter_id
    JOIN books b ON b.id = c.book_id
    ORDER BY v.id
  `).all();

  let yltUsed = 0, ldsUsed = 0, missing = 0;
  const missingList = [];

  for (const row of allVerses) {
    let text;
    if (row.book_id >= 1 && row.book_id <= 66) {
      const cMap = ylt.get(row.book_id);
      const vMap = cMap && cMap.get(row.chapter_number);
      text = vMap && vMap.get(row.verse_number);
      if (text) {
        yltUsed++;
      } else {
        text = row.ldsText; // fallback to KJV for any missing verses
        missing++;
        missingList.push(`book_id=${row.book_id} ${row.chapter_number}:${row.verse_number}`);
      }
    } else {
      text = row.ldsText;
      ldsUsed++;
    }
    insVerse.run(row.id, row.chapter_id, row.verse_number, text);
  }

  out.exec(`INSERT INTO configuration VALUES (1, '1.0')`);
  out.exec('COMMIT');

  lds.close();
  out.close();

  console.log(`\nDone!`);
  console.log(`  YLT Bible verses inserted  : ${yltUsed}`);
  console.log(`  LDS non-Bible verses kept  : ${ldsUsed}`);
  if (missing > 0) {
    console.warn(`  WARNING: ${missing} Bible verses missing from YLT CSV (fell back to KJV):`);
    missingList.slice(0, 10).forEach(m => console.warn(`    ${m}`));
    if (missingList.length > 10) console.warn(`    ...and ${missingList.length - 10} more`);
  }
  console.log(`  Output: ${OUT_PATH}`);
  const stat = fs.statSync(OUT_PATH);
  console.log(`  Size  : ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(err => { console.error(err); process.exit(1); });

