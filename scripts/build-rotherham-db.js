#!/usr/bin/env node
'use strict';

/**
 * build-rotherham-db.js — Build rotherham-scriptures-sqlite.db from
 * Rotherham's Emphasized Bible (1902, fully public domain).
 *
 * Source: scrollmapper/bible_databases on GitHub — formats/csv/Rotherham.csv
 *   Format: Book (name), Chapter, Verse, Text
 *
 * Strategy:
 *   - volumes / books / chapters : copied from lds-scriptures-sqlite.db  (stable IDs)
 *   - Bible verses (book_id 1–66)  : scripture_text from Rotherham CSV
 *   - Non-Bible verses (BoM/D&C/PGP, book_id 67+) : copied from lds-scriptures-sqlite.db
 *
 * Run:
 *   node scripts/build-rotherham-db.js
 */

const path    = require('path');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const Database = require('better-sqlite3');

const DB_DIR    = path.join(__dirname, '..', 'resources', 'db');
const LDS_PATH  = path.join(DB_DIR, 'lds-scriptures-sqlite.db');
const OUT_PATH  = path.join(DB_DIR, 'rotherham-scriptures-sqlite.db');
const CSV_CACHE = path.join(DB_DIR, 'rotherham-raw.csv');

const CSV_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv/Rotherham.csv';

// ── Book name → LDS book_id mapping ──────────────────────────────────────────
// scrollmapper uses full names with Roman numerals (I, II, III)
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
 * Strip Rotherham markup and normalize text.
 *
 * The CSV text (after CSV parsing where "" → ") may contain:
 *   [="word"]   — name-meaning annotations e.g. [="Confusion"]  → remove entirely
 *   [word]      — implied/supplementary words e.g. [a son]      → keep word, strip brackets
 *   Embedded newlines from multi-line CSV fields                 → normalize to space
 */
function cleanRotherhamText(text) {
  // Remove name-meaning annotations e.g. [="Confusion"] or [="God hearkeneth"]
  text = text.replace(/\[="[^"]*"\]/g, '');
  // Unwrap supplementary words in square brackets: [a son] → a son
  text = text.replace(/\[([^\]]+)\]/g, '$1');
  // Normalize whitespace (including newlines from multi-line CSV fields)
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Minimal RFC 4180 compliant CSV parser.
 * Correctly handles multi-line quoted fields (common in Rotherham CSV).
 * Returns an array of row arrays.
 */
function parseCsv(text) {
  const rows = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const row = [];

    while (true) {
      let field = '';

      if (i < n && text[i] === '"') {
        i++; // opening quote
        while (i < n) {
          if (text[i] === '"') {
            i++;
            if (i < n && text[i] === '"') {
              field += '"'; i++; // escaped ""
            } else {
              break; // end of quoted field
            }
          } else {
            field += text[i++];
          }
        }
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          field += text[i++];
        }
      }

      row.push(field);

      if (i < n && text[i] === ',') {
        i++; // comma → next field
      } else {
        if (i < n && text[i] === '\r') i++;
        if (i < n && text[i] === '\n') i++;
        break; // end of row
      }
    }

    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Parse Rotherham.csv → Map<bookId, Map<chapter, Map<verse, text>>>
 * Format: Book,Chapter,Verse,Text  (Book is name, Chapter/Verse are integers)
 */
function parseRotherhamCsv(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  const data = new Map();
  let skipped = 0;

  for (const row of rows) {
    if (!row || row.length < 4) continue;
    const [bookName, chapterStr, verseStr, rawText] = row;
    if (bookName === 'Book') continue; // header

    const bookId = BOOK_NAME_TO_ID[bookName.trim()];
    if (!bookId) { skipped++; continue; }

    const chapter = parseInt(chapterStr, 10);
    const verse   = parseInt(verseStr,   10);
    if (isNaN(chapter) || isNaN(verse)) continue;

    const clean = cleanRotherhamText(rawText || '');
    if (!clean) continue;

    if (!data.has(bookId)) data.set(bookId, new Map());
    const cMap = data.get(bookId);
    if (!cMap.has(chapter)) cMap.set(chapter, new Map());
    cMap.get(chapter).set(verse, clean);
  }

  if (skipped > 0) console.warn(`  Warning: ${skipped} rows had unrecognised book names`);
  return data;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Download CSV if not cached
  if (!fs.existsSync(CSV_CACHE)) {
    console.log(`Downloading Rotherham CSV from:\n  ${CSV_URL}`);
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

  // 2. Parse Rotherham data
  console.log('Parsing Rotherham CSV...');
  const rot = parseRotherhamCsv(CSV_CACHE);
  let rotVerseCount = 0;
  for (const cMap of rot.values()) for (const vMap of cMap.values()) rotVerseCount += vMap.size;
  console.log(`  Parsed ${rotVerseCount} Rotherham verses across ${rot.size} Bible books.`);

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

  let rotUsed = 0, ldsUsed = 0, missing = 0;
  const missingList = [];

  for (const row of allVerses) {
    let text;
    if (row.book_id >= 1 && row.book_id <= 66) {
      const cMap = rot.get(row.book_id);
      const vMap = cMap && cMap.get(row.chapter_number);
      text = vMap && vMap.get(row.verse_number);
      if (text) {
        rotUsed++;
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
  console.log(`  Rotherham Bible verses inserted : ${rotUsed}`);
  console.log(`  LDS non-Bible verses kept       : ${ldsUsed}`);
  if (missing > 0) {
    console.warn(`  WARNING: ${missing} Bible verses missing from Rotherham CSV (fell back to KJV):`);
    missingList.slice(0, 10).forEach(m => console.warn(`    ${m}`));
    if (missingList.length > 10) console.warn(`    ...and ${missingList.length - 10} more`);
  }
  console.log(`  Output: ${OUT_PATH}`);
  const stat = fs.statSync(OUT_PATH);
  console.log(`  Size  : ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(err => { console.error(err); process.exit(1); });
