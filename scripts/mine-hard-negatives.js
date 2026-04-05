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
const MIN_OVERLAP = 0.08;

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
let MIN_OVERLAP_OVERRIDE = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) LIMIT = parseInt(args[++i], 10);
  if (args[i] === '--min-sim' && args[i + 1]) MIN_SIM_OVERRIDE = parseFloat(args[++i]);
  if (args[i] === '--min-overlap' && args[i + 1]) MIN_OVERLAP_OVERRIDE = parseFloat(args[++i]);
  if (/^\d+$/.test(args[i])) LIMIT = parseInt(args[i], 10);
}
const effectiveMinSim = MIN_SIM_OVERRIDE ?? MIN_SIM;
const effectiveMinOverlap = MIN_OVERLAP_OVERRIDE ?? MIN_OVERLAP;

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

function tokenizeText(t) {
  return normalizeText(t)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function tokenOverlapScore(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let shared = 0;
  for (const token of aSet) {
    if (bSet.has(token)) shared += 1;
  }
  return (2 * shared) / (aSet.size + bSet.size);
}

const textToId   = new Map(); // normalized text → verse_id
const idToText   = new Map(); // verse_id → original scripture text
const idToChapter = new Map(); // verse_id → chapter_id
const idToBook   = new Map(); // verse_id → book_id

// Load all LDS verses (primary)
for (const row of db.prepare('SELECT v.id, v.scripture_text, v.chapter_id, c.book_id FROM verses v JOIN chapters c ON c.id = v.chapter_id').all()) {
  const norm = normalizeText(row.scripture_text);
  if (norm.length >= 15) {
    textToId.set(norm, row.id);
    idToText.set(row.id, row.scripture_text);
    idToChapter.set(row.id, row.chapter_id);
    idToBook.set(row.id, row.book_id);
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

console.log(`\nMining hard negatives (min_sim=${effectiveMinSim}, min_overlap=${effectiveMinOverlap}, max_sim=${MAX_SIM}, limit=${LIMIT.toLocaleString()})...`);

const triplets = [];
let skippedNoId    = 0;
let skippedNoNeighbor = 0;
let processed = 0;
let sameBookSelections = 0;
let totalSimilarity = 0;
let totalOverlap = 0;

for (const pair of allPairs) {
  if (triplets.length >= LIMIT) break;
  processed++;

  if (!pair.anchor || !pair.positive) { skippedNoId++; continue; }

  // Look up the verse_id of the positive verse
  const normPositive = normalizeText(pair.positive);
  const positiveId   = textToId.get(normPositive);
  if (!positiveId) { skippedNoId++; continue; }

  const positiveChapter = idToChapter.get(positiveId);
  const positiveBook = idToBook.get(positiveId);
  const anchorTokens = tokenizeText(pair.anchor);
  const positiveTokens = tokenizeText(pair.positive);

  // Find the hardest safe negative from kNN: semantically near, lexically scaffolded,
  // but still clearly not the positive target.
  const neighbors = knnStmt.all(positiveId);
  let hardNeg = null;
  let bestCandidate = null;

  for (const nb of neighbors) {
    if (nb.similarity < effectiveMinSim || nb.similarity > MAX_SIM) continue;
    if (idToChapter.get(nb.neighbor_id) === positiveChapter) continue;
    const nbText = idToText.get(nb.neighbor_id);
    if (!nbText) continue;
    const normNbText = normalizeText(nbText);
    if (normNbText === normPositive) continue;
    if (normNbText === normalizeText(pair.anchor)) continue;
    const nbTokens = tokenizeText(nbText);
    const overlap = Math.max(
      tokenOverlapScore(anchorTokens, nbTokens),
      tokenOverlapScore(positiveTokens, nbTokens)
    );
    if (overlap < effectiveMinOverlap) continue;

    const sameBookBonus = idToBook.get(nb.neighbor_id) === positiveBook ? 0.08 : 0;
    const score = nb.similarity * 0.72 + overlap * 0.2 + sameBookBonus;
    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { text: nbText, similarity: nb.similarity, overlap, sameBook: sameBookBonus > 0, score };
    }
  }

  if (bestCandidate) {
    hardNeg = bestCandidate.text;
    totalSimilarity += bestCandidate.similarity;
    totalOverlap += bestCandidate.overlap;
    if (bestCandidate.sameBook) sameBookSelections += 1;
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
if (triplets.length > 0) {
  console.log(`  avg similarity        : ${(totalSimilarity / triplets.length).toFixed(3)}`);
  console.log(`  avg lexical overlap   : ${(totalOverlap / triplets.length).toFixed(3)}`);
  console.log(`  same-book negatives   : ${sameBookSelections.toLocaleString()} (${((sameBookSelections / triplets.length) * 100).toFixed(1)}%)`);
}
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
