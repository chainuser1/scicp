#!/usr/bin/env node
// Pre-bake verse k-Nearest Neighbors graph into verse-graph.db
// For each of 41,995 verses, store top-20 most similar verses by cosine similarity
// This replaces ALL runtime embedding lookups for related verses
//
// Approach: batch cosine similarity via dot product (vectors are L2-normalized)
// Memory: ~64MB for all embeddings in Float32, processes in chunks to stay manageable

const Database = require('better-sqlite3');
const path = require('path');

const EMB_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-embeddings.db');
const GRAPH_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-graph.db');
const K = 20; // top-K neighbors per verse
const DIM = 384;
const CHUNK_SIZE = 500; // process this many verses at a time

const embDb = new Database(EMB_PATH, { readonly: true });
const db = new Database(GRAPH_PATH);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -512000'); // 512MB cache

// Create kNN table
db.exec(`
  DROP TABLE IF EXISTS verse_knn;
  CREATE TABLE verse_knn (
    verse_id INTEGER NOT NULL,
    neighbor_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    similarity REAL NOT NULL,
    PRIMARY KEY (verse_id, rank)
  );
`);

// Load all embeddings into memory
console.log('Loading embeddings...');
const allRows = embDb.prepare('SELECT verse_id, embedding FROM verse_embeddings ORDER BY verse_id').all();
const N = allRows.length;
console.log(`  ${N} verse embeddings loaded (${DIM}-dim)`);

// Convert to typed arrays for fast dot product
const ids = new Int32Array(N);
const vecs = new Float32Array(N * DIM);

for (let i = 0; i < N; i++) {
  ids[i] = allRows[i].verse_id;
  const buf = allRows[i].embedding;
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, DIM);
  vecs.set(f32, i * DIM);
}

// Free raw rows
allRows.length = 0;
if (global.gc) global.gc();

console.log(`Computing kNN graph (K=${K})...`);
const startTime = Date.now();

const insert = db.prepare('INSERT INTO verse_knn (verse_id, neighbor_id, rank, similarity) VALUES (?, ?, ?, ?)');

let processed = 0;

// Process in chunks for transaction batching
for (let chunkStart = 0; chunkStart < N; chunkStart += CHUNK_SIZE) {
  const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, N);

  db.transaction(() => {
    for (let i = chunkStart; i < chunkEnd; i++) {
      // Compute dot product of verse[i] with ALL other verses
      // Since vectors are L2-normalized, dot product = cosine similarity
      const iOff = i * DIM;

      // Use a min-heap of size K to track top-K efficiently
      const topK = []; // {idx, sim}

      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const jOff = j * DIM;

        // Dot product (vectors are normalized → cosine similarity)
        let dot = 0;
        for (let d = 0; d < DIM; d++) {
          dot += vecs[iOff + d] * vecs[jOff + d];
        }

        if (topK.length < K) {
          topK.push({ idx: j, sim: dot });
          if (topK.length === K) {
            topK.sort((a, b) => a.sim - b.sim); // ascending, [0] is min
          }
        } else if (dot > topK[0].sim) {
          topK[0] = { idx: j, sim: dot };
          // Re-find minimum (partial sort)
          let minIdx = 0;
          for (let m = 1; m < K; m++) {
            if (topK[m].sim < topK[minIdx].sim) minIdx = m;
          }
          if (minIdx !== 0) {
            const tmp = topK[0];
            topK[0] = topK[minIdx];
            topK[minIdx] = tmp;
          }
        }
      }

      // Sort by similarity descending and insert
      topK.sort((a, b) => b.sim - a.sim);
      for (let r = 0; r < topK.length; r++) {
        insert.run(ids[i], ids[topK[r].idx], r + 1, +topK[r].sim.toFixed(6));
      }

      processed++;
    }
  })();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (processed / (Date.now() - startTime) * 1000).toFixed(1);
  const eta = ((N - processed) / rate).toFixed(0);
  process.stdout.write(`\r  ${processed}/${N} verses (${rate}/s, ${elapsed}s elapsed, ~${eta}s remaining)   `);
}

console.log('');

// Create index for neighbor lookups
db.exec('CREATE INDEX IF NOT EXISTS idx_knn_verse ON verse_knn(verse_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_knn_neighbor ON verse_knn(neighbor_id)');

const totalRows = db.prepare('SELECT COUNT(*) AS n FROM verse_knn').get().n;
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`✅ kNN graph built: ${totalRows} rows (${N} × ${K}) in ${elapsed}s`);

// Spot check: Hebrews 11:1 neighbors
const heb = db.prepare('SELECT neighbor_id, rank, similarity FROM verse_knn WHERE verse_id = 30174 ORDER BY rank LIMIT 5').all();
console.log('\n  Hebrews 11:1 (30174) top-5 neighbors:');
for (const r of heb) console.log(`    #${r.rank} verse_id=${r.neighbor_id} sim=${r.similarity}`);

db.close();
embDb.close();
