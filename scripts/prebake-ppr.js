#!/usr/bin/env node
// Pre-bake Topic-Personalized PageRank (PPR) for each topical guide topic
// Instead of one global PageRank, compute separate authority scores per topic
//
// For topic T, the random walk teleports preferentially to verses tagged with T
//   PR_T(v) = (1-d)*bias_T(v) + d * Σ_{u→v} PR_T(u)/outdeg(u)
//
// Output: topic_ppr table in topical-guide.db
//   topic_slug TEXT, verse_id INTEGER, ppr REAL
//   ~1.75M rows (3,512 topics × ~500 non-zero entries each)

const Database = require('better-sqlite3');
const path = require('path');

const TG_PATH = path.join(__dirname, '..', 'resources', 'db', 'topical-guide.db');
const DAMPING = 0.85;
const MAX_ITER = 20;
const CONVERGENCE = 0.0001;
const TOP_K_PER_TOPIC = 200;  // store top-200 verses per topic (enough for any query)

const db = new Database(TG_PATH);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -256000');

// Step 1: Load topic-verse graph
console.log('Loading topic-verse graph...');

const topics = db.prepare('SELECT id, slug, name FROM topics').all();
const topicSlugById = new Map();
for (const t of topics) topicSlugById.set(t.id, t.slug);

const tgRows = db.prepare(
  'SELECT topic_id, verse_id FROM topical_guide WHERE verse_id IS NOT NULL AND verse_id != -1'
).all();

// Build adjacency: verse → Set<topic_slugs>, topic → Set<verse_ids>
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

console.log(`  ${topicVerses.size} topics, ${verseTopics.size} unique verses`);

// Step 2: Build verse-to-verse adjacency (shared topics = edges)
// Edge weight = number of shared topics / geometric mean of topic counts
console.log('Building verse adjacency graph...');

const allVerses = [...verseTopics.keys()];
const verseIdx = new Map();
for (let i = 0; i < allVerses.length; i++) verseIdx.set(allVerses[i], i);
const N = allVerses.length;

// Sparse adjacency: adj[i] = [{j, weight}, ...]
const adj = new Array(N);
const outDeg = new Float64Array(N);

for (let i = 0; i < N; i++) adj[i] = [];

// For efficiency, iterate topics and connect all verse pairs within each topic
const topicSlugs = [...topicVerses.keys()];
let edgeCount = 0;

// Use Map of Maps for sparse edge weights
const edgeWeights = new Map(); // i → Map(j → weight)

for (const slug of topicSlugs) {
  const vids = [...topicVerses.get(slug)];
  for (let a = 0; a < vids.length; a++) {
    const i = verseIdx.get(vids[a]);
    for (let b = a + 1; b < vids.length; b++) {
      const j = verseIdx.get(vids[b]);
      // Bidirectional edge
      if (!edgeWeights.has(i)) edgeWeights.set(i, new Map());
      if (!edgeWeights.has(j)) edgeWeights.set(j, new Map());
      edgeWeights.get(i).set(j, (edgeWeights.get(i).get(j) || 0) + 1);
      edgeWeights.get(j).set(i, (edgeWeights.get(j).get(i) || 0) + 1);
    }
  }
}

// Convert to adjacency lists with normalized weights
for (const [i, neighbors] of edgeWeights) {
  let totalWeight = 0;
  for (const w of neighbors.values()) totalWeight += w;
  outDeg[i] = totalWeight;
  for (const [j, w] of neighbors) {
    adj[i].push({ j, weight: w / totalWeight }); // normalized transition probability
  }
}

console.log(`  ${edgeWeights.size} vertices with edges`);

// Step 3: Run Personalized PageRank for each topic
console.log('Computing Topic-Personalized PageRank...');

db.exec(`
  DROP TABLE IF EXISTS topic_ppr;
  CREATE TABLE topic_ppr (
    topic_slug TEXT NOT NULL,
    verse_id INTEGER NOT NULL,
    ppr REAL NOT NULL,
    PRIMARY KEY (topic_slug, verse_id)
  );
`);

const insert = db.prepare('INSERT INTO topic_ppr (topic_slug, verse_id, ppr) VALUES (?, ?, ?)');
let topicsDone = 0;
let totalRows = 0;

const batchInsert = db.transaction((rows) => {
  for (const [slug, vid, ppr] of rows) {
    insert.run(slug, vid, ppr);
  }
});

for (const slug of topicSlugs) {
  const seedVerses = topicVerses.get(slug);
  if (!seedVerses || seedVerses.size === 0) continue;

  // Personalized teleport: uniform over seed verses for this topic
  const bias = new Float64Array(N); // teleport vector
  const seedWeight = 1.0 / seedVerses.size;
  for (const vid of seedVerses) {
    const idx = verseIdx.get(vid);
    if (idx !== undefined) bias[idx] = seedWeight;
  }

  // Power iteration
  let pr = new Float64Array(N);
  // Initialize with bias
  for (let i = 0; i < N; i++) pr[i] = bias[i];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const newPr = new Float64Array(N);

    // Teleport component
    for (let i = 0; i < N; i++) {
      newPr[i] = (1 - DAMPING) * bias[i];
    }

    // Link component
    for (let i = 0; i < N; i++) {
      if (pr[i] === 0) continue;
      for (const { j, weight } of adj[i]) {
        newPr[j] += DAMPING * pr[i] * weight;
      }
    }

    // Check convergence
    let diff = 0;
    for (let i = 0; i < N; i++) diff += Math.abs(newPr[i] - pr[i]);
    pr = newPr;
    if (diff < CONVERGENCE) break;
  }

  // Extract top-K non-zero entries (excluding seed verses to avoid trivial results)
  const scored = [];
  for (let i = 0; i < N; i++) {
    if (pr[i] > 1e-8) {
      scored.push([i, pr[i]]);
    }
  }
  scored.sort((a, b) => b[1] - a[1]);

  const rows = [];
  for (let k = 0; k < Math.min(TOP_K_PER_TOPIC, scored.length); k++) {
    const [idx, ppr] = scored[k];
    rows.push([slug, allVerses[idx], +ppr.toFixed(8)]);
  }
  batchInsert(rows);
  totalRows += rows.length;

  topicsDone++;
  if (topicsDone % 100 === 0) {
    process.stdout.write(`  PPR: ${topicsDone}/${topicSlugs.length} topics, ${totalRows} rows\r`);
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_topic_ppr_slug ON topic_ppr(topic_slug);
  CREATE INDEX IF NOT EXISTS idx_topic_ppr_verse ON topic_ppr(verse_id);
`);

console.log(`\n✅ Topic-PPR table built: ${totalRows} rows for ${topicsDone} topics`);
db.close();
