#!/usr/bin/env node
/**
 * export-training-pairs-summary.js
 *
 * Training pair strategy: verse_summary → verse_text
 * ──────────────────────────────────────────────────
 * Anchor   : verse_summary  (short semantic description of what the verse means)
 * Positive : verse_text     (the actual scripture verse from lds-scriptures-sqlite.db)
 * Hard Neg : a different verse_text from the SAME CHAPTER
 *            (forces fine-grained distinction, not just broad topic clusters)
 *
 * Why this works for BGE-M3:
 *   Summaries are query-shaped — they describe intent and meaning.
 *   Verse texts are what users want retrieved.
 *   The semantic gap between summary ↔ verse is exactly what BGE-M3
 *   needs to bridge for your scripture search use case.
 *
 * Output:
 *   resources/training-pairs.json
 *   [ { "anchor": "...", "positive": "...", "hard_negative": "..." }, ... ]
 *   (pairs without a hard negative omit that field gracefully)
 *
 * Schema expected in verse-summaries.db:
 *   verse_summaries(verse_id INTEGER, verse_summary TEXT, status TEXT)
 *   Only rows with status = 'ai-verified' are used.
 *   Adjust the WHERE clause below if your status value differs.
 *
 * Usage:
 *   node scripts/export-training-pairs-summary.js
 *   node scripts/export-training-pairs-summary.js --no-hard-negatives
 */

'use strict';

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MIN_VERSE_LEN  = 15;  // only verse texts are length-guarded
const HARD_NEGATIVES = !args.includes('--no-hard-negatives');
// Summaries are NOT length-filtered — ai-verified status already guarantees quality.

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT   = path.join(__dirname, '..');
const DB_DIR = path.join(ROOT, 'resources/db');
const OUT    = path.join(ROOT, 'resources/training-pairs.json');

// ── Deterministic PRNG (LCG, seed=42) ────────────────────────────────────────
// Never use Math.random() — this ensures identical output across runs.
let _seed = 42;
function seededRandom() {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return _seed / 2147483647;
}

function seededChoice(arr) {
  return arr[Math.floor(seededRandom() * arr.length)];
}

// ── Text helpers ──────────────────────────────────────────────────────────────
function clean(text, minLen = 15) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  return t.length >= minLen ? t : null;
}

// ── Step 1: Load LDS verse text ───────────────────────────────────────────────
console.log('\n── Step 1: Loading LDS verse texts ──────────────────────────────');
const ldsDbPath = path.join(DB_DIR, 'lds-scriptures-sqlite.db');
if (!fs.existsSync(ldsDbPath)) throw new Error(`LDS DB not found: ${ldsDbPath}`);

const ldsDb = new Database(ldsDbPath, { readonly: true });

/** verse_id → verse_text */
const verseText   = new Map();
/** verse_id → chapter_id */
const verseChapter = new Map();
/** chapter_id → verse_id[] */
const chapterVerses = new Map();

for (const r of ldsDb.prepare('SELECT id, chapter_id, scripture_text FROM verses').all()) {
  const t = clean(r.scripture_text, MIN_VERSE_LEN);
  if (!t) continue;
  verseText.set(r.id, t);
  verseChapter.set(r.id, r.chapter_id);
  if (!chapterVerses.has(r.chapter_id)) chapterVerses.set(r.chapter_id, []);
  chapterVerses.get(r.chapter_id).push(r.id);
}
ldsDb.close();

console.log(`  Verses loaded  : ${verseText.size.toLocaleString()}`);
console.log(`  Chapters loaded: ${chapterVerses.size.toLocaleString()}`);

// ── Step 2: Load verse summaries ──────────────────────────────────────────────
console.log('\n── Step 2: Loading verse summaries ──────────────────────────────');
const summaryDbPath = path.join(DB_DIR, 'verse-summaries.db');
if (!fs.existsSync(summaryDbPath)) throw new Error(`verse-summaries.db not found: ${summaryDbPath}`);

const vsDb = new Database(summaryDbPath, { readonly: true });

// Detect schema — support both column naming conventions:
//   verse_summary  (single column)
//   paragraph_1 / paragraph_2  (two-paragraph schema from your existing pipeline)
const cols = vsDb.pragma('table_info(verse_summaries)').map(c => c.name);
const hasSingleSummary = cols.includes('verse_summary') || cols.includes('summary');
const summaryColumn = cols.includes('verse_summary') ? 'verse_summary' : (cols.includes('summary') ? 'summary' : null);
const hasParagraphs    = cols.includes('paragraph_1') && cols.includes('paragraph_2');

if (!hasSingleSummary && !hasParagraphs) {
  throw new Error(
    `verse_summaries table has neither 'verse_summary' nor 'paragraph_1/paragraph_2' columns.\n` +
    `Columns found: ${cols.join(', ')}`
  );
}

console.log(`  Schema detected: ${hasSingleSummary ? `${summaryColumn} (single column)` : 'paragraph_1 + paragraph_2'}`);

// Build query based on detected schema
// STATUS FILTER: adjust 'ai-verified' to match your actual status values if needed.
// Run:  SELECT DISTINCT status FROM verse_summaries;  to check.
const STATUS_FILTER = `status = 'ai-verified'`;

let summaryQuery;
if (hasSingleSummary) {
  summaryQuery = `SELECT verse_id, ${summaryColumn} AS verse_summary FROM verse_summaries WHERE ${STATUS_FILTER}`;
} else {
  summaryQuery = `SELECT verse_id, paragraph_1, paragraph_2 FROM verse_summaries WHERE ${STATUS_FILTER}`;
}

/** verse_id → full_summary (single anchor per verse) */
const verseSummary = new Map();

function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Drop leading header-like lines (wrapped in **, __, ``, ~, or short title-like lines)
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const wrapped = (
      /^\*{1,}.*\*{1,}$/.test(line) ||
      /^_{1,}.*_{1,}$/.test(line) ||
      /^`.*`$/.test(line) ||
      /^~+.*~+$/.test(line) ||
      /^#+\s*/.test(line)
    );
    const shortNoPunct = line.split(/\s+/).length <= 12 && !/[.!?]/.test(line);
    if (wrapped || shortNoPunct) i++; else break;
  }

  const remaining = lines.slice(i).join(' ');
  if (!remaining) return null;

  // Remove markdown links, emphasis, code markers, bullets and collapse whitespace
  let cleaned = remaining.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/[*_`~]+/g, '');
  cleaned = cleaned.replace(/^\s*[-•]\s*/gm, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.length ? cleaned : null;
}

for (const r of vsDb.prepare(summaryQuery).all()) {
  const vid = r.verse_id;
  if (!verseText.has(vid)) continue; // no corresponding verse text — skip
  let raw;
  if (hasSingleSummary) {
    raw = r.verse_summary;
  } else {
    raw = joinParagraphs(r.paragraph_1, r.paragraph_2);
  }

  const full = normalizeSummary(raw);
  if (full) verseSummary.set(vid, full);
}
vsDb.close();

console.log(`  Summaries matched to verses: ${verseSummary.size.toLocaleString()}`);

if (verseSummary.size === 0) {
  console.error('\n⚠️  No summaries matched. Possible causes:');
  console.error(`  1. Status filter mismatch — check: SELECT DISTINCT status FROM verse_summaries;`);
  console.error(`  2. verse_id values in verse-summaries.db don't match lds-scriptures-sqlite.db`);
  process.exit(1);
}

// ── Step 3: Build pairs ───────────────────────────────────────────────────────
console.log('\n── Step 3: Building training pairs ──────────────────────────────');

const pairs = [];
let hardNegAdded   = 0;
let noHardNegAvail = 0;

for (const [vid, summary] of verseSummary) {
  const positive = verseText.get(vid);
  if (!positive) continue; // defensive — already filtered above

  const pair = { anchor: summary, positive };

  // ── Hard negative: a different verse from the same chapter ─────────────────
  if (HARD_NEGATIVES) {
    const chapId    = verseChapter.get(vid);
    const siblings  = chapterVerses.get(chapId) ?? [];
    const candidates = siblings.filter(id => id !== vid && verseText.has(id));

    if (candidates.length > 0) {
      const hardNegId   = seededChoice(candidates);
      pair.hard_negative = verseText.get(hardNegId);
      hardNegAdded++;
    } else {
      noHardNegAvail++;
    }
  }

  pairs.push(pair);
}

console.log(`  Pairs built      : ${pairs.length.toLocaleString()}`);
if (HARD_NEGATIVES) {
  console.log(`  With hard negs   : ${hardNegAdded.toLocaleString()}`);
  console.log(`  Without hard negs: ${noHardNegAvail.toLocaleString()} (single-verse chapters)`);
}

// ── Step 4: Deduplicate ───────────────────────────────────────────────────────
console.log('\n── Step 4: Deduplication ─────────────────────────────────────────');
const seen      = new Set();
const deduped   = pairs.filter(p => {
  const key = p.anchor + '\x00' + p.positive;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const removed = pairs.length - deduped.length;
if (removed > 0) console.log(`  Removed ${removed.toLocaleString()} exact duplicates`);
else             console.log(`  No duplicates found`);

// ── Step 5: Deterministic shuffle ─────────────────────────────────────────────
// Ensures batches during training see a uniform mix, not all OT then all NT.
console.log('\n── Step 5: Shuffling ─────────────────────────────────────────────');
deduped.sort(() => seededRandom() - 0.5);
console.log('  Shuffled (seed=42, deterministic)');

// ── Step 6: Write output ──────────────────────────────────────────────────────
console.log('\n── Step 6: Writing output ───────────────────────────────────────');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(deduped, null, 0));
const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`
════════════════════════════════════════════════════════════
 Training pairs export complete
════════════════════════════════════════════════════════════
 Strategy     : verse_summary → verse_text
 Hard negatives: ${HARD_NEGATIVES ? 'YES (same-chapter verse)' : 'NO (--no-hard-negatives passed)'}
 Total pairs  : ${deduped.length.toLocaleString()}
 Duplicates   : ${removed.toLocaleString()} removed
 Output       : ${OUT}
 Size         : ${sizeMB} MB
════════════════════════════════════════════════════════════

BGE-M3 training command (Kaggle):
  python3 scripts/finetune-kaggle.py \\
    --model bge-m3 \\
    --profile fast \\
    --output scripture-bge-m3

Troubleshooting:
  • 0 pairs → check status filter value in verse_summaries
  • Run: SELECT DISTINCT status FROM verse_summaries;
  • Adjust STATUS_FILTER constant in this script if needed
`);