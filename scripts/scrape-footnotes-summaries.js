#!/usr/bin/env node
/**
 * scrape-footnotes-summaries.js
 *
 * Scrapes authoritative sources and stores them in footnotes-lds-summaries.db:
 *
 *   1. LDS chapter summaries — from churchofjesuschrist.org TOC pages
 *      (all 1,582 chapters across all 5 standard works)
 *
 *   2. NABRE scholarly footnotes — for the 1,189 Bible chapters only
 *      Scraped from BibleGateway (NABRE version) and stored directly
 *      in `bg_footnotes` column (rich scholarly prose, no AI needed).
 *
 *   3. NET Bible translator notes — for the 1,189 Bible chapters only
 *      Scraped from BibleGateway (NET version) and stored directly
 *      in `net_notes` column (granular Hebrew/Greek/Aramaic linguistic notes).
 *
 * Usage:
 *   node scripts/scrape-footnotes-summaries.js [--lds-only] [--nabre-only] [--net-only] [--limit N] [--resume]
 *
 * Flags:
 *   --lds-only    Only scrape LDS summaries
 *   --nabre-only  Only scrape NABRE scholarly footnotes
 *   --net-only    Only scrape NET translator notes
 *   --limit N    Process at most N chapters (for testing)
 *   --resume     Skip chapters that already have data
 */

const https = require('https');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

// ─── Paths ────────────────────────────────────────────────────────────────────
const DB_SCRIPTURES = path.resolve(__dirname, '../resources/db/lds-scriptures-sqlite.db');
const DB_OUTPUT = path.resolve(__dirname, '../resources/db/footnotes-lds-summaries.db');

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const LDS_ONLY = args.includes('--lds-only');
const NABRE_ONLY = args.includes('--nabre-only');
const NET_ONLY = args.includes('--net-only');
const RESUME = args.includes('--resume');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ─── Delay helper ─────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── HTTP fetch helper ────────────────────────────────────────────────────────
function fetchPage(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const redir = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchPage(redir, maxRedirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ─── LDS URL slugs for each book ─────────────────────────────────────────────
// Maps book_title → { volume_slug, book_slug } for churchofjesuschrist.org
const LDS_BOOK_SLUGS = {
  // Old Testament
  'Genesis':          { vol: 'ot', slug: 'gen' },
  'Exodus':           { vol: 'ot', slug: 'ex' },
  'Leviticus':        { vol: 'ot', slug: 'lev' },
  'Numbers':          { vol: 'ot', slug: 'num' },
  'Deuteronomy':      { vol: 'ot', slug: 'deut' },
  'Joshua':           { vol: 'ot', slug: 'josh' },
  'Judges':           { vol: 'ot', slug: 'judg' },
  'Ruth':             { vol: 'ot', slug: 'ruth' },
  '1 Samuel':         { vol: 'ot', slug: '1-sam' },
  '2 Samuel':         { vol: 'ot', slug: '2-sam' },
  '1 Kings':          { vol: 'ot', slug: '1-kgs' },
  '2 Kings':          { vol: 'ot', slug: '2-kgs' },
  '1 Chronicles':     { vol: 'ot', slug: '1-chr' },
  '2 Chronicles':     { vol: 'ot', slug: '2-chr' },
  'Ezra':             { vol: 'ot', slug: 'ezra' },
  'Nehemiah':         { vol: 'ot', slug: 'neh' },
  'Esther':           { vol: 'ot', slug: 'esth' },
  'Job':              { vol: 'ot', slug: 'job' },
  'Psalms':           { vol: 'ot', slug: 'ps' },
  'Proverbs':         { vol: 'ot', slug: 'prov' },
  'Ecclesiastes':     { vol: 'ot', slug: 'eccl' },
  'Song of Solomon':  { vol: 'ot', slug: 'song' },
  'Isaiah':           { vol: 'ot', slug: 'isa' },
  'Jeremiah':         { vol: 'ot', slug: 'jer' },
  'Lamentations':     { vol: 'ot', slug: 'lam' },
  'Ezekiel':          { vol: 'ot', slug: 'ezek' },
  'Daniel':           { vol: 'ot', slug: 'dan' },
  'Hosea':            { vol: 'ot', slug: 'hosea' },
  'Joel':             { vol: 'ot', slug: 'joel' },
  'Amos':             { vol: 'ot', slug: 'amos' },
  'Obadiah':          { vol: 'ot', slug: 'obad' },
  'Jonah':            { vol: 'ot', slug: 'jonah' },
  'Micah':            { vol: 'ot', slug: 'micah' },
  'Nahum':            { vol: 'ot', slug: 'nahum' },
  'Habakkuk':         { vol: 'ot', slug: 'hab' },
  'Zephaniah':        { vol: 'ot', slug: 'zeph' },
  'Haggai':           { vol: 'ot', slug: 'hag' },
  'Zechariah':        { vol: 'ot', slug: 'zech' },
  'Malachi':          { vol: 'ot', slug: 'mal' },
  // New Testament
  'Matthew':          { vol: 'nt', slug: 'matt' },
  'Mark':             { vol: 'nt', slug: 'mark' },
  'Luke':             { vol: 'nt', slug: 'luke' },
  'John':             { vol: 'nt', slug: 'john' },
  'Acts':             { vol: 'nt', slug: 'acts' },
  'Romans':           { vol: 'nt', slug: 'rom' },
  '1 Corinthians':    { vol: 'nt', slug: '1-cor' },
  '2 Corinthians':    { vol: 'nt', slug: '2-cor' },
  'Galatians':        { vol: 'nt', slug: 'gal' },
  'Ephesians':        { vol: 'nt', slug: 'eph' },
  'Philippians':      { vol: 'nt', slug: 'philip' },
  'Colossians':       { vol: 'nt', slug: 'col' },
  '1 Thessalonians':  { vol: 'nt', slug: '1-thes' },
  '2 Thessalonians':  { vol: 'nt', slug: '2-thes' },
  '1 Timothy':        { vol: 'nt', slug: '1-tim' },
  '2 Timothy':        { vol: 'nt', slug: '2-tim' },
  'Titus':            { vol: 'nt', slug: 'titus' },
  'Philemon':         { vol: 'nt', slug: 'philem' },
  'Hebrews':          { vol: 'nt', slug: 'heb' },
  'James':            { vol: 'nt', slug: 'james' },
  '1 Peter':          { vol: 'nt', slug: '1-pet' },
  '2 Peter':          { vol: 'nt', slug: '2-pet' },
  '1 John':           { vol: 'nt', slug: '1-jn' },
  '2 John':           { vol: 'nt', slug: '2-jn' },
  '3 John':           { vol: 'nt', slug: '3-jn' },
  'Jude':             { vol: 'nt', slug: 'jude' },
  'Revelation':       { vol: 'nt', slug: 'rev' },
  // Book of Mormon
  '1 Nephi':          { vol: 'bofm', slug: '1-ne' },
  '2 Nephi':          { vol: 'bofm', slug: '2-ne' },
  'Jacob':            { vol: 'bofm', slug: 'jacob' },
  'Enos':             { vol: 'bofm', slug: 'enos' },
  'Jarom':            { vol: 'bofm', slug: 'jarom' },
  'Omni':             { vol: 'bofm', slug: 'omni' },
  'Words of Mormon':  { vol: 'bofm', slug: 'w-of-m' },
  'Mosiah':           { vol: 'bofm', slug: 'mosiah' },
  'Alma':             { vol: 'bofm', slug: 'alma' },
  'Helaman':          { vol: 'bofm', slug: 'hel' },
  '3 Nephi':          { vol: 'bofm', slug: '3-ne' },
  '4 Nephi':          { vol: 'bofm', slug: '4-ne' },
  'Mormon':           { vol: 'bofm', slug: 'morm' },
  'Ether':            { vol: 'bofm', slug: 'ether' },
  'Moroni':           { vol: 'bofm', slug: 'moro' },
  // Doctrine and Covenants — handled specially (sections, not books)
  'Doctrine and Covenants': { vol: 'dc-testament', slug: 'dc' },
  // Pearl of Great Price
  'Moses':                  { vol: 'pgp', slug: 'moses' },
  'Abraham':                { vol: 'pgp', slug: 'abr' },
  'Joseph Smith--Matthew':  { vol: 'pgp', slug: 'js-m' },
  'Joseph Smith--History':  { vol: 'pgp', slug: 'js-h' },
  'Articles of Faith':      { vol: 'pgp', slug: 'a-of-f' },
};

// ─── Bible Gateway book name mapping ──────────────────────────────────────────
// Maps our book_title → BibleGateway search name
const BG_BOOK_NAMES = {
  'Genesis': 'Genesis', 'Exodus': 'Exodus', 'Leviticus': 'Leviticus',
  'Numbers': 'Numbers', 'Deuteronomy': 'Deuteronomy', 'Joshua': 'Joshua',
  'Judges': 'Judges', 'Ruth': 'Ruth', '1 Samuel': '1 Samuel',
  '2 Samuel': '2 Samuel', '1 Kings': '1 Kings', '2 Kings': '2 Kings',
  '1 Chronicles': '1 Chronicles', '2 Chronicles': '2 Chronicles',
  'Ezra': 'Ezra', 'Nehemiah': 'Nehemiah', 'Esther': 'Esther',
  'Job': 'Job', 'Psalms': 'Psalm', 'Proverbs': 'Proverbs',
  'Ecclesiastes': 'Ecclesiastes', 'Song of Solomon': 'Song of Solomon',
  'Isaiah': 'Isaiah', 'Jeremiah': 'Jeremiah', 'Lamentations': 'Lamentations',
  'Ezekiel': 'Ezekiel', 'Daniel': 'Daniel', 'Hosea': 'Hosea',
  'Joel': 'Joel', 'Amos': 'Amos', 'Obadiah': 'Obadiah',
  'Jonah': 'Jonah', 'Micah': 'Micah', 'Nahum': 'Nahum',
  'Habakkuk': 'Habakkuk', 'Zephaniah': 'Zephaniah', 'Haggai': 'Haggai',
  'Zechariah': 'Zechariah', 'Malachi': 'Malachi',
  'Matthew': 'Matthew', 'Mark': 'Mark', 'Luke': 'Luke', 'John': 'John',
  'Acts': 'Acts', 'Romans': 'Romans', '1 Corinthians': '1 Corinthians',
  '2 Corinthians': '2 Corinthians', 'Galatians': 'Galatians',
  'Ephesians': 'Ephesians', 'Philippians': 'Philippians',
  'Colossians': 'Colossians', '1 Thessalonians': '1 Thessalonians',
  '2 Thessalonians': '2 Thessalonians', '1 Timothy': '1 Timothy',
  '2 Timothy': '2 Timothy', 'Titus': 'Titus', 'Philemon': 'Philemon',
  'Hebrews': 'Hebrews', 'James': 'James', '1 Peter': '1 Peter',
  '2 Peter': '2 Peter', '1 John': '1 John', '2 John': '2 John',
  '3 John': '3 John', 'Jude': 'Jude', 'Revelation': 'Revelation',
};

// ─── Parse LDS chapter summaries from a TOC page ─────────────────────────────
// The TOC HTML contains patterns like:
//   #### \n Genesis 2\n\n Summary text here \n
// We extract chapter numbers and their summaries.
function parseLdsSummaries(html, bookSlug) {
  const results = [];
  // Match chapter heading + summary text blocks
  // Pattern: /study/scriptures/vol/slug/N?lang=eng followed by summary text
  // The markdown conversion gives us: #### \n Book Chapter\n\n Summary\n
  const chapterRegex = new RegExp(
    `(?:#{1,6}\\s*\\n\\s*(?:[\\w\\s.'-]+?)\\s+(\\d+)\\s*\\n+([\\s\\S]*?)(?=\\*\\s*\\[|$))`,
    'g'
  );
  let match;
  while ((match = chapterRegex.exec(html)) !== null) {
    const chapterNum = parseInt(match[1], 10);
    let summary = match[2]
      .replace(/\*\s*\*\s*\*/g, '')  // remove horizontal rules
      .replace(/\]\([^)]*\)/g, '')   // remove markdown links
      .replace(/\[/g, '').replace(/\]/g, '')
      .replace(/\n+/g, ' ')
      .trim();
    if (summary && chapterNum) {
      results.push({ chapterNum, summary });
    }
  }
  return results;
}

// ─── Parse Bible Gateway footnotes from page HTML ─────────────────────────────
function parseBgFootnotes(html) {
  const footnotes = [];
  // Look for the Footnotes section — after "#### Footnotes" in markdown
  const footnoteSectionMatch = html.match(/#{1,6}\s*Footnotes\s*\n([\s\S]*?)(?=#{1,6}|$)/i);
  if (!footnoteSectionMatch) return '';

  const section = footnoteSectionMatch[1];
  // Each footnote is a numbered list item like:
  //   1. [2:2](#...) Or _ceased;_ also in [2:3](...)
  const lines = section.split('\n');
  for (const line of lines) {
    const cleaned = line
      .replace(/^\d+\.\s*/, '')             // remove leading number
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links to text
      .replace(/_([^_]*)_/g, '$1')          // remove italic markers
      .replace(/\*([^*]*)\*/g, '$1')        // remove bold markers
      .trim();
    if (cleaned) footnotes.push(cleaned);
  }
  return footnotes.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Open scriptures DB for chapter info
  const scriptureDb = new Database(DB_SCRIPTURES, { readonly: true });

  // Create/open output DB
  const db = new Database(DB_OUTPUT);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chapter_footnotes (
      chapter_id    INTEGER PRIMARY KEY,
      book_name     TEXT NOT NULL,
      chapter_num   INTEGER NOT NULL,
      volume_title  TEXT NOT NULL,
      lds_summary   TEXT,
      bg_footnotes  TEXT,
      net_notes     TEXT
    );
  `);

  // Load all chapters
  const allChapters = scriptureDb.prepare(`
    SELECT c.id as chapter_id, c.chapter_number, b.book_title, v.volume_title
    FROM chapters c
    JOIN books b ON c.book_id = b.id
    JOIN volumes v ON b.volume_id = v.id
    ORDER BY c.id
  `).all();

  console.log(`📖 Total chapters in scriptures DB: ${allChapters.length}`);

  const upsertStmt = db.prepare(`
    INSERT INTO chapter_footnotes (chapter_id, book_name, chapter_num, volume_title, lds_summary, bg_footnotes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chapter_id) DO UPDATE SET
      lds_summary = COALESCE(excluded.lds_summary, lds_summary),
      bg_footnotes = COALESCE(excluded.bg_footnotes, bg_footnotes)
  `);

  // ───────────────────────────────────────────────────────────────────────
  // Phase 1: LDS Chapter Summaries
  // ───────────────────────────────────────────────────────────────────────
  if (!NABRE_ONLY && !NET_ONLY) {
    console.log('\n═══ Phase 1: LDS Chapter Summaries ═══');

    // Group chapters by book
    const bookGroups = new Map();
    for (const ch of allChapters) {
      if (!bookGroups.has(ch.book_title)) bookGroups.set(ch.book_title, []);
      bookGroups.get(ch.book_title).push(ch);
    }

    let ldsCount = 0;
    let ldsSkipped = 0;

    for (const [bookTitle, chapters] of bookGroups) {
      if (ldsCount >= LIMIT) break;

      const slugInfo = LDS_BOOK_SLUGS[bookTitle];
      if (!slugInfo) {
        console.log(`  ⚠ No LDS slug for "${bookTitle}" — skipping`);
        continue;
      }

      // D&C: summaries are on the dc-testament TOC, which lists all 138 sections
      // Other books: each book has its own page
      let tocUrl;
      if (slugInfo.vol === 'dc-testament') {
        tocUrl = `https://www.churchofjesuschrist.org/study/scriptures/dc-testament/dc?lang=eng`;
      } else {
        tocUrl = `https://www.churchofjesuschrist.org/study/scriptures/${slugInfo.vol}/${slugInfo.slug}?lang=eng`;
      }

      // For single-chapter books, fetch the chapter page directly
      if (chapters.length === 1) {
        const ch = chapters[0];
        if (RESUME) {
          const existing = db.prepare('SELECT lds_summary FROM chapter_footnotes WHERE chapter_id=?').get(ch.chapter_id);
          if (existing?.lds_summary) { ldsSkipped++; continue; }
        }

        // Single-chapter books often have the summary on the parent volume TOC page
        // We'll try to fetch the individual chapter page and extract from it
        let chapterUrl;
        if (slugInfo.vol === 'dc-testament') {
          chapterUrl = `https://www.churchofjesuschrist.org/study/scriptures/dc-testament/dc/${ch.chapter_number}?lang=eng`;
        } else {
          chapterUrl = `https://www.churchofjesuschrist.org/study/scriptures/${slugInfo.vol}/${slugInfo.slug}/1?lang=eng`;
        }

        try {
          const html = await fetchPage(chapterUrl);
          // For single chapter books, look for the chapter heading summary
          // It's typically in a "study-summary" or at the top of the page
          const summaryMatch = html.match(/class="study-summary[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
            || html.match(/<div[^>]*class="[^"]*heading[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

          if (summaryMatch) {
            const summary = summaryMatch[1]
              .replace(/<[^>]+>/g, ' ')
              .replace(/&[a-z]+;/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (summary) {
              upsertStmt.run(ch.chapter_id, bookTitle, ch.chapter_number, ch.volume_title, summary, null);
              ldsCount++;
              console.log(`  ✓ ${bookTitle} ${ch.chapter_number} (single-chapter)`);
            }
          } else {
            console.log(`  ⚠ No summary found for single-chapter: ${bookTitle}`);
          }
        } catch (e) {
          console.error(`  ✗ Error fetching ${bookTitle}: ${e.message}`);
        }
        await sleep(1500);
        continue;
      }

      // Multi-chapter books: fetch the TOC page
      console.log(`  📚 Fetching TOC: ${bookTitle} (${tocUrl})`);
      try {
        const html = await fetchPage(tocUrl);
        // Parse summaries from the raw HTML
        const summaries = parseLdsTocHtml(html, slugInfo.slug);

        if (summaries.length === 0) {
          console.log(`    ⚠ No summaries parsed for ${bookTitle}`);
          await sleep(1500);
          continue;
        }

        // Map parsed summaries to our chapters by chapter_number
        const chapterMap = new Map(chapters.map(c => [c.chapter_number, c]));
        let matched = 0;
        for (const { chapterNum, summary } of summaries) {
          if (ldsCount >= LIMIT) break;
          const ch = chapterMap.get(chapterNum);
          if (!ch) continue;

          if (RESUME) {
            const existing = db.prepare('SELECT lds_summary FROM chapter_footnotes WHERE chapter_id=?').get(ch.chapter_id);
            if (existing?.lds_summary) { ldsSkipped++; continue; }
          }

          upsertStmt.run(ch.chapter_id, bookTitle, ch.chapter_number, ch.volume_title, summary, null);
          ldsCount++;
          matched++;
        }
        console.log(`    ✓ ${matched} summaries saved for ${bookTitle} (of ${chapters.length} chapters)`);
      } catch (e) {
        console.error(`    ✗ Error: ${e.message}`);
      }
      await sleep(1500);
    }

    console.log(`\n📊 LDS summaries: ${ldsCount} saved, ${ldsSkipped} skipped (resume)`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 2: NABRE Scholarly Footnotes
  // Scrapes NABRE footnotes from Bible Gateway — rich scholarly commentary.
  // Stored directly in bg_footnotes column (no AI summarization needed).
  // ───────────────────────────────────────────────────────────────────────
  if (!LDS_ONLY && !NET_ONLY) {
    console.log('\n═══ Phase 2: NABRE Scholarly Footnotes ═══');

    const nabreUpdateStmt = db.prepare(`
      UPDATE chapter_footnotes SET bg_footnotes = ? WHERE chapter_id = ?
    `);

    const bibleChapters = allChapters.filter(
      ch => ch.volume_title === 'Old Testament' || ch.volume_title === 'New Testament'
    );
    console.log(`  📖 Bible chapters to scrape: ${bibleChapters.length}`);

    let nabreCount = 0;
    let nabreSkipped = 0;
    let nabreErrors = 0;

    for (const ch of bibleChapters) {
      if (nabreCount >= LIMIT) break;

      if (RESUME) {
        const existing = db.prepare('SELECT bg_footnotes FROM chapter_footnotes WHERE chapter_id=?').get(ch.chapter_id);
        if (existing?.bg_footnotes) { nabreSkipped++; continue; }
      }

      const bgName = BG_BOOK_NAMES[ch.book_title];
      if (!bgName) {
        console.log(`  ⚠ No BG name for "${ch.book_title}"`);
        continue;
      }

      const searchTerm = `${bgName} ${ch.chapter_number}`;
      const nabreUrl = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(searchTerm)}&version=NABRE`;

      try {
        let html;
        // Retry up to 3 times for transient errors (504, 503, 408, timeout)
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            html = await fetchPage(nabreUrl);
            break;
          } catch (fetchErr) {
            const msg = fetchErr.message || '';
            const isTransient = /50[34]|408|Timeout|ECONNRESET|ETIMEDOUT/.test(msg);
            if (isTransient && attempt < 3) {
              const wait = attempt * 5000;
              console.error(`  ↻ ${ch.book_title} ${ch.chapter_number}: ${msg.slice(0, 60)} — retry ${attempt}/3 in ${wait / 1000}s`);
              await sleep(wait);
            } else {
              throw fetchErr;
            }
          }
        }
        const footnotes = parseNabreFootnotesHtml(html);

        nabreUpdateStmt.run(footnotes || null, ch.chapter_id);
        nabreCount++;

        if (nabreCount % 50 === 0 || nabreCount <= 5) {
          const noteCount = footnotes ? footnotes.split('\n').length : 0;
          console.log(`  [${nabreCount}/${bibleChapters.length}] ✓ ${ch.book_title} ${ch.chapter_number} (${noteCount} footnotes)`);
        }
      } catch (e) {
        nabreErrors++;
        console.error(`  ✗ ${ch.book_title} ${ch.chapter_number}: ${e.message}`);
        if (e.message.includes('429') || e.message.includes('403')) {
          console.log('  ⏳ Rate limited — waiting 30s...');
          await sleep(30000);
        }
      }
      await sleep(2000); // Polite 2s delay
    }

    console.log(`\n📊 NABRE footnotes: ${nabreCount} saved, ${nabreSkipped} skipped, ${nabreErrors} errors`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 3: NET Bible Translator Notes
  // Scrapes NET translator notes from Bible Gateway — granular linguistic
  // notes with Hebrew/Greek/Aramaic terms. Same HTML structure as NABRE.
  // Stored in net_notes column.
  // ───────────────────────────────────────────────────────────────────────
  if (!LDS_ONLY && !NABRE_ONLY) {
    console.log('\n═══ Phase 3: NET Bible Translator Notes ═══');

    const netUpdateStmt = db.prepare(`
      UPDATE chapter_footnotes
      SET net_notes = ?
      WHERE chapter_id = ?
    `);

    // Bible chapters only (NET is a Bible translation)
    const netChapters = allChapters.filter(c =>
      c.volume_title === 'Old Testament' || c.volume_title === 'New Testament'
    );
    console.log(`  📖 Bible chapters to scrape: ${netChapters.length}`);

    let netCount = 0;
    let netSkipped = 0;
    let netErrors = 0;

    for (const ch of netChapters) {
      if (netCount >= LIMIT) break;

      if (RESUME) {
        const existing = db.prepare('SELECT net_notes FROM chapter_footnotes WHERE chapter_id=?').get(ch.chapter_id);
        if (existing?.net_notes) { netSkipped++; continue; }
      }

      const bgName = BG_BOOK_NAMES[ch.book_title];
      if (!bgName) {
        console.log(`  ⚠ No BG name for "${ch.book_title}"`);
        continue;
      }

      const searchTerm = `${bgName} ${ch.chapter_number}`;
      const netUrl = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(searchTerm)}&version=NET`;

      try {
        let html;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            html = await fetchPage(netUrl);
            break;
          } catch (fetchErr) {
            const msg = fetchErr.message || '';
            const isTransient = /50[34]|408|Timeout|ECONNRESET|ETIMEDOUT/.test(msg);
            if (isTransient && attempt < 3) {
              const wait = attempt * 5000;
              console.error(`  ↻ ${ch.book_title} ${ch.chapter_number}: ${msg.slice(0, 60)} — retry ${attempt}/3 in ${wait / 1000}s`);
              await sleep(wait);
            } else {
              throw fetchErr;
            }
          }
        }
        const footnotes = parseNabreFootnotesHtml(html);

        netUpdateStmt.run(footnotes || null, ch.chapter_id);
        netCount++;

        if (netCount % 50 === 0 || netCount <= 5) {
          const noteCount = footnotes ? footnotes.split('\n').length : 0;
          console.log(`  [${netCount}/${netChapters.length}] ✓ ${ch.book_title} ${ch.chapter_number} (${noteCount} notes)`);
        }
      } catch (e) {
        netErrors++;
        console.error(`  ✗ ${ch.book_title} ${ch.chapter_number}: ${e.message}`);
        if (e.message.includes('429') || e.message.includes('403')) {
          console.log('  ⏳ Rate limited — waiting 30s...');
          await sleep(30000);
        }
      }
      await sleep(2000); // Polite 2s delay
    }

    console.log(`\n📊 NET notes: ${netCount} saved, ${netSkipped} skipped, ${netErrors} errors`);
  }

  // ─── Final stats ──────────────────────────────────────────────────────
  const totalRows = db.prepare('SELECT COUNT(*) as n FROM chapter_footnotes').get().n;
  const withLds = db.prepare("SELECT COUNT(*) as n FROM chapter_footnotes WHERE lds_summary IS NOT NULL AND lds_summary != ''").get().n;
  const withNabre = db.prepare("SELECT COUNT(*) as n FROM chapter_footnotes WHERE bg_footnotes IS NOT NULL AND bg_footnotes != ''").get().n;
  const withNet = db.prepare("SELECT COUNT(*) as n FROM chapter_footnotes WHERE net_notes IS NOT NULL AND net_notes != ''").get().n;
  console.log(`\n✅ Done! ${totalRows} rows total | ${withLds} LDS summaries | ${withNabre} NABRE | ${withNet} NET notes`);

  db.close();
  scriptureDb.close();
}

// ─── Parse LDS TOC from raw HTML ──────────────────────────────────────────────
// The TOC page has a <nav class="toc"> section with entries like:
//   <p class="title">Genesis 2</p>  or  <p class="title">Psalm 1</p>
//   <p class="description">Summary text here...</p>
// We extract chapter numbers and summaries from these pairs.
function parseLdsTocHtml(html, bookSlug) {
  const results = [];

  // Primary strategy: extract from <p class="title"> + <p class="description"> pairs
  // These are inside the <nav class="toc"> section
  const tocMatch = html.match(/<nav[^>]*class="toc"[^>]*>([\s\S]*?)<\/nav>/i);
  const searchHtml = tocMatch ? tocMatch[1] : html;

  // Find all <li> entries containing title + description
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liPattern.exec(searchHtml)) !== null) {
    const li = liMatch[1];

    // Extract chapter number from title
    const titleMatch = li.match(/<p[^>]*class="title"[^>]*>([\s\S]*?)<\/p>/i);
    if (!titleMatch) continue;
    const titleText = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    const numMatch = titleText.match(/(\d+)\s*$/);
    if (!numMatch) continue;
    const chapterNum = parseInt(numMatch[1], 10);

    // Extract summary from description
    const descMatch = li.match(/<p[^>]*class="description"[^>]*>([\s\S]*?)<\/p>/i);
    if (!descMatch) continue;
    const summary = descMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&rsquo;/g, '\u2019')
      .replace(/&lsquo;/g, '\u2018')
      .replace(/&ldquo;/g, '\u201C')
      .replace(/&rdquo;/g, '\u201D')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (summary && summary.length > 5) {
      results.push({ chapterNum, summary });
    }
  }

  // Fallback: text-based parsing if structured extraction found nothing
  if (results.length === 0) {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/?(h[1-6]|div|p|li|ul|ol|section|article|header|a|span)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&[a-z]+;/g, ' ');

    const chapterPattern = /(?:Chapter|Section|Psalm|Doctrine and Covenants)\s+(\d+)\s*\n([\s\S]*?)(?=(?:Chapter|Section|Psalm|Doctrine and Covenants)\s+\d+\s*\n|$)/gi;
    let match;
    while ((match = chapterPattern.exec(text)) !== null) {
      const chapterNum = parseInt(match[1], 10);
      let summary = match[2].replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      if (summary && summary.length > 10) {
        results.push({ chapterNum, summary });
      }
    }
  }

  // Deduplicate by chapter number (keep first occurrence)
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.chapterNum)) return false;
    seen.add(r.chapterNum);
    return true;
  });
}

// ─── Parse Bible Gateway footnotes from raw HTML ──────────────────────────────
function parseBgFootnotesHtml(html) {
  const footnotes = [];

  // BG footnotes are in <div class="footnotes">
  const fnSection = html.match(/<div[^>]*class="[^"]*footnotes[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/div|$)/i);
  if (!fnSection) return '';

  const section = fnSection[1];

  // Each footnote is an <li> or <p> with content
  const items = section.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
  for (const item of items) {
    const text = item
      .replace(/<a[^>]*class="[^"]*bibleref[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1')  // keep ref text
      .replace(/<[^>]+>/g, ' ')       // strip remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) footnotes.push(text);
  }

  // Fallback: try parsing <p> tags if no <li> found
  if (footnotes.length === 0) {
    const pItems = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const item of pItems) {
      const text = item
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) footnotes.push(text);
    }
  }

  return footnotes.join('\n');
}

// ─── Parse NET Bible translator notes from raw BG HTML ────────────────────────
// NET notes are in the same footnotes div as NLT but are prefixed with **tn** or **sn**.
// We keep only translator notes (tn) and study notes (sn) that contain linguistic insights.
// ─── Parse NABRE scholarly footnotes from raw BG HTML ─────────────────────────
// NABRE footnotes are in <div class="footnotes"> → <li> elements.
// They contain rich scholarly commentary with Hebrew/Greek terms, historical context,
// and literary analysis. We store them directly without AI summarization.
function parseNabreFootnotesHtml(html) {
  const footnotes = [];

  const fnSection = html.match(/<div[^>]*class="[^"]*footnotes[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/div|$)/i);
  if (!fnSection) return '';

  const section = fnSection[1];
  const items = section.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];

  for (const item of items) {
    const text = item
      .replace(/<a[^>]*class="[^"]*bibleref[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1')
      .replace(/<strong>([\s\S]*?)<\/strong>/gi, '$1')
      .replace(/<em>([\s\S]*?)<\/em>/gi, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text && text.length > 20) footnotes.push(text);
  }

  return footnotes.join('\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
