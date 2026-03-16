#!/usr/bin/env node
// Pre-bake Truncated SVD / LSI (Latent Semantic Indexing) verse fingerprints
// Compress 10,878-dimension TF-IDF space into 100 latent semantic dimensions
//
// A ≈ U_k · Σ_k · V_k^T  (truncated SVD of the TF-IDF matrix)
// Each verse gets a 100-dim fingerprint capturing latent themes
//
// Uses power iteration method for top-k singular values (no numpy needed)
//
// Output: verse_svd table in verse-embeddings.db
//   verse_id INTEGER, svd_vector BLOB (100 × Float32 = 400 bytes)

const Database = require('better-sqlite3');
const path = require('path');

const MAIN_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const EMB_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-embeddings.db');
const NUM_DIMS = 100;       // latent dimensions
const MAX_ITER = 50;        // power iteration steps per singular vector
const MIN_DOC_FREQ = 3;     // skip extremely rare terms
const MAX_DOC_FREQ = 30000; // skip extremely common terms

const mainDb = new Database(MAIN_PATH, { readonly: true });
const embDb = new Database(EMB_PATH);
embDb.pragma('journal_mode = WAL');
embDb.pragma('cache_size = -256000');

// Step 1: Build TF-IDF matrix (sparse)
console.log('Building TF-IDF matrix...');

const vocabRows = mainDb.prepare('SELECT term, doc FROM scriptures_fts_vocab').all();
const vocab = [];
const termIdx = new Map();
for (const { term, doc } of vocabRows) {
  if (term.length >= 2 && doc >= MIN_DOC_FREQ && doc <= MAX_DOC_FREQ) {
    termIdx.set(term, vocab.length);
    vocab.push({ term, doc });
  }
}
const V = vocab.length; // vocabulary size
console.log(`  ${V} terms after filtering`);

const TOTAL_DOCS = mainDb.prepare('SELECT COUNT(*) AS n FROM verses').get().n;

// IDF vector
const idf = new Float64Array(V);
for (let i = 0; i < V; i++) {
  idf[i] = Math.log((TOTAL_DOCS + 1) / (vocab[i].doc + 1)) + 1;
}

// Load all verses
const verseRows = mainDb.prepare(
  'SELECT v.id AS verse_id, v.scripture_text FROM verses v ORDER BY v.id'
).all();
const M = verseRows.length; // number of documents
const verseIds = verseRows.map(r => r.verse_id);
console.log(`  ${M} verses`);

// Build sparse TF-IDF matrix: docVecs[i] = Map<termIdx, tfidf>
console.log('Computing TF-IDF vectors...');
const docVecs = new Array(M);

// Simple tokenizer matching FTS5 behavior
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s\-]/g, '').split(/\s+/).filter(t => t.length >= 2);
}

for (let d = 0; d < M; d++) {
  const tokens = tokenize(verseRows[d].scripture_text);
  const tf = new Map();
  for (const t of tokens) {
    const idx = termIdx.get(t);
    if (idx !== undefined) tf.set(idx, (tf.get(idx) || 0) + 1);
  }
  // TF-IDF with sublinear TF: (1 + log(tf)) * idf
  const vec = new Map();
  for (const [idx, count] of tf) {
    vec.set(idx, (1 + Math.log(count)) * idf[idx]);
  }
  docVecs[d] = vec;

  if ((d + 1) % 5000 === 0) process.stdout.write(`  TF-IDF: ${d + 1}/${M}\r`);
}
console.log(`  TF-IDF: ${M}/${M} done`);

// Step 2: Randomized SVD via power iteration
// We want top-k left singular vectors (document projections)
// Method: Halko-Martinsson-Tropp randomized SVD
//   1. Generate random Gaussian matrix Ω (V × k)
//   2. Y = A · Ω  (M × k projection)
//   3. Power iteration: for p steps: Y = A · (A^T · Y) (improves approximation)
//   4. QR decomposition of Y → Q (orthonormal basis)
//   5. B = Q^T · A (small k × V matrix)
//   6. SVD of B → Û·Σ·V^T
//   7. U = Q · Û

console.log(`\nComputing Randomized SVD (${NUM_DIMS} dimensions)...`);

// Utility: sparse matrix-vector multiply A·x where A is docVecs (M×V sparse), x is V-dim
function sparseMatVec(x) {
  const result = new Float64Array(M);
  for (let d = 0; d < M; d++) {
    let dot = 0;
    for (const [idx, val] of docVecs[d]) {
      dot += val * x[idx];
    }
    result[d] = dot;
  }
  return result;
}

// A^T · y where y is M-dim, result is V-dim
function sparseTransMatVec(y) {
  const result = new Float64Array(V);
  for (let d = 0; d < M; d++) {
    if (Math.abs(y[d]) < 1e-12) continue;
    for (const [idx, val] of docVecs[d]) {
      result[idx] += val * y[d];
    }
  }
  return result;
}

// Generate random Gaussian matrix and project
const K = NUM_DIMS + 10; // oversampling for stability
const omega = new Array(K);
for (let j = 0; j < K; j++) {
  omega[j] = new Float64Array(V);
  for (let i = 0; i < V; i++) {
    // Box-Muller transform for Gaussian
    const u1 = Math.random();
    const u2 = Math.random();
    omega[j][i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// Y = A · Ω (project each column)
console.log('  Initial projection...');
let Y = new Array(K);
for (let j = 0; j < K; j++) {
  Y[j] = sparseMatVec(omega[j]);
}

// Power iteration: Y = A · A^T · Y  (2 iterations for better approximation)
const POWER_ITER = 2;
for (let p = 0; p < POWER_ITER; p++) {
  console.log(`  Power iteration ${p + 1}/${POWER_ITER}...`);
  for (let j = 0; j < K; j++) {
    const atY = sparseTransMatVec(Y[j]); // V-dim
    Y[j] = sparseMatVec(atY);            // M-dim
  }
  // Re-orthogonalize via modified Gram-Schmidt
  for (let j = 0; j < K; j++) {
    for (let i = 0; i < j; i++) {
      let dot = 0;
      for (let d = 0; d < M; d++) dot += Y[j][d] * Y[i][d];
      for (let d = 0; d < M; d++) Y[j][d] -= dot * Y[i][d];
    }
    // Normalize
    let norm = 0;
    for (let d = 0; d < M; d++) norm += Y[j][d] * Y[j][d];
    norm = Math.sqrt(norm);
    if (norm > 1e-10) {
      for (let d = 0; d < M; d++) Y[j][d] /= norm;
    }
  }
}

// QR decomposition via Gram-Schmidt → Q columns are the basis
console.log('  Orthogonalization...');
const Q = new Array(K);
for (let j = 0; j < K; j++) {
  Q[j] = new Float64Array(Y[j]);
  for (let i = 0; i < j; i++) {
    let dot = 0;
    for (let d = 0; d < M; d++) dot += Q[j][d] * Q[i][d];
    for (let d = 0; d < M; d++) Q[j][d] -= dot * Q[i][d];
  }
  let norm = 0;
  for (let d = 0; d < M; d++) norm += Q[j][d] * Q[j][d];
  norm = Math.sqrt(norm);
  if (norm > 1e-10) {
    for (let d = 0; d < M; d++) Q[j][d] /= norm;
  }
}

// B = Q^T · A  (K × V) — we compute each row of B as Q[j]^T · A
console.log('  Computing projected matrix B...');
const B = new Array(K);
for (let j = 0; j < K; j++) {
  B[j] = sparseTransMatVec(Q[j]); // V-dim: Q[j]^T · A
}

// Simple SVD of the small B matrix via power iteration on B·B^T (K×K)
// We need the top NUM_DIMS singular values/vectors
console.log('  Small SVD of projected matrix...');

// B·B^T (K × K)
const BBT = new Array(K);
for (let i = 0; i < K; i++) {
  BBT[i] = new Float64Array(K);
  for (let j = 0; j < K; j++) {
    let dot = 0;
    for (let v = 0; v < V; v++) dot += B[i][v] * B[j][v];
    BBT[i][j] = dot;
  }
}

// Eigendecomposition of BBT via power iteration (get top NUM_DIMS eigenvectors)
const eigVecs = new Array(NUM_DIMS);
const eigVals = new Float64Array(NUM_DIMS);

for (let d = 0; d < NUM_DIMS; d++) {
  // Random initial vector
  let vec = new Float64Array(K);
  for (let i = 0; i < K; i++) vec[i] = Math.random() - 0.5;

  // Power iteration
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const newVec = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) newVec[i] += BBT[i][j] * vec[j];
    }
    // Deflate: remove components of previous eigenvectors
    for (let prev = 0; prev < d; prev++) {
      let dot = 0;
      for (let i = 0; i < K; i++) dot += newVec[i] * eigVecs[prev][i];
      for (let i = 0; i < K; i++) newVec[i] -= dot * eigVecs[prev][i];
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < K; i++) norm += newVec[i] * newVec[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-10) {
      for (let i = 0; i < K; i++) newVec[i] /= norm;
    }
    vec = newVec;
  }
  eigVecs[d] = vec;

  // Eigenvalue = v^T · BBT · v
  let lambda = 0;
  for (let i = 0; i < K; i++) {
    let row = 0;
    for (let j = 0; j < K; j++) row += BBT[i][j] * vec[j];
    lambda += vec[i] * row;
  }
  eigVals[d] = lambda;

  if ((d + 1) % 20 === 0) process.stdout.write(`  Eigenvalues: ${d + 1}/${NUM_DIMS}\r`);
}
console.log(`  Eigenvalues: ${NUM_DIMS}/${NUM_DIMS} done`);

// Final document projections: U = Q · eigVecs (each column)
// doc_projection[d] = [Σ_j Q[j][d] * eigVecs[dim][j] for each dim]
console.log('Computing verse projections...');

embDb.exec(`
  DROP TABLE IF EXISTS verse_svd;
  CREATE TABLE verse_svd (
    verse_id INTEGER PRIMARY KEY,
    svd_vector BLOB NOT NULL
  );
`);

const insertSvd = embDb.prepare('INSERT INTO verse_svd (verse_id, svd_vector) VALUES (?, ?)');

const tx = embDb.transaction(() => {
  for (let d = 0; d < M; d++) {
    const proj = new Float32Array(NUM_DIMS);
    for (let dim = 0; dim < NUM_DIMS; dim++) {
      let val = 0;
      for (let j = 0; j < K; j++) {
        val += Q[j][d] * eigVecs[dim][j];
      }
      // Scale by sqrt(eigenvalue) for proper weighting
      proj[dim] = val * Math.sqrt(Math.max(0, eigVals[dim]));
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < NUM_DIMS; i++) norm += proj[i] * proj[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-10) {
      for (let i = 0; i < NUM_DIMS; i++) proj[i] /= norm;
    }
    insertSvd.run(verseIds[d], Buffer.from(proj.buffer));

    if ((d + 1) % 5000 === 0) process.stdout.write(`  Projections: ${d + 1}/${M}\r`);
  }
});

tx();
console.log(`  Projections: ${M}/${M} done`);

// Print explained variance
const totalVar = eigVals.reduce((s, v) => s + Math.max(0, v), 0);
let cumVar = 0;
const milestones = [10, 20, 50, 100];
console.log('\nExplained variance:');
for (let i = 0; i < NUM_DIMS; i++) {
  cumVar += Math.max(0, eigVals[i]);
  if (milestones.includes(i + 1)) {
    console.log(`  Top ${i + 1} dims: ${(100 * cumVar / totalVar).toFixed(1)}%`);
  }
}

console.log(`\n✅ SVD table built: ${M} verses × ${NUM_DIMS} dimensions`);
mainDb.close();
embDb.close();
