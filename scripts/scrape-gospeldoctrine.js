#!/usr/bin/env node
/**
 * scrape-gospeldoctrine.js
 * Scrapes gospeldoctrine.com for verse-by-verse doctrinal commentary and
 * church leader quotes, falling back to LDS Institute Teacher Manuals when
 * a chapter is not covered on gospeldoctrine.com.
 *
 * Priority:
 *   1. gospeldoctrine.com — single chapter page (e.g. genesis-3)
 *   2. gospeldoctrine.com — combined page (e.g. genesis-32-33, exodus-7-11)
 *   3. churchofjesuschrist.org — Institute Teacher Manual lesson for that chapter
 *
 * Usage:
 *   node scripts/scrape-gospeldoctrine.js           # resume from progress
 *   node scripts/scrape-gospeldoctrine.js --reset   # clear progress, restart
 *   node scripts/scrape-gospeldoctrine.js --dry-run # just print URLs
 *
 * Rate limit: ~1.5s between requests (gospeldoctrine), ~1s (LDS API)
 */

const Database = require('better-sqlite3');
const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');

const SCRIPTURES_DB  = path.join(__dirname, '../resources/db/lds-scriptures-sqlite.db');
const TAGS_DB        = path.join(__dirname, '../resources/db/verse-tags.db');
const PROGRESS_FILE  = path.join(__dirname, '../resources/db/gospeldoctrine-progress.json');
const DELAY_MS       = 1200;
const LDS_DELAY_MS   = 500;

const RESET   = process.argv.includes('--reset');
const DRY_RUN = process.argv.includes('--dry-run');

// ── URL map: LDS book_title → gospeldoctrine.com slug ────────────────────────

const GD_SLUGS = {
  // OT (volume 1)
  'Genesis':          { vol: 'old-testament',  slug: 'genesis' },
  'Exodus':           { vol: 'old-testament',  slug: 'exodus' },
  'Leviticus':        { vol: 'old-testament',  slug: 'leviticus' },
  'Numbers':          { vol: 'old-testament',  slug: 'numbers' },
  'Deuteronomy':      { vol: 'old-testament',  slug: 'deuteronomy' },
  'Joshua':           { vol: 'old-testament',  slug: 'joshua' },
  'Judges':           { vol: 'old-testament',  slug: 'judges' },
  'Ruth':             { vol: 'old-testament',  slug: 'ruth' },
  '1 Samuel':         { vol: 'old-testament',  slug: '1-samuel' },
  '2 Samuel':         { vol: 'old-testament',  slug: '2-samuel' },
  '1 Kings':          { vol: 'old-testament',  slug: '1-kings' },
  '2 Kings':          { vol: 'old-testament',  slug: '2-kings' },
  '1 Chronicles':     { vol: 'old-testament',  slug: '1-chronicles' },
  '2 Chronicles':     { vol: 'old-testament',  slug: '2-chronicles' },
  'Ezra':             { vol: 'old-testament',  slug: 'ezra' },
  'Nehemiah':         { vol: 'old-testament',  slug: 'nehemiah' },
  'Esther':           { vol: 'old-testament',  slug: 'esther' },
  'Job':              { vol: 'old-testament',  slug: 'job' },
  'Psalms':           { vol: 'old-testament',  slug: 'psalms' },
  'Proverbs':         { vol: 'old-testament',  slug: 'proverbs' },
  'Ecclesiastes':     { vol: 'old-testament',  slug: 'ecclesiastes' },
  'Song of Solomon':  { vol: 'old-testament',  slug: 'song-solomon' },
  'Isaiah':           { vol: 'old-testament',  slug: 'isaiah' },
  'Jeremiah':         { vol: 'old-testament',  slug: 'jeremiah' },
  'Lamentations':     { vol: 'old-testament',  slug: 'lamentations' },
  'Ezekiel':          { vol: 'old-testament',  slug: 'ezekiel' },
  'Daniel':           { vol: 'old-testament',  slug: 'daniel' },
  'Hosea':            { vol: 'old-testament',  slug: 'hosea' },
  'Joel':             { vol: 'old-testament',  slug: 'joel' },
  'Amos':             { vol: 'old-testament',  slug: 'amos' },
  'Obadiah':          { vol: 'old-testament',  slug: 'obadiah' },
  'Jonah':            { vol: 'old-testament',  slug: 'jonah' },
  'Micah':            { vol: 'old-testament',  slug: 'micah' },
  'Nahum':            { vol: 'old-testament',  slug: 'nahum' },
  'Habakkuk':         { vol: 'old-testament',  slug: 'habakkuk' },
  'Zephaniah':        { vol: 'old-testament',  slug: 'zephaniah' },
  'Haggai':           { vol: 'old-testament',  slug: 'haggai' },
  'Zechariah':        { vol: 'old-testament',  slug: 'zechariah' },
  'Malachi':          { vol: 'old-testament',  slug: 'malachi' },
  // NT (volume 2)
  'Matthew':          { vol: 'new-testament',  slug: 'matthew' },
  'Mark':             { vol: 'new-testament',  slug: 'mark' },
  'Luke':             { vol: 'new-testament',  slug: 'luke' },
  'John':             { vol: 'new-testament',  slug: 'john' },
  'Acts':             { vol: 'new-testament',  slug: 'acts' },
  'Romans':           { vol: 'new-testament',  slug: 'romans' },
  '1 Corinthians':    { vol: 'new-testament',  slug: '1-corinthians' },
  '2 Corinthians':    { vol: 'new-testament',  slug: '2-corinthians' },
  'Galatians':        { vol: 'new-testament',  slug: 'galatians' },
  'Ephesians':        { vol: 'new-testament',  slug: 'ephesians' },
  'Philippians':      { vol: 'new-testament',  slug: 'philippians' },
  'Colossians':       { vol: 'new-testament',  slug: 'colossians' },
  '1 Thessalonians':  { vol: 'new-testament',  slug: '1-thessalonians' },
  '2 Thessalonians':  { vol: 'new-testament',  slug: '2-thessalonians' },
  '1 Timothy':        { vol: 'new-testament',  slug: '1-timothy' },
  '2 Timothy':        { vol: 'new-testament',  slug: '2-timothy' },
  'Titus':            { vol: 'new-testament',  slug: 'titus' },
  'Philemon':         { vol: 'new-testament',  slug: 'philemon' },
  'Hebrews':          { vol: 'new-testament',  slug: 'hebrews' },
  'James':            { vol: 'new-testament',  slug: 'james' },
  '1 Peter':          { vol: 'new-testament',  slug: '1-peter' },
  '2 Peter':          { vol: 'new-testament',  slug: '2-peter' },
  '1 John':           { vol: 'new-testament',  slug: '1-john' },
  '2 John':           { vol: 'new-testament',  slug: '2-john' },
  '3 John':           { vol: 'new-testament',  slug: '3-john' },
  'Jude':             { vol: 'new-testament',  slug: 'jude' },
  'Revelation':       { vol: 'new-testament',  slug: 'revelation' },
  // BOM (volume 3)
  '1 Nephi':          { vol: 'book-mormon',    slug: '1-nephi' },
  '2 Nephi':          { vol: 'book-mormon',    slug: '2-nephi' },
  'Jacob':            { vol: 'book-mormon',    slug: 'jacob' },
  'Enos':             { vol: 'book-mormon',    slug: 'enos' },
  'Jarom':            { vol: 'book-mormon',    slug: 'jarom' },
  'Omni':             { vol: 'book-mormon',    slug: 'omni' },
  'Words of Mormon':  { vol: 'book-mormon',    slug: 'words-mormon' },
  'Mosiah':           { vol: 'book-mormon',    slug: 'mosiah' },
  'Alma':             { vol: 'book-mormon',    slug: 'alma' },
  'Helaman':          { vol: 'book-mormon',    slug: 'helaman' },
  '3 Nephi':          { vol: 'book-mormon',    slug: '3-nephi' },
  '4 Nephi':          { vol: 'book-mormon',    slug: '4-nephi' },
  'Mormon':           { vol: 'book-mormon',    slug: 'mormon' },
  'Ether':            { vol: 'book-mormon',    slug: 'ether' },
  'Moroni':           { vol: 'book-mormon',    slug: 'moroni' },
  // D&C (volume 4) — chapters resolved dynamically via section number
  'Doctrine and Covenants': { vol: 'doctrine-and-covenants', slug: 'dc' },
};

// D&C section → group mapping
function dcGroup(n) {
  if (n <= 20)  return 'sections-1-20';
  if (n <= 40)  return 'sections-21-40';
  if (n <= 60)  return 'sections-41-60';
  if (n <= 80)  return 'sections-61-80';
  if (n <= 100) return 'sections-81-100';
  if (n <= 120) return 'sections-101-120';
  return 'sections-121-138';
}

// Known combined D&C sections (they exist as single pages on the site)
const DC_COMBINED = { 15: '15-16', 16: '15-16' };

function buildUrl(bookTitle, chapterNum) {
  const info = GD_SLUGS[bookTitle];
  if (!info) return null;

  if (info.slug === 'dc') {
    // D&C: dynamic section path
    const sectionNum = DC_COMBINED[chapterNum] || String(chapterNum);
    const group = dcGroup(chapterNum);
    return `https://gospeldoctrine.com/doctrine-and-covenants/${group}/section-${sectionNum}`;
  }

  // Standard: /volume/book-slug/book-slug-N
  return `https://gospeldoctrine.com/${info.vol}/${info.slug}/${info.slug}-${chapterNum}`;
}

// ── HTTP fetch ────────────────────────────────────────────────────────────────

function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'Accept': 'text/html' },
      timeout: 20000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchPage(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return resolve(null); // not found → skip
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── HTML parsing ──────────────────────────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
                   '&#39;': "'", '&nbsp;': ' ', '&ldquo;': '"', '&rdquo;': '"',
                   '&lsquo;': "'", '&rsquo;': "'", '&mdash;': '—', '&ndash;': '–',
                   '&hellip;': '…', '&#8220;': '"', '&#8221;': '"',
                   '&#8216;': "'", '&#8217;': "'" };

function decodeHtml(str) {
  return str.replace(/&[a-z#0-9]+;/gi, m => ENTITIES[m] || m);
}

function stripTags(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim());
}

function collapseWs(s) {
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract the chapter number from a section heading.
 * e.g. "Genesis 35:1 Arise..." → 35,  "Ex. 22:1 ..." → 22
 * Returns null if no chapter ref found.
 */
function chapNumFromHeading(heading) {
  if (!heading) return null;
  const m = heading.match(/\b(\d+):\d+/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract the article field content from a gospeldoctrine.com page.
 * Returns the raw field HTML or null.
 */
function extractField(html) {
  const articleM = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
  if (!articleM) return null;
  const fieldM = articleM[1].match(/class="[^"]*field__item[^"]*"[^>]*>([\s\S]*)/);
  return fieldM ? fieldM[1] : null;
}

/**
 * Parse nodes (divs/paragraphs) after a section header.
 * Returns { summary, quotes[] }
 */
function parseNodes(afterH) {
  const nodes = [];
  const nodeRe = /<(p|div)([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = nodeRe.exec(afterH)) !== null) {
    const attrs = m[2] || '';
    const raw   = m[3];
    const text  = stripTags(raw).replace(/\s+/g, ' ').trim();
    if (!text || text === '\u00a0') continue;

    const isIndented = /margin-left/.test(attrs) || /margin-left/.test(raw);
    // Standalone speaker name: <strong>Name</strong> with no other content
    const isSpeaker = /^<strong>[^<]{2,60}<\/strong>$/.test(raw.trim()) &&
                      !/[.!?,;]/.test(stripTags(raw).trim());

    nodes.push({ text, isIndented, isSpeaker });
  }

  let summary = null;
  const quotes = [];
  let currentSpeaker = null;
  let quoteLines = [];

  const flushQuote = () => {
    if (currentSpeaker && quoteLines.length) {
      const qText = quoteLines.join(' ').replace(/\s+/g, ' ').trim();
      if (qText.length > 20) quotes.push({ speaker: currentSpeaker, text: qText });
    }
    currentSpeaker = null;
    quoteLines = [];
  };

  for (const node of nodes) {
    if (node.isSpeaker) {
      flushQuote();
      if (quotes.length < 2) currentSpeaker = node.text;
    } else if (currentSpeaker) {
      if (quoteLines.length < 8) quoteLines.push(node.text);
      if (/^\(.*\)$/.test(node.text) || node.text.startsWith('(') || node.text.endsWith(')')) {
        flushQuote();
      }
    } else if (!node.isIndented && !summary && node.text.length > 15) {
      // Take full first sentence(s) up to ~150 chars as summary
      const sentences = node.text.match(/[^.!?]+[.!?]+/g) || [node.text];
      summary = sentences.slice(0, 2).join(' ').trim();
      if (summary.length > 200) summary = summary.slice(0, 197) + '...';
    }
  }
  flushQuote();

  return { summary, quotes };
}

/**
 * Parse a gospeldoctrine.com chapter page.
 * Handles both <h4>-based (BOM) and <strong>-header-based (OT/NT) layouts.
 * Returns array of { heading, chapNum, summary, quotes[] }
 */
function parsePage(html) {
  const field = extractField(html);
  if (!field) return null;

  const results = [];

  // ── Try <h4> sections first (used by BOM pages) ───────────────────────────
  const h4Sections = field.split(/(?=<h4)/);
  if (h4Sections.length > 1) {
    for (const sec of h4Sections) {
      if (!sec.trim()) continue;
      const hM = sec.match(/<h4[^>]*>([\s\S]*?)<\/h4>/);
      const heading = hM ? stripTags(hM[1]).replace(/\s+/g, ' ').trim() : null;
      const afterH = hM ? sec.slice(hM.index + hM[0].length) : sec;
      const { summary, quotes } = parseNodes(afterH);
      if (!heading && !summary && quotes.length === 0) continue;
      results.push({ heading, chapNum: chapNumFromHeading(heading), summary, quotes });
    }
    return results;
  }

  // ── Fall back to <strong>-header sections (used by most OT/NT pages) ──────
  // Section headers look like: <div><strong>Book C:V heading text</strong></div>
  // We split the field on these strong-header divs
  const strongHeaderRe = /(<(?:div|p)[^>]*>\s*<strong>[^<]{5,150}<\/strong>\s*<\/(?:div|p)>)/g;
  const parts = field.split(strongHeaderRe);

  // parts = [before-first-header, header1, content1, header2, content2, ...]
  // Odd indices are headers, even indices (>=2) are content after each header
  let i = 0;

  // Content before the first header = intro block (no verse heading)
  const introPart = parts[0];
  if (introPart && introPart.trim()) {
    const { summary, quotes } = parseNodes(introPart);
    if (summary || quotes.length > 0) {
      results.push({ heading: null, chapNum: null, summary, quotes });
    }
  }

  for (i = 1; i < parts.length - 1; i += 2) {
    const headerHtml = parts[i];
    const bodyHtml   = parts[i + 1] || '';

    const heading = stripTags(headerHtml).replace(/\s+/g, ' ').trim();
    // Skip headings that look like speaker names or very short decorative titles
    if (heading.length < 8) continue;
    // Skip if it looks like a book/chapter title rather than a verse section
    // (verse sections contain a colon like "Genesis 35:1 ...")
    const hasVerseRef = /\d+:\d+/.test(heading);
    const { summary, quotes } = parseNodes(bodyHtml);

    if (!hasVerseRef && !summary && quotes.length === 0) continue;

    results.push({ heading, chapNum: chapNumFromHeading(heading), summary, quotes });
  }

  return results;
}

// ── LDS Institute Manual fallback ─────────────────────────────────────────────

const LDS_API = 'https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=';

// Manual slugs for each volume
const LDS_MANUALS = {
  OT:  'old-testament-institute-teacher-manual-2026',
  NT:  'new-testament-institute-teacher-manual-2024',
  BOM: 'book-of-mormon-teacher-manual',
  DC:  'doctrine-and-covenants-teacher-manual-2017',
  POGP:'the-pearl-of-great-price-teacher-manual-2018',
};

// Maps book_title → volume key
const BOOK_VOLUME = {};
['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
 '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
 'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
 'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
 'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
 'Malachi'].forEach(b => BOOK_VOLUME[b] = 'OT');
['Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians',
 'Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians',
 '1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter',
 '1 John','2 John','3 John','Jude','Revelation'].forEach(b => BOOK_VOLUME[b] = 'NT');
['1 Nephi','2 Nephi','Jacob','Enos','Jarom','Omni','Words of Mormon','Mosiah',
 'Alma','Helaman','3 Nephi','4 Nephi','Mormon','Ether','Moroni'].forEach(b => BOOK_VOLUME[b] = 'BOM');
['Doctrine and Covenants'].forEach(b => BOOK_VOLUME[b] = 'DC');
['Moses','Abraham','Joseph Smith—Matthew','Joseph Smith—History',
 'Articles of Faith'].forEach(b => BOOK_VOLUME[b] = 'POGP');

// lesson map: populated at startup. key = "BookTitle:chapNum" → lesson API URI
let lessonMap = {};

/**
 * Parse a manual TOC body and expand chapter ranges into the lesson map.
 * title examples: "Genesis 18–23", "1 Nephi 1–5", "Doctrine and Covenants 1",
 *                 "Moses 1:1–11", "Esther", "Ruth 1; 1 Samuel 1–7"
 */
function buildLessonMap(tocBody, lessonHref) {
  // Extract lesson title from the TOC link
  const titleM = tocBody.match(/<p[^>]*class="title"[^>]*>([^<]+)<\/p>/);
  if (!titleM) return;
  const title = titleM[1].trim();

  // Split on ";" to handle multi-book lessons like "Ruth 1; 1 Samuel 1–7"
  const parts = title.split(/\s*;\s*/);
  for (const part of parts) {
    // Match: "BookName chapRange" e.g. "Genesis 18–23" or "1 Nephi 1–5" or "Esther"
    // Also handle "Moses 1:1–11" (verse range within chapter 1)
    const m = part.trim().match(/^((?:\d\s+)?[A-Za-z][A-Za-z\s'–-]+?)\s+(\d+)(?:[–-](\d+))?(?::\d+(?:[–-]\d+)?)?$/);
    if (!m) continue;
    const book = m[1].trim().replace(/–/g, '-');
    const chapFrom = parseInt(m[2], 10);
    const chapTo   = m[3] ? parseInt(m[3], 10) : chapFrom;
    for (let c = chapFrom; c <= chapTo; c++) {
      lessonMap[`${book}:${c}`] = lessonHref;
    }
  }
}

/**
 * Fetch all lesson TOCs for all 5 manuals and populate lessonMap.
 */
async function loadLessonMaps() {
  for (const [, manualSlug] of Object.entries(LDS_MANUALS)) {
    const uri = `/manual/${manualSlug}`;
    let body;
    try {
      const json = await fetchPage(`${LDS_API}${uri}`);
      if (!json) continue;
      const d = JSON.parse(json);
      body = d?.content?.body || '';
    } catch (e) { continue; }

    // Extract all lesson links from TOC
    const linkRe = /href="(\/study\/manual\/[^?"]+)\?lang=eng"[^>]*>([\s\S]*?)<\/a>/g;
    let lm;
    while ((lm = linkRe.exec(body)) !== null) {
      const href  = lm[1];
      const inner = lm[2];
      buildLessonMap(inner, href);
    }
    await sleep(LDS_DELAY_MS);
  }
  console.log(`  Lesson map loaded: ${Object.keys(lessonMap).length} chapter→lesson entries`);
}

/**
 * Fetch an LDS manual lesson and extract doctrinal content.
 * Returns formatted summary string or null.
 */
async function fetchLdsLesson(uri, bookTitle, chapNum) {
  let json;
  try {
    json = await fetchPage(`${LDS_API}${uri}`);
  } catch (e) { return null; }
  if (!json) return null;

  let d;
  try { d = JSON.parse(json); } catch (e) { return null; }
  const body = d?.content?.body || '';
  if (!body) return null;

  const parts = [];

  // Extract Introduction section
  const introM = body.match(/<h2[^>]*>Introduction<\/h2>([\s\S]*?)(?=<h2|$)/i);
  if (introM) {
    const introText = stripTags(introM[1]).replace(/\s+/g, ' ').trim();
    if (introText.length > 30) {
      // Cap at ~300 chars
      const capped = introText.length > 300 ? introText.slice(0, 297) + '...' : introText;
      parts.push(`[Introduction]\n${capped}`);
    }
  }

  // Extract "Some Doctrines and Principles" bullet points
  const docM = body.match(/<h2[^>]*>Some Doctrines and Principles<\/h2>([\s\S]*?)(?=<h2|$)/i);
  if (docM) {
    const bullets = [...docM[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
      .map(m => stripTags(m[1]).replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 10)
      .slice(0, 5);
    if (bullets.length > 0) {
      parts.push(`[Key Doctrines]\n${bullets.map(b => '• ' + b).join('\n')}`);
    }
  }

  // Extract per-chapter subsections that reference our specific chapter
  // These are <h3> headings that contain a scripture ref with this chapter num
  const h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|<h2|$)/g;
  let hm;
  while ((hm = h3Re.exec(body)) !== null) {
    const h3Text = stripTags(hm[1]).replace(/\s+/g, ' ').trim();
    const subBody = hm[2];
    // Check if this subsection is specifically about our chapter
    const chRef = new RegExp(`${bookTitle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*${chapNum}:|\\b${chapNum}:\\d+`, 'i');
    if (!chRef.test(h3Text) && !chRef.test(stripTags(subBody).slice(0, 200))) continue;

    // Extract pullquotes / blockquotes / indented quotes
    const quoteM = [...subBody.matchAll(/class="pullquote"[^>]*>([\s\S]*?)<\/(?:div|blockquote|p)>/g)];
    let subParts = [];
    if (h3Text.length > 5) subParts.push(`[${h3Text}]`);

    // First commentary sentence from this subsection
    const subText = stripTags(subBody).replace(/\s+/g, ' ').trim();
    const firstSentence = subText.match(/[A-Z][^.!?]{20,200}[.!?]/);
    if (firstSentence) subParts.push(firstSentence[0].trim());

    // Pullquotes with attribution
    for (const qm of quoteM.slice(0, 2)) {
      const qt = stripTags(qm[1]).replace(/\s+/g, ' ').trim();
      if (qt.length > 20) subParts.push(`"${qt.slice(0, 200)}"`);
    }

    if (subParts.length > 1) parts.push(subParts.join('\n'));
    if (parts.length >= 4) break;
  }

  if (parts.length === 0) return null;

  let result = parts.join('\n\n');
  if (result.length > 3000) result = result.slice(0, 2997) + '...';
  return result.trim();
}

/**
 * Format parsed GD sections into a concise text summary for storage.
 * Filters to only sections matching chapNum (for combined pages).
 * Max ~3000 chars per chapter.
 */
function formatSummary(sections, filterChap) {
  if (!sections || sections.length === 0) return null;

  // For combined pages, filter to sections belonging to this chapter
  const relevant = (filterChap != null)
    ? sections.filter(s => s.chapNum === filterChap || s.chapNum === null)
    : sections;

  if (relevant.length === 0) return null;

  const parts = [];

  for (const sec of relevant) {
    const piece = [];
    if (sec.heading) piece.push(`[${sec.heading}]`);
    if (sec.summary) piece.push(sec.summary);
    if (sec.quotes.length > 0) {
      const q = sec.quotes[0];
      let qt = q.text.trim();
      if (qt.length > 250) qt = qt.slice(0, 247) + '...';
      piece.push(`${q.speaker}: "${qt}"`);
    }
    if (piece.length > 1) parts.push(piece.join('\n'));
  }

  if (parts.length === 0) return null;

  let result = parts.join('\n\n');
  if (result.length > 3000) {
    result = result.slice(0, 3000);
    const lastSection = result.lastIndexOf('\n\n');
    if (lastSection > 500) result = result.slice(0, lastSection);
    result += '\n\n[...continued]';
  }

  return result.trim() || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Probe combined-chapter URLs when a single chapter returns 404.
 * Fires up to 6 HEAD requests in parallel to find a matching combined page.
 * Most common patterns: N-1..N, N..N+1, N..N+2, N..N+4
 * Returns { html, combinedSlug } or null.
 */
async function probeCombined(info, chapterNum) {
  const { vol, slug } = info;
  // Most common patterns observed on gospeldoctrine.com
  const candidateSlugs = [
    `${slug}-${chapterNum}-${chapterNum+1}`,
    `${slug}-${chapterNum}-${chapterNum+2}`,
    `${slug}-${chapterNum}-${chapterNum+3}`,
    `${slug}-${chapterNum}-${chapterNum+4}`,
    `${slug}-${chapterNum-1}-${chapterNum}`,
    `${slug}-${chapterNum-2}-${chapterNum}`,
    `${slug}-${chapterNum}-${chapterNum+5}`,
    `${slug}-${chapterNum}-${chapterNum+6}`,
  ].filter(s => !/-0$/.test(s) && !/-(-\d+)/.test(s)); // no negative chapters

  // Probe in parallel batches of 4
  for (let i = 0; i < candidateSlugs.length; i += 4) {
    const batch = candidateSlugs.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (combo) => {
      const url = `https://gospeldoctrine.com/${vol}/${slug}/${combo}`;
      try {
        const html = await fetchPage(url);
        return html ? { html, combinedSlug: combo } : null;
      } catch (e) { return null; }
    }));
    const found = results.find(r => r !== null);
    if (found) return found;
    await sleep(200); // brief pause between batches
  }
  return null;
}

async function main() {
  const sdb = new Database(SCRIPTURES_DB, { readonly: true });
  const tdb = new Database(TAGS_DB);

  // Load progress
  let progress = {};
  if (!RESET && fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    console.log(`Resuming — ${Object.keys(progress).filter(k=>progress[k].status==='ok'||progress[k].status==='lds').length} chapters done`);
  } else if (RESET && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Progress reset');
  }

  // Load LDS lesson maps for fallback
  if (!DRY_RUN) {
    console.log('Loading LDS lesson maps...');
    await loadLessonMaps();
  }

  // Cache for combined pages already fetched (combinedSlug → sections[])
  const comboCache = {};

  const books    = sdb.prepare('SELECT * FROM books ORDER BY id').all();
  const chapters = sdb.prepare('SELECT c.id, c.book_id, c.chapter_number FROM chapters c ORDER BY c.id').all();
  const bookMap  = Object.fromEntries(books.map(b => [b.id, b]));

  console.log(`Total chapters: ${chapters.length}`);

  const upsertSummary = tdb.prepare(`
    INSERT INTO chapter_summaries (chapter_id, book_id, chapter_num, summary_text, summary_method)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chapter_id) DO UPDATE SET
      summary_text   = excluded.summary_text,
      summary_method = excluded.summary_method
  `);

  let done = 0, skipped = 0, notFound = 0, ldsFallback = 0, errors = 0;

  for (const chap of chapters) {
    const book = bookMap[chap.book_id];
    if (!book) continue;

    const key = `${book.book_title}:${chap.chapter_number}`;

    if (progress[key] && progress[key].status !== 'error') { skipped++; continue; }

    const url = buildUrl(book.book_title, chap.chapter_number);

    if (!url) {
      // No GD mapping — go straight to LDS fallback
      const lessonUri = lessonMap[key] || lessonMap[`${book.book_title}:${chap.chapter_number}`];
      if (lessonUri && !DRY_RUN) {
        const ldsSummary = await fetchLdsLesson(lessonUri, book.book_title, chap.chapter_number);
        if (ldsSummary) {
          upsertSummary.run(chap.id, book.id, chap.chapter_number, ldsSummary, 'lds-manual');
          ldsFallback++;
        }
        progress[key] = { status: 'lds', lessonUri };
      } else {
        progress[key] = { status: 'no-url' };
      }
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
      skipped++;
      await sleep(LDS_DELAY_MS);
      continue;
    }

    if (DRY_RUN) {
      console.log(`[DRY] ${key} → ${url}`);
      done++;
      continue;
    }

    // ── Step 1: Try direct GD page ──────────────────────────────────────────
    let html = null;
    try {
      html = await fetchPage(url);
    } catch (err) {
      console.error(`\n  ✗ ${key}: ${err.message}`);
      errors++;
      progress[key] = { status: 'error' };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
      await sleep(DELAY_MS);
      continue;
    }

    let summaryText = null;
    let method = 'gospeldoctrine';

    if (html) {
      // ── Parse direct page ────────────────────────────────────────────────
      const sections = parsePage(html);
      summaryText = formatSummary(sections, null);

    } else {
      // ── Step 2: Direct page 404 — try combined URL ───────────────────────
      const info = GD_SLUGS[book.book_title];
      if (info && info.slug !== 'dc') {
        // Check if we already have this combo cached
        const cacheKey = `${book.book_title}:combo`;
        let combo = null;

        // Look for an already-found combo that covers this chapter
        const cachedCombo = Object.keys(comboCache).find(k => {
          if (!k.startsWith(book.book_title + ':')) return false;
          const [,range] = k.split(':');
          const [from, to] = range.split('-').map(Number);
          return chap.chapter_number >= from && chap.chapter_number <= to;
        });

        if (cachedCombo) {
          const sections = comboCache[cachedCombo];
          summaryText = formatSummary(sections, chap.chapter_number);
          method = 'gospeldoctrine-combined';
        } else {
          const result = await probeCombined(info, chap.chapter_number);
          if (result) {
            const sections = parsePage(result.html) || [];
            // Parse range from combinedSlug e.g. "genesis-30-31" → [30,31]
            const rangeM = result.combinedSlug.match(/(\d+)-(\d+)$/);
            if (rangeM) {
              const cacheK = `${book.book_title}:${rangeM[1]}-${rangeM[2]}`;
              comboCache[cacheK] = sections;
            }
            summaryText = formatSummary(sections, chap.chapter_number);
            method = 'gospeldoctrine-combined';
          }
        }
      }

      // ── Step 3: Still nothing — LDS manual fallback ──────────────────────
      if (!summaryText) {
        const lessonUri = lessonMap[key];
        if (lessonUri) {
          summaryText = await fetchLdsLesson(lessonUri, book.book_title, chap.chapter_number);
          if (summaryText) {
            method = 'lds-manual';
            ldsFallback++;
          }
          await sleep(LDS_DELAY_MS);
        }
      }

      if (!summaryText) notFound++;
    }

    if (summaryText) {
      upsertSummary.run(chap.id, book.id, chap.chapter_number, summaryText, method);
    }

    progress[key] = { status: summaryText ? 'ok' : '404', method: summaryText ? method : undefined };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));

    done++;
    const total = done + skipped;
    const pct = (total / chapters.length * 100).toFixed(1);
    const srcTag = method === 'lds-manual' ? '[LDS]' : method === 'gospeldoctrine-combined' ? '[COMBO]' : '[GD]';
    process.stdout.write(`\r[${pct}%] ${key} ${srcTag} (ok:${done} skip:${skipped} 404:${notFound} lds:${ldsFallback} err:${errors})`);

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${done} scraped, ${skipped} skipped, ${notFound} not-found, ${ldsFallback} LDS fallbacks, ${errors} errors`);
  sdb.close();
  tdb.close();
}

main().catch(err => { console.error(err); process.exit(1); });
