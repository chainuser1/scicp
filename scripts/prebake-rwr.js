#!/usr/bin/env node
// Pre-bake RWR (Random Walk with Restart) related verses
// For each verse, walk the topic-adjacency graph with restart probability α
// to discover multi-hop connections that kNN (embedding similarity) misses
//
// r = α·W·r + (1-α)·e_v  (iterate until convergence)
// W = topic-adjacency transition matrix
// e_v = restart vector (all weight on seed verse)
//
// Output: verse_rwr table in verse-graph.db
//   verse_id, neighbor_id, rank, rwr_score
//   Top-20 RWR neighbors per verse (same shape as verse_knn for easy integration)

const Database = require('better-sqlite3');
const path = require('path');

const TG_PATH = path.join(__dirname, '..', 'resources', 'db', 'topical-guide.db');
const GRAPH_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-graph.db');

const ALPHA = 0.85;       // restart probability (higher = more local)
const MAX_ITER = 15;      // reduced — converges fast with high α
const CONVERGENCE = 1e-5;
const TOP_K = 20;          // top-K neighbors per verse
const CHUNK_SIZE = 500;
const PRUNE_THRESHOLD = 1e-7; // prune sparse vector entries below this

const tgDb = new Database(TG_PATH, { readonly: true });
const embDb = new Database(GRAPH_PATH);
embDb.pragma('journal_mode = WAL');
embDb.pragma('cache_size = -256000');

// Step 1: Build topic-mediated verse graph
console.log('Loading topic-verse graph...');

const topics = tgDb.prepare('SELECT id, slug FROM topics').all();
const topicSlugById = new Map();
for (const t of topics) topicSlugById.set(t.id, t.slug);

const tgRows = tgDb.prepare(
  'SELECT topic_id, verse_id FROM topical_guide WHERE verse_id IS NOT NULL AND verse_id != -1'
).all();

const verseTopics = new Map();  // verse_id → Set<slug>
const topicVerses = new Map();  // slug → Set<verse_id>

for (const { topic_id, verse_id } of tgRows) {
  const slug = topicSlugById.get(topic_id);
  if (!slug) continue;
  if (!verseTopics.has(verse_id)) verseTopics.set(verse_id, new Set());
  verseTopics.get(verse_id).add(slug);
  if (!topicVerses.has(slug)) topicVerses.set(slug, new Set());
  topicVerses.get(slug).add(verse_id);
}

const allVerses = [...verseTopics.keys()];
const verseIdx = new Map();
for (let i = 0; i < allVerses.length; i++) verseIdx.set(allVerses[i], i);
const N = allVerses.length;

console.log(`  ${N} verses in topic graph, ${topicVerses.size} topics`);

// Step 2: Build sparse transition matrix
// Edge between verses u,v = number of shared topics
// Normalize: transition prob from u to v = sharedTopics(u,v) / totalEdgeWeight(u)
console.log('Building sparse transition matrix...');

// adj[i] = [{j, prob}, ...] (normalized)
const adj = new Array(N);
for (let i = 0; i < N; i++) adj[i] = [];

// Build edges via topic co-membership
const edgeWeights = new Map(); // "i:j" → weight (use Map of Maps)
const adjMap = new Array(N);
for (let i = 0; i < N; i++) adjMap[i] = new Map();

for (const [slug, vids] of topicVerses) {
  const vidArr = [...vids];
  for (let a = 0; a < vidArr.length; a++) {
    const i = verseIdx.get(vidArr[a]);
    if (i === undefined) continue;
    for (let b = a + 1; b < vidArr.length; b++) {
      const j = verseIdx.get(vidArr[b]);
      if (j === undefined) continue;
      adjMap[i].set(j, (adjMap[i].get(j) || 0) + 1);
      adjMap[j].set(i, (adjMap[j].get(i) || 0) + 1);
    }
  }
}

// Normalize to transition probabilities
for (let i = 0; i < N; i++) {
  let total = 0;
  for (const w of adjMap[i].values()) total += w;
  if (total > 0) {
    for (const [j, w] of adjMap[i]) {
      adj[i].push({ j, prob: w / total });
    }
  }
}

// Free adjMap
for (let i = 0; i < N; i++) adjMap[i] = null;

console.log(`  Transition matrix built`);

// Step 3: Run RWR for each verse
console.log(`Computing RWR for ${N} verses...`);

embDb.exec(`
  DROP TABLE IF EXISTS verse_rwr;
  CREATE TABLE verse_rwr (
    verse_id INTEGER NOT NULL,
    neighbor_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    rwr_score REAL NOT NULL,
    PRIMARY KEY (verse_id, rank)
  );
`);

const insert = embDb.prepare(
  'INSERT INTO verse_rwr (verse_id, neighbor_id, rank, rwr_score) VALUES (?, ?, ?, ?)'
);

let versesDone = 0;
let totalRows = 0;
const startTime = Date.now();

const batchInsert = embDb.transaction((rows) => {
  for (const [vid, nid, rank, score] of rows) {
    insert.run(vid, nid, rank, score);
  }
});

// Process in chunks
for (let chunk = 0; chunk < N; chunk += CHUNK_SIZE) {
  const rows = [];
  const end = Math.min(chunk + CHUNK_SIZE, N);

  for (let seed = chunk; seed < end; seed++) {
    const seedVid = allVerses[seed];

    // If this verse has no edges, skip
    if (adj[seed].length === 0) continue;

    // Sparse RWR: track only non-zero entries via Map
    let r = new Map(); // idx → probability
    r.set(seed, 1.0);

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const newR = new Map();
      newR.set(seed, ALPHA); // restart component

      // Walk component (only iterate non-zero entries)
      for (const [i, prob] of r) {
        if (prob < PRUNE_THRESHOLD) continue;
        const contribution = (1 - ALPHA) * prob;
        for (const { j, prob: transProb } of adj[i]) {
          const val = contribution * transProb;
          if (val > PRUNE_THRESHOLD) {
            newR.set(j, (newR.get(j) || 0) + val);
          }
        }
      }

      // Check convergence
      let diff = 0;
      for (const [i, v] of newR) {
        diff += Math.abs(v - (r.get(i) || 0));
      }
      for (const [i, v] of r) {
        if (!newR.has(i)) diff += v;
      }
      r = newR;
      if (diff < CONVERGENCE) break;
    }

    // Extract top-K (excluding self)
    const scored = [];
    for (const [i, score] of r) {
      if (i === seed) continue;
      if (score > 1e-8) {
        scored.push([i, score]);
      }
    }
    scored.sort((a, b) => b[1] - a[1]);

    for (let k = 0; k < Math.min(TOP_K, scored.length); k++) {
      const [idx, score] = scored[k];
      rows.push([seedVid, allVerses[idx], k + 1, +score.toFixed(8)]);
    }

    versesDone++;
  }

  batchInsert(rows);
  totalRows += rows.length;

  const elapsed = (Date.now() - startTime) / 1000;
  const rate = versesDone / elapsed;
  const eta = (N - versesDone) / rate;
  process.stdout.write(
    `  RWR: ${versesDone}/${N} verses (${rate.toFixed(0)}/s, ETA ${(eta/60).toFixed(1)}min), ${totalRows} rows\r`
  );
}

embDb.exec(`
  CREATE INDEX IF NOT EXISTS idx_verse_rwr_vid ON verse_rwr(verse_id);
`);

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n✅ RWR table built: ${totalRows} rows for ${versesDone} verses in ${elapsed}s`);

tgDb.close();
embDb.close();
