#!/usr/bin/env node
// Pre-bake k-means verse clusters into verse-graph.db
// ~500 semantic clusters for approximate MMR diversity on mobile
// (penalize results from same cluster instead of computing cosine similarity)

const Database = require('better-sqlite3');
const path = require('path');

const EMB_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-embeddings.db');
const GRAPH_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-graph.db');
const NUM_CLUSTERS = 500;
const DIM = 384;
const MAX_ITER = 30;

const embDb = new Database(EMB_PATH, { readonly: true });
const db = new Database(GRAPH_PATH);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -256000');

// Create cluster table
db.exec(`
  DROP TABLE IF EXISTS verse_clusters;
  CREATE TABLE verse_clusters (
    verse_id INTEGER PRIMARY KEY,
    cluster_id INTEGER NOT NULL,
    centroid_distance REAL NOT NULL
  );
`);

// Load all embeddings
console.log('Loading embeddings...');
const allRows = embDb.prepare('SELECT verse_id, embedding FROM verse_embeddings ORDER BY verse_id').all();
const N = allRows.length;
const ids = new Int32Array(N);
const vecs = new Float32Array(N * DIM);

for (let i = 0; i < N; i++) {
  ids[i] = allRows[i].verse_id;
  const buf = allRows[i].embedding;
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, DIM);
  vecs.set(f32, i * DIM);
}
allRows.length = 0;
console.log(`  ${N} embeddings loaded`);

// K-means++ initialization
console.log(`Initializing ${NUM_CLUSTERS} centroids (k-means++)...`);
const centroids = new Float32Array(NUM_CLUSTERS * DIM);
const assignments = new Int32Array(N);

// Pick first centroid randomly
const first = Math.floor(Math.random() * N);
centroids.set(vecs.subarray(first * DIM, (first + 1) * DIM), 0);

// Pick remaining centroids proportional to squared distance
const minDist = new Float32Array(N).fill(Infinity);

for (let c = 1; c < NUM_CLUSTERS; c++) {
  // Update min distances to nearest centroid
  const prevOff = (c - 1) * DIM;
  for (let i = 0; i < N; i++) {
    const iOff = i * DIM;
    let dist = 0;
    for (let d = 0; d < DIM; d++) {
      const diff = vecs[iOff + d] - centroids[prevOff + d];
      dist += diff * diff;
    }
    if (dist < minDist[i]) minDist[i] = dist;
  }

  // Weighted random selection
  let totalDist = 0;
  for (let i = 0; i < N; i++) totalDist += minDist[i];
  let r = Math.random() * totalDist;
  let chosen = 0;
  for (let i = 0; i < N; i++) {
    r -= minDist[i];
    if (r <= 0) { chosen = i; break; }
  }
  centroids.set(vecs.subarray(chosen * DIM, (chosen + 1) * DIM), c * DIM);

  if (c % 50 === 0) process.stdout.write(`\r  Initialized ${c}/${NUM_CLUSTERS} centroids`);
}
console.log(`\r  Initialized ${NUM_CLUSTERS} centroids`);

// K-means iterations
console.log(`Running k-means (max ${MAX_ITER} iterations)...`);
const clusterSizes = new Int32Array(NUM_CLUSTERS);
const newCentroids = new Float64Array(NUM_CLUSTERS * DIM); // use float64 for accumulation

for (let iter = 0; iter < MAX_ITER; iter++) {
  // Assignment step: assign each verse to nearest centroid
  let changed = 0;
  for (let i = 0; i < N; i++) {
    const iOff = i * DIM;
    let bestCluster = 0;
    let bestDist = Infinity;
    for (let c = 0; c < NUM_CLUSTERS; c++) {
      const cOff = c * DIM;
      let dist = 0;
      for (let d = 0; d < DIM; d++) {
        const diff = vecs[iOff + d] - centroids[cOff + d];
        dist += diff * diff;
      }
      if (dist < bestDist) { bestDist = dist; bestCluster = c; }
    }
    if (assignments[i] !== bestCluster) { changed++; assignments[i] = bestCluster; }
  }

  console.log(`  Iteration ${iter + 1}: ${changed} reassignments (${(changed / N * 100).toFixed(1)}%)`);
  if (changed === 0) break;

  // Update step: recompute centroids
  newCentroids.fill(0);
  clusterSizes.fill(0);
  for (let i = 0; i < N; i++) {
    const c = assignments[i];
    clusterSizes[c]++;
    const cOff = c * DIM;
    const iOff = i * DIM;
    for (let d = 0; d < DIM; d++) newCentroids[cOff + d] += vecs[iOff + d];
  }
  for (let c = 0; c < NUM_CLUSTERS; c++) {
    if (clusterSizes[c] === 0) continue;
    const cOff = c * DIM;
    for (let d = 0; d < DIM; d++) centroids[cOff + d] = newCentroids[cOff + d] / clusterSizes[c];
  }
}

// Compute final distances and insert
console.log('Writing cluster assignments...');
const insert = db.prepare('INSERT INTO verse_clusters (verse_id, cluster_id, centroid_distance) VALUES (?, ?, ?)');
db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const c = assignments[i];
    const cOff = c * DIM;
    const iOff = i * DIM;
    let dist = 0;
    for (let d = 0; d < DIM; d++) {
      const diff = vecs[iOff + d] - centroids[cOff + d];
      dist += diff * diff;
    }
    insert.run(ids[i], c, +Math.sqrt(dist).toFixed(6));
  }
})();

db.exec('CREATE INDEX IF NOT EXISTS idx_vc_cluster ON verse_clusters(cluster_id)');

// Statistics
const stats = db.prepare(`
  SELECT cluster_id, COUNT(*) AS sz
  FROM verse_clusters GROUP BY cluster_id ORDER BY sz DESC LIMIT 5
`).all();
const emptyClusters = NUM_CLUSTERS - db.prepare('SELECT COUNT(DISTINCT cluster_id) AS n FROM verse_clusters').get().n;
console.log(`\n  Largest clusters: ${stats.map(s => `#${s.cluster_id}:${s.sz}`).join(', ')}`);
console.log(`  Empty clusters: ${emptyClusters}`);
console.log(`  Avg cluster size: ${(N / (NUM_CLUSTERS - emptyClusters)).toFixed(1)}`);

console.log(`\n✅ Verse clusters built: ${NUM_CLUSTERS} clusters for ${N} verses`);
db.close();
embDb.close();
