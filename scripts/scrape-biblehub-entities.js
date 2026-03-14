#!/usr/bin/env node
/**
 * scrape-biblehub-entities.js
 * Scrapes BibleHub chapter pages for People and Places sections (OT + NT)
 * and updates verse_entities in verse-tags.db with chapter-level enrichment.
 *
 * Usage:
 *   node scripts/scrape-biblehub-entities.js           # resume from progress file
 *   node scripts/scrape-biblehub-entities.js --reset   # clear progress and restart
 *   node scripts/scrape-biblehub-entities.js --dry-run # print URLs without writing
 *
 * Rate limit: ~1.5s delay between requests (polite scraping)
 */

const Database = require('better-sqlite3');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SCRIPTURES_DB = path.join(__dirname, '../resources/db/lds-scriptures-sqlite.db');
const TAGS_DB       = path.join(__dirname, '../resources/db/verse-tags.db');
const PROGRESS_FILE = path.join(__dirname, '../resources/db/biblehub-progress.json');
const DELAY_MS      = 1500; // be polite

const RESET   = process.argv.includes('--reset');
const DRY_RUN = process.argv.includes('--dry-run');

// Map LDS book_title → BibleHub URL slug
const BIBLEHUB_SLUGS = {
  'Genesis':          'genesis',
  'Exodus':           'exodus',
  'Leviticus':        'leviticus',
  'Numbers':          'numbers',
  'Deuteronomy':      'deuteronomy',
  'Joshua':           'joshua',
  'Judges':           'judges',
  'Ruth':             'ruth',
  '1 Samuel':         '1_samuel',
  '2 Samuel':         '2_samuel',
  '1 Kings':          '1_kings',
  '2 Kings':          '2_kings',
  '1 Chronicles':     '1_chronicles',
  '2 Chronicles':     '2_chronicles',
  'Ezra':             'ezra',
  'Nehemiah':         'nehemiah',
  'Esther':           'esther',
  'Job':              'job',
  'Psalms':           'psalms',
  'Proverbs':         'proverbs',
  'Ecclesiastes':     'ecclesiastes',
  'Song of Solomon':  'songs',
  'Isaiah':           'isaiah',
  'Jeremiah':         'jeremiah',
  'Lamentations':     'lamentations',
  'Ezekiel':          'ezekiel',
  'Daniel':           'daniel',
  'Hosea':            'hosea',
  'Joel':             'joel',
  'Amos':             'amos',
  'Obadiah':          'obadiah',
  'Jonah':            'jonah',
  'Micah':            'micah',
  'Nahum':            'nahum',
  'Habakkuk':         'habakkuk',
  'Zephaniah':        'zephaniah',
  'Haggai':           'haggai',
  'Zechariah':        'zechariah',
  'Malachi':          'malachi',
  'Matthew':          'matthew',
  'Mark':             'mark',
  'Luke':             'luke',
  'John':             'john',
  'Acts':             'acts',
  'Romans':           'romans',
  '1 Corinthians':    '1_corinthians',
  '2 Corinthians':    '2_corinthians',
  'Galatians':        'galatians',
  'Ephesians':        'ephesians',
  'Philippians':      'philippians',
  'Colossians':       'colossians',
  '1 Thessalonians':  '1_thessalonians',
  '2 Thessalonians':  '2_thessalonians',
  '1 Timothy':        '1_timothy',
  '2 Timothy':        '2_timothy',
  'Titus':            'titus',
  'Philemon':         'philemon',
  'Hebrews':          'hebrews',
  'James':            'james',
  '1 Peter':          '1_peter',
  '2 Peter':          '2_peter',
  '1 John':           '1_john',
  '2 John':           '2_john',
  '3 John':           '3_john',
  'Jude':             'jude',
  'Revelation':       'revelation',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LDS-Scripture-Research/1.0)',
        'Accept': 'text/html',
      },
      timeout: 15000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/**
 * Extract names from a section bounded by id="start_id" to id="end_id"
 */
function extractSectionNames(html, startId, endId) {
  const s = html.indexOf(`id="${startId}"`);
  if (s < 0) return [];
  const e = endId ? html.indexOf(`id="${endId}"`, s) : -1;
  const section = e > 0 ? html.slice(s, e) : html.slice(s, s + 8000);

  // Names are: <b><a href="/topical/...">Name (optional hebrew)</a></b>
  const raw = section.match(/<b><a href="\/topical\/[^"]+">([^<]+)<\/a><\/b>/g) || [];
  return raw.map(m => {
    const name = m.replace(/<[^>]+>/g, '').trim();
    // Strip Hebrew/Greek parenthetical (Unicode chars OR HTML entities &#NNN;)
    return name
      .replace(/\s*\([^)]*(?:[\u0080-\uFFFF]|&#\d+;)[^)]*\)/g, '')
      .trim();
  }).filter(n => n.length > 1);
}

function parsePage(html) {
  return {
    people: extractSectionNames(html, 'people', 'places'),
    places: extractSectionNames(html, 'places', 'events'),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sdb = new Database(SCRIPTURES_DB, { readonly: true });
  const tdb = new Database(TAGS_DB);

  // Load progress
  let progress = {};
  if (!RESET && fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    console.log(`Resuming — ${Object.keys(progress).length} chapters already done`);
  } else if (RESET && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Progress reset');
  }

  // Prepare statements
  const getVerseIds = sdb.prepare(
    'SELECT id FROM verses WHERE chapter_id = ?'
  );
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

  // Get all OT + NT books and their chapters
  const books = sdb.prepare(
    'SELECT id, volume_id, book_title FROM books WHERE volume_id <= 2 ORDER BY id'
  ).all();
  const chapters = sdb.prepare(
    'SELECT id, book_id, chapter_number FROM chapters WHERE book_id IN (' +
    books.map(b => b.id).join(',') + ') ORDER BY id'
  ).all();

  console.log(`Total OT+NT chapters to process: ${chapters.length}`);

  let done = 0, skipped = 0, errors = 0;

  for (const chap of chapters) {
    const book = books.find(b => b.id === chap.book_id);
    if (!book) continue;

    const slug = BIBLEHUB_SLUGS[book.book_title];
    if (!slug) {
      console.warn(`No BibleHub slug for: ${book.book_title}`);
      continue;
    }

    const key = `${book.book_title}:${chap.chapter_number}`;
    if (progress[key]) {
      skipped++;
      continue;
    }

    const url = `https://biblehub.com/${slug}/${chap.chapter_number}.htm`;

    if (DRY_RUN) {
      console.log(`[DRY] ${key} → ${url}`);
      done++;
      continue;
    }

    let people = [], places = [];
    try {
      const html = await fetchPage(url);
      const parsed = parsePage(html);
      people = parsed.people;
      places = parsed.places;
    } catch (err) {
      console.error(`  ✗ ${key}: ${err.message}`);
      errors++;
      // Don't mark as done — will retry on next run
      await sleep(DELAY_MS);
      continue;
    }

    // Get verse IDs for this chapter
    const verseIds = getVerseIds.all(chap.id).map(r => r.id);

    // Merge with existing NER data and write
    const mergeAndWrite = tdb.transaction(() => {
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

        // Merge: BibleHub names take precedence (authoritative), but keep existing NER too
        const mergedPeople = [...new Set([...people, ...existingPeople])];
        const mergedPlaces = [...new Set([...places, ...existingPlaces])];

        const entJson = JSON.stringify({ people: mergedPeople, places: mergedPlaces });
        upsertEntity.run(vid, mergedPeople.join(', '), mergedPlaces.join(', '), entJson);
      }
    });
    mergeAndWrite();

    progress[key] = { people: people.length, places: places.length, ts: Date.now() };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

    done++;
    const pct = ((done + skipped) / chapters.length * 100).toFixed(1);
    process.stdout.write(`\r[${pct}%] ${key}: ${people.length}p ${places.length}pl (${done} done, ${errors} errors)`);

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${done} scraped, ${skipped} skipped, ${errors} errors`);
  sdb.close();
  tdb.close();
}

main().catch(err => { console.error(err); process.exit(1); });
