#!/usr/bin/env node
// ── RRF k Calibration: Grid Search for Optimal Fusion Constant ──────────────
//
// Problem: RRF_K=60 (Cormack et al. 2009) was tuned for web search with
// billions of documents. Our corpus has ~42k verses — the optimal k depends
// on the actual rank distribution of our sources.
//
// Method: For k ∈ {10, 20, 30, 40, 50, 60, 80, 100, 120}:
//   1. Run FTS query for each test anchor
//   2. Compute RRF fusion with that k
//   3. Find the rank of the known-relevant verse (the "positive")
//   4. Compute NDCG@10 across all test queries
//   5. Pick k that maximizes NDCG@10
//
// Uses a sample of training pairs as ground truth.

const Database = require('better-sqlite3');
const path = require('path');

const MAIN_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const PAIRS_PATH = path.join(__dirname, '..', 'resources', 'training-pairs.json');

const db = new Database(MAIN_PATH, { readonly: true });

// Load training pairs (sample for speed)
const allPairs = require(PAIRS_PATH);
const SAMPLE_SIZE = 500;
const pairs = [];
const step = Math.floor(allPairs.length / SAMPLE_SIZE);
for (let i = 0; i < allPairs.length && pairs.length < SAMPLE_SIZE; i += step) {
  pairs.push(allPairs[i]);
}
console.log(`Loaded ${pairs.length} test pairs from ${allPairs.length} total`);

// Build verse text → verse_id index for ground truth lookup
console.log('Building verse lookup index...');
const verseIndex = new Map();
const verseRows = db.prepare('SELECT id, scripture_text FROM verses').all();
for (const r of verseRows) {
  // Use first 100 chars as key to handle truncation in training pairs
  const key = r.scripture_text.substring(0, 100).toLowerCase().trim();
  verseIndex.set(key, r.id);
}

// Map each pair to {query, relevantVerseId}
const testQueries = [];
for (const p of pairs) {
  const key = p.positive.substring(0, 100).toLowerCase().trim();
  const vid = verseIndex.get(key);
  if (vid) testQueries.push({ query: p.anchor, verseId: vid });
}
console.log(`${testQueries.length} queries with known verse IDs`);

// Check if FTS table exists
const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scriptures_fts'").get();
if (!ftsExists) {
  console.error('ERROR: scriptures_fts table not found. Run the server once to build it.');
  process.exit(1);
}

// FTS query functions — AND and OR as separate sources (simulates multi-source)
function ftsSearchAND(query, limit = 100) {
  const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];
  const q = tokens.join(' AND ');
  try {
    return db.prepare(`
      SELECT verse_id, bm25(scriptures_fts) AS rank
      FROM scriptures_fts WHERE scriptures_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(q, limit);
  } catch { return []; }
}

function ftsSearchOR(query, limit = 100) {
  const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];
  const q = tokens.join(' OR ');
  try {
    return db.prepare(`
      SELECT verse_id, bm25(scriptures_fts) AS rank
      FROM scriptures_fts WHERE scriptures_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(q, limit);
  } catch { return []; }
}

function ftsSearchPhrase(query, limit = 100) {
  const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length < 2) return [];
  const q = '"' + tokens.join(' ') + '"';
  try {
    return db.prepare(`
      SELECT verse_id, bm25(scriptures_fts) AS rank
      FROM scriptures_fts WHERE scriptures_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(q, limit);
  } catch { return []; }
}

// RRF fusion with configurable k
function rrfFusion(rankedLists, k) {
  const scores = new Map();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const vid = list[i].verse_id;
      scores.set(vid, (scores.get(vid) || 0) + 1.0 / (k + i + 1));
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([vid]) => vid);
}

// NDCG@K computation
function dcg(relevantIds, rankedIds, atK) {
  let dcgScore = 0;
  for (let i = 0; i < Math.min(rankedIds.length, atK); i++) {
    const rel = relevantIds.has(rankedIds[i]) ? 1 : 0;
    dcgScore += rel / Math.log2(i + 2); // log2(rank+1), rank is 1-indexed
  }
  return dcgScore;
}

function ndcg(relevantIds, rankedIds, atK) {
  const idealRanked = rankedIds.filter(v => relevantIds.has(v))
    .concat(rankedIds.filter(v => !relevantIds.has(v)));
  const idealDcg = dcg(relevantIds, idealRanked, atK);
  if (idealDcg === 0) return 0;
  return dcg(relevantIds, rankedIds, atK) / idealDcg;
}

// Grid search
const K_VALUES = [10, 20, 30, 40, 50, 60, 80, 100, 120];
const AT_K = 10;

console.log('\nRunning grid search...');
console.log(`  k values: ${K_VALUES.join(', ')}`);
console.log(`  Metric: NDCG@${AT_K}`);
console.log();

// Pre-compute FTS results for all queries (same for all k values)
const queryResults = [];
let skipped = 0;
for (const tq of testQueries) {
  const andResults = ftsSearchAND(tq.query);
  const orResults = ftsSearchOR(tq.query);
  const phraseResults = ftsSearchPhrase(tq.query);
  if (andResults.length === 0 && orResults.length === 0) { skipped++; continue; }
  queryResults.push({ ...tq, sources: [andResults, orResults, phraseResults].filter(s => s.length > 0) });
}
console.log(`  ${queryResults.length} queries with FTS results (${skipped} skipped)`);

const results = [];

for (const k of K_VALUES) {
  let totalNdcg = 0;
  let totalMrr = 0; // Mean Reciprocal Rank as secondary metric
  let found = 0;

  for (const qr of queryResults) {
    const ranked = rrfFusion(qr.sources, k);
    const relevantSet = new Set([qr.verseId]);

    totalNdcg += ndcg(relevantSet, ranked, AT_K);

    // MRR
    const idx = ranked.indexOf(qr.verseId);
    if (idx >= 0) {
      totalMrr += 1.0 / (idx + 1);
      found++;
    }
  }

  const avgNdcg = totalNdcg / queryResults.length;
  const avgMrr = totalMrr / queryResults.length;

  results.push({ k, ndcg: avgNdcg, mrr: avgMrr, hitRate: found / queryResults.length });

  console.log(`  k=${String(k).padStart(3)}: NDCG@${AT_K}=${avgNdcg.toFixed(4)}  MRR=${avgMrr.toFixed(4)}  HitRate@100=${(100 * found / queryResults.length).toFixed(1)}%`);
}

// Find optimal k
results.sort((a, b) => b.ndcg - a.ndcg);
const best = results[0];
console.log(`\n  ► Optimal k = ${best.k} (NDCG@${AT_K}=${best.ndcg.toFixed(4)}, MRR=${best.mrr.toFixed(4)})`);

// Show comparison with current k=60
const current = results.find(r => r.k === 60);
if (current && current.k !== best.k) {
  const improvement = ((best.ndcg - current.ndcg) / current.ndcg * 100).toFixed(1);
  console.log(`  Current k=60: NDCG@${AT_K}=${current.ndcg.toFixed(4)} → ${improvement}% improvement with k=${best.k}`);
}

console.log(`\n✅ Update RRF_K in backend/index.js to ${best.k}`);
db.close();
