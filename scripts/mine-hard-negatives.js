#!/usr/bin/env node
/**
 * mine-hard-negatives.js — Phase 4 hard-negative mining
 *
 * For each (anchor, positive) pair in resources/training-pairs.json, finds a
 * hard-negative verse: a verse that is geometrically close to the positive in
 * the current embedding space (high cosine similarity) but is NOT the correct
 * answer. These are the most valuable negatives for fine-tuning because they
 * force the model to discriminate subtle doctrinal, lexical, and narrative
 * differences instead of only separating unrelated content.
 *
 * Algorithm:
 *   1. Build positive-text → verse_id lookup from the LDS scripture DB.
 *   2. For each pair, find the verse_id of the positive verse.
 *   3. Query the prebaked verse_knn table (up to 20 neighbours per verse).
 *   4. Pick the closest neighbour whose text is neither the anchor nor the
 *      positive (similarity window: MIN_SIM – MAX_SIM).
 *   5. Emit { anchor, positive, hard_negative } triplet.
 *
 * Output: resources/training-pairs-hard-neg.json
 *   [ { "anchor": "...", "positive": "...", "hard_negative": "..." }, ... ]
 *
 * The output file is consumed by the fine-tuning notebooks which pass it to
 * MultipleNegativesRankingLoss. When a "negative" column is present,
 * sentence-transformers automatically treats it as an explicit hard negative in
 * addition to the in-batch negatives.
 *
 * Guardrails:
 *   - Hard negatives are drawn only from the current model's kNN geometry, so
 *     they are grounded in real similarity — not hand-picked theological lists.
 *   - MIN_SIM prevents "trivially wrong" negatives (unrelated verses).
 *   - MAX_SIM prevents "too close" negatives (near-duplicates that confuse training).
 *   - No verse from the same chapter as the positive is used as a hard negative.
 *   - Output is deterministically seeded for reproducibility.
 *
 * Usage:
 *   node scripts/mine-hard-negatives.js
 *   node scripts/mine-hard-negatives.js --limit 50000   # cap triplets
 *   node scripts/mine-hard-negatives.js --min-sim 0.55  # widen similarity window
 */
'use strict';

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────

const ROOT    = path.join(__dirname, '..');
const DB_DIR  = path.join(ROOT, 'resources', 'db');
const IN_FILE = path.join(ROOT, 'resources', 'training-pairs.json');
const OUT_FILE = path.join(ROOT, 'resources', 'training-pairs-hard-neg.json');

// Similarity window for hard negatives:
//   too low  → trivially wrong, weak training signal
//   too high → near-duplicates that poison the embedding space
const MIN_SIM   = 0.50;
const MAX_SIM   = 0.90;

// Deterministic PRNG (mulberry32)
let _seed = 42;
function seededRandom() {
  _seed += 0x6d2b79f5;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Parse CLI args
const args = process.argv.slice(2);
let LIMIT = 100000;
let MIN_SIM_OVERRIDE = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) LIMIT = parseInt(args[++i], 10);
  if (args[i] === '--min-sim' && args[i + 1]) MIN_SIM_OVERRIDE = parseFloat(args[++i]);
}
const effectiveMinSim = MIN_SIM_OVERRIDE ?? MIN_SIM;

// ── Load databases ────────────────────────────────────────────────────────────

console.log('Opening databases...');
const db      = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true, fileMustExist: true });
const db_graph = new Database(path.join(DB_DIR, 'verse-graph.db'),           { readonly: true, fileMustExist: true });
// Load optional translation DBs for positive-text lookup
function openOptional(filename) {
  const file = path.join(DB_DIR, filename);
  if (!fs.existsSync(file)) return null;
  try { return new Database(file, { readonly: true, fileMustExist: true }); } catch { return null; }
}
const db_ylt    = openOptional('ylt-scriptures-sqlite.db');
const db_nrsvue = openOptional('nrsvue-scriptures-sqlite.db');

// ── Build verse-text → verse_id lookup ───────────────────────────────────────
// We normalize whitespace and case for matching. The positive text in training
// pairs can have minor whitespace/punctuation differences from the stored text.

console.log('Building positive-text → verse_id lookup...');

function normalizeText(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const textToId   = new Map(); // normalized text → verse_id
const idToText   = new Map(); // verse_id → original scripture text
const idToChapter = new Map(); // verse_id → chapter_id

// Load all LDS verses (primary)
for (const row of db.prepare('SELECT v.id, v.scripture_text, v.chapter_id FROM verses v').all()) {
  const norm = normalizeText(row.scripture_text);
  if (norm.length >= 15) {
    textToId.set(norm, row.id);
    idToText.set(row.id, row.scripture_text);
    idToChapter.set(row.id, row.chapter_id);
  }
}
console.log(`  LDS: ${textToId.size.toLocaleString()} verse texts indexed`);

// Load translation verse texts (their verse_id aligns with LDS verse_id)
for (const [label, dbHandle] of [['YLT', db_ylt], ['NRSVUE', db_nrsvue]]) {
  if (!dbHandle) continue;
  let added = 0;
  for (const row of dbHandle.prepare('SELECT id, scripture_text FROM verses').all()) {
    const norm = normalizeText(row.scripture_text);
    if (norm.length >= 15 && !textToId.has(norm)) {
      textToId.set(norm, row.id); // translation text → same verse_id
      added++;
    }
  }
  console.log(`  ${label}: ${added.toLocaleString()} additional texts indexed`);
  dbHandle.close();
}

// ── Prepared statements ───────────────────────────────────────────────────────

const knnStmt = db_graph.prepare(`
  SELECT neighbor_id, similarity
  FROM verse_knn
  WHERE verse_id = ?
  ORDER BY rank ASC
  LIMIT 20
`);

// ── Load training pairs ───────────────────────────────────────────────────────

console.log(`\nLoading training pairs from ${path.relative(ROOT, IN_FILE)}...`);
const allPairs = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
console.log(`  ${allPairs.length.toLocaleString()} total pairs`);

// Shuffle deterministically so the output sample is diverse
for (let i = allPairs.length - 1; i > 0; i--) {
  const j = Math.floor(seededRandom() * (i + 1));
  [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
}

// ── Mine hard negatives ───────────────────────────────────────────────────────

console.log(`\nMining hard negatives (min_sim=${effectiveMinSim}, max_sim=${MAX_SIM}, limit=${LIMIT.toLocaleString()})...`);

const triplets = [];
let skippedNoId    = 0;
let skippedNoNeighbor = 0;
let processed = 0;

for (const pair of allPairs) {
  if (triplets.length >= LIMIT) break;
  processed++;

  if (!pair.anchor || !pair.positive) { skippedNoId++; continue; }

  // Look up the verse_id of the positive verse
  const normPositive = normalizeText(pair.positive);
  const positiveId   = textToId.get(normPositive);
  if (!positiveId) { skippedNoId++; continue; }

  const positiveChapter = idToChapter.get(positiveId);

  // Find hard negative from kNN
  const neighbors = knnStmt.all(positiveId);
  let hardNeg = null;

  for (const nb of neighbors) {
    // Similarity window
    if (nb.similarity < effectiveMinSim || nb.similarity > MAX_SIM) continue;
    // Skip same chapter (too trivially adjacent)
    if (idToChapter.get(nb.neighbor_id) === positiveChapter) continue;
    // Skip if the neighbor text is the same as the anchor
    const nbText = idToText.get(nb.neighbor_id);
    if (!nbText) continue;
    const normNbText = normalizeText(nbText);
    if (normNbText === normalizeText(pair.anchor)) continue;
    // Found a valid hard negative
    hardNeg = nbText;
    break;
  }

  if (!hardNeg) { skippedNoNeighbor++; continue; }

  triplets.push({ anchor: pair.anchor, positive: pair.positive, hard_negative: hardNeg });
}

// ── Write output ──────────────────────────────────────────────────────────────

const resultText = `${JSON.stringify(triplets, null, 2)}\n`;
fs.writeFileSync(OUT_FILE, resultText);

console.log(`\nResults:`);
console.log(`  pairs processed       : ${processed.toLocaleString()}`);
console.log(`  triplets written      : ${triplets.length.toLocaleString()}`);
console.log(`  skipped (no verse_id) : ${skippedNoId.toLocaleString()}`);
console.log(`  skipped (no neighbor) : ${skippedNoNeighbor.toLocaleString()}`);
console.log(`  output                : ${path.relative(ROOT, OUT_FILE)}`);

// Print a few samples for manual inspection
console.log('\nSample triplets:');
for (const t of triplets.slice(0, 3)) {
  console.log('  anchor:        ', t.anchor.slice(0, 80));
  console.log('  positive:      ', t.positive.slice(0, 80));
  console.log('  hard_negative: ', t.hard_negative.slice(0, 80));
  console.log();
}

db.close();
db_graph.close();
