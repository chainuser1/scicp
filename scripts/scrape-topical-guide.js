#!/usr/bin/env node
/**
 * scrape-topical-guide.js
 *
 * Scrapes the LDS Topical Guide from churchofjesuschrist.org and builds
 * resources/db/topical-guide.db with two tables:
 *
 *   topics (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT)
 *   topical_guide (id INTEGER PRIMARY KEY AUTOINCREMENT,
 *                  topic_id INTEGER NOT NULL REFERENCES topics(id),
 *                  verse_title TEXT NOT NULL,   -- e.g. "Genesis 1:1"
 *                  verse_id INTEGER)            -- verse_id from lds-scriptures-sqlite.db (may be null)
 *
 * Usage:
 *   node scripts/scrape-topical-guide.js [--force]
 *
 * Options:
 *   --force   Drop and recreate the topical_guide table (full re-scrape)
 *
 * Rate-limited to 1 req/500ms.  Resume-safe: topics already present in the
 * DB are skipped unless --force is passed.
 */

'use strict';

const https = require('https');
const path  = require('path');
const DB    = require('better-sqlite3');

// ── paths ─────────────────────────────────────────────────────────────────────
const ROOT      = path.resolve(__dirname, '..');
const TG_DB     = path.join(ROOT, 'resources', 'db', 'topical-guide.db');
const SCPT_DB   = path.join(ROOT, 'resources', 'db', 'lds-scriptures-sqlite.db');

// ── Church URL slug → book_title in our DB ────────────────────────────────────
const BOOK_SLUG_MAP = {
  // Old Testament
  'gen':'Genesis','exod':'Exodus','lev':'Leviticus','num':'Numbers',
  'deut':'Deuteronomy','josh':'Joshua','judg':'Judges','ruth':'Ruth',
  '1-sam':'1 Samuel','2-sam':'2 Samuel','1-kgs':'1 Kings','2-kgs':'2 Kings',
  '1-chr':'1 Chronicles','2-chr':'2 Chronicles','ezra':'Ezra','neh':'Nehemiah',
  'esth':'Esther','job':'Job','ps':'Psalms','prov':'Proverbs',
  'eccl':'Ecclesiastes','song':'Song of Solomon','isa':'Isaiah',
  'jer':'Jeremiah','lam':'Lamentations','ezek':'Ezekiel','dan':'Daniel',
  'hosea':'Hosea','joel':'Joel','amos':'Amos','obad':'Obadiah',
  'jonah':'Jonah','micah':'Micah','nahum':'Nahum','hab':'Habakkuk',
  'zeph':'Zephaniah','hag':'Haggai','zech':'Zechariah','mal':'Malachi',
  // New Testament
  'matt':'Matthew','mark':'Mark','luke':'Luke','john':'John','acts':'Acts',
  'rom':'Romans','1-cor':'1 Corinthians','2-cor':'2 Corinthians',
  'gal':'Galatians','eph':'Ephesians','philip':'Philippians',
  'col':'Colossians','1-thes':'1 Thessalonians','2-thes':'2 Thessalonians',
  '1-tim':'1 Timothy','2-tim':'2 Timothy','titus':'Titus',
  'philem':'Philemon','heb':'Hebrews','james':'James','1-pet':'1 Peter',
  '2-pet':'2 Peter','1-jn':'1 John','2-jn':'2 John','3-jn':'3 John',
  'jude':'Jude','rev':'Revelation',
  // Book of Mormon
  '1-ne':'1 Nephi','2-ne':'2 Nephi','jacob':'Jacob','enos':'Enos',
  'jarom':'Jarom','omni':'Omni','w-of-m':'Words of Mormon','mosiah':'Mosiah',
  'alma':'Alma','hel':'Helaman','3-ne':'3 Nephi','4-ne':'4 Nephi',
  'morm':'Mormon','ether':'Ether','moro':'Moroni',
  // D&C
  'dc':'Doctrine and Covenants',
  // PGP
  'moses':'Moses','abr':'Abraham','js-m':'Joseph Smith--Matthew',
  'js-h':'Joseph Smith--History','a-of-f':'Articles of Faith',
};

// ── helpers ───────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scicp-scraper/1.0)' } };
    https.get(url, options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://www.churchofjesuschrist.org${res.headers.location}`;
        return resolve(get(loc));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Extract __INITIAL_STATE__ from Church HTML and return parsed object */
function parseState(html) {
  const m = html.match(/window\.__INITIAL_STATE__="([^"]+)"/);
  if (!m) throw new Error('No __INITIAL_STATE__ in page');
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

/**
 * Parse scripture verse refs from a topic page body.
 * Returns array of { verseTitle, bookTitle, chapter, verse }
 */
function parseVerseRefs(body) {
  // href="/study/scriptures/{vol}/{book}/{chapter}?lang=eng&id=p{verse}..."
  const RE = /href="\/study\/scriptures\/(?!tg|bd|jst)[\w-]+\/([\w-]+)\/(\d+)\?[^"]*id=p(\d+)/g;
  const results = [];
  let m;
  const seen = new Set();
  while ((m = RE.exec(body)) !== null) {
    const [, bookSlug, chapterStr, verseStr] = m;
    const bookTitle = BOOK_SLUG_MAP[bookSlug];
    if (!bookTitle) continue;
    const chapter = parseInt(chapterStr, 10);
    const verse   = parseInt(verseStr,   10);
    const key = `${bookSlug}:${chapter}:${verse}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ verseTitle: `${bookTitle} ${chapter}:${verse}`, bookTitle, chapter, verse });
  }
  return results;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const force = process.argv.includes('--force');

  // Open / create topical-guide.db
  const tgDb = new DB(TG_DB);
  tgDb.pragma('journal_mode = WAL');
  tgDb.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT    NOT NULL UNIQUE,
      name TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topical_guide (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id  INTEGER NOT NULL REFERENCES topics(id),
      verse_title TEXT  NOT NULL,
      verse_id  INTEGER
    );
    CREATE INDEX IF NOT EXISTS tg_topic_id ON topical_guide(topic_id);
    CREATE INDEX IF NOT EXISTS tg_verse_id ON topical_guide(verse_id);
  `);

  if (force) {
    console.log('--force: dropping existing topical_guide rows and topics...');
    tgDb.exec('DELETE FROM topical_guide; DELETE FROM topics;');
  }

  // Open scripture DB for verse_id lookups (read-only)
  const sDb = new DB(SCPT_DB, { readonly: true });
  const lookupVerse = sDb.prepare(`
    SELECT verse_id FROM scriptures
    WHERE book_title = ? AND chapter_number = ? AND verse_number = ?
    LIMIT 1
  `);

  const insertTopic       = tgDb.prepare('INSERT OR IGNORE INTO topics (slug, name) VALUES (?, ?)');
  const getTopicId        = tgDb.prepare('SELECT id FROM topics WHERE slug = ?');
  const isTopicScraped    = tgDb.prepare('SELECT 1 FROM topical_guide WHERE topic_id = ? LIMIT 1');
  const insertEntry       = tgDb.prepare(
    'INSERT INTO topical_guide (topic_id, verse_title, verse_id) VALUES (?, ?, ?)'
  );
  const insertBatch = tgDb.transaction((topicId, entries) => {
    for (const { verseTitle, verse_id } of entries) {
      insertEntry.run(topicId, verseTitle, verse_id ?? null);
    }
  });

  // 1) Fetch topic list
  console.log('Fetching topic list from Topical Guide index...');
  const indexHtml = await get('https://www.churchofjesuschrist.org/study/scriptures/tg?lang=eng');
  const indexState = parseState(indexHtml);
  const indexBody = indexState.reader.contentStore['/eng/scriptures/tg'].content.body;
  const topicMatches = [...indexBody.matchAll(
    /href="\/study\/scriptures\/tg\/([\w-]+)\?lang=eng"[^>]*>[^<]*<p class="title">([^<]+)<\/p>/g
  )];
  const topics = topicMatches
    .map(m => ({ slug: m[1], name: m[2] }))
    .filter(t => t.slug !== 'introduction');
  console.log(`Found ${topics.length} topics.`);

  // 2) Scrape each topic
  let done = 0, skipped = 0, failed = 0, totalVerses = 0;
  for (const { slug, name } of topics) {
    // Upsert topic row
    insertTopic.run(slug, name);
    const { id: topicId } = getTopicId.get(slug);

    // Skip if already scraped (unless --force wiped the table)
    if (isTopicScraped.get(topicId)) {
      skipped++;
      done++;
      if (done % 200 === 0) process.stdout.write(`\r${done}/${topics.length} (${skipped} skipped, ${failed} failed, ${totalVerses} verses)`);
      continue;
    }

    try {
      await sleep(500);
      const html = await get(`https://www.churchofjesuschrist.org/study/scriptures/tg/${slug}?lang=eng`);
      const state = parseState(html);
      const contentKey = `/eng/scriptures/tg/${slug}`;
      const body = state.reader?.contentStore?.[contentKey]?.content?.body ?? '';
      const refs = parseVerseRefs(body);

      const entries = refs.map(({ verseTitle, bookTitle, chapter, verse }) => {
        const row = lookupVerse.get(bookTitle, chapter, verse);
        return { verseTitle, verse_id: row?.verse_id ?? null };
      });

      if (entries.length > 0) {
        insertBatch(topicId, entries);
        totalVerses += entries.length;
      }
      done++;
    } catch (err) {
      failed++;
      done++;
      console.error(`\nFailed: ${slug} — ${err.message}`);
    }

    if (done % 50 === 0) {
      process.stdout.write(`\r${done}/${topics.length} (${skipped} skipped, ${failed} failed, ${totalVerses} verses)   `);
    }
  }

  process.stdout.write('\n');

  const topicCount = tgDb.prepare('SELECT COUNT(*) AS c FROM topics').get().c;
  const entryCount = tgDb.prepare('SELECT COUNT(*) AS c FROM topical_guide').get().c;
  const mappedCount = tgDb.prepare('SELECT COUNT(*) AS c FROM topical_guide WHERE verse_id IS NOT NULL').get().c;
  console.log(`\nDone.`);
  console.log(`  Topics: ${topicCount}`);
  console.log(`  Entries: ${entryCount}`);
  console.log(`  Mapped to verse_id: ${mappedCount} (${((mappedCount/entryCount)*100).toFixed(1)}%)`);

  tgDb.close();
  sDb.close();
}

main().catch(err => { console.error(err); process.exit(1); });
