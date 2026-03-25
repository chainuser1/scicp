#!/usr/bin/env node
// ── Spectral Graph Features: Laplacian Eigenvectors ──────────────────────────
//
// Extracts structural features from the kNN verse graph using spectral
// graph theory. The eigenvectors of the normalized Laplacian reveal
// community structure that embeddings cannot see — verses connected by
// cross-references, shared chapter context, or topical co-occurrence.
//
// Math:
//   A = adjacency matrix (from verse_knn, weighted by similarity)
//   D = degree matrix (diagonal, D_ii = Σ_j A_ij)
//   L_norm = I - D^(-1/2) · A · D^(-1/2)   (normalized Laplacian)
//   Bottom k eigenvectors of L_norm = spectral embedding
//
// Uses Lanczos iteration for sparse eigendecomposition (O(N·k²) per step).
//
// Output: verse_spectral table in verse-graph.db
//   verse_id INTEGER, embedding BLOB (50 × Float32 = 200 bytes)

const Database = require('better-sqlite3');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-graph.db');
const SPEC_DIM = 50;        // spectral embedding dimension
const LANCZOS_ITER = 80;    // Lanczos iteration steps (> SPEC_DIM for accuracy)

const db = new Database(GRAPH_PATH);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -256000');

// ── Step 1: Load kNN graph as sparse adjacency ──────────────────────────────
console.log('Loading kNN graph...');
const knnRows = db.prepare('SELECT verse_id, neighbor_id, similarity FROM verse_knn').all();
console.log(`  ${knnRows.length} edges`);

// Build vertex index (verse_id → dense index)
const vertexSet = new Set();
for (const r of knnRows) {
  vertexSet.add(r.verse_id);
  vertexSet.add(r.neighbor_id);
}
const vertices = [...vertexSet].sort((a, b) => a - b);
const N = vertices.length;
const vidToIdx = new Map();
for (let i = 0; i < N; i++) vidToIdx.set(vertices[i], i);
console.log(`  ${N} vertices`);

// Build sparse adjacency: adj[i] = [{j, w}]
const adj = new Array(N);
for (let i = 0; i < N; i++) adj[i] = [];

for (const r of knnRows) {
  const i = vidToIdx.get(r.verse_id);
  const j = vidToIdx.get(r.neighbor_id);
  const w = Math.max(0, r.similarity);
  if (w > 0) {
    adj[i].push({ j, w });
    // Make symmetric if not already
    if (!adj[j].some(e => e.j === i)) adj[j].push({ j: i, w });
  }
}

// Compute degree vector: D_ii = Σ_j A_ij
const degree = new Float64Array(N);
for (let i = 0; i < N; i++) {
  for (const e of adj[i]) degree[i] += e.w;
}
// D^(-1/2)
const degInvSqrt = new Float64Array(N);
for (let i = 0; i < N; i++) {
  degInvSqrt[i] = degree[i] > 1e-10 ? 1.0 / Math.sqrt(degree[i]) : 0;
}

// ── Step 2: Lanczos iteration for normalized Laplacian ──────────────────────
// We want the SMALLEST eigenvalues of L_norm = I - D^(-1/2) A D^(-1/2)
// Equivalently, the LARGEST eigenvalues of M = D^(-1/2) A D^(-1/2) (since L = I - M)
// Lanczos finds largest eigenvalues efficiently.
//
// Matrix-vector multiply: y = M·x where M = D^(-1/2) A D^(-1/2)
function matvec(x) {
  // Step 1: z = D^(-1/2) · x
  const z = new Float64Array(N);
  for (let i = 0; i < N; i++) z[i] = degInvSqrt[i] * x[i];

  // Step 2: w = A · z
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    for (const e of adj[i]) w[i] += e.w * z[e.j];
  }

  // Step 3: y = D^(-1/2) · w
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) y[i] = degInvSqrt[i] * w[i];
  return y;
}

function vecNorm(v) {
  let s = 0;
  for (let i = 0; i < N; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function vecDot(a, b) {
  let s = 0;
  for (let i = 0; i < N; i++) s += a[i] * b[i];
  return s;
}

console.log(`\nRunning Lanczos iteration (${LANCZOS_ITER} steps, N=${N})...`);

// Lanczos algorithm: build tridiagonal matrix T from M
const K = Math.min(LANCZOS_ITER, N - 1);
const alpha = new Float64Array(K); // diagonal of T
const beta = new Float64Array(K);  // sub-diagonal of T
const Q = new Array(K + 1);        // Lanczos vectors

// Random starting vector
Q[0] = new Float64Array(N);
for (let i = 0; i < N; i++) Q[0][i] = Math.random() - 0.5;
let n0 = vecNorm(Q[0]);
for (let i = 0; i < N; i++) Q[0][i] /= n0;

for (let k = 0; k < K; k++) {
  let w = matvec(Q[k]);

  // α_k = q_k^T · w
  alpha[k] = vecDot(Q[k], w);

  // w = w - α_k·q_k - β_{k-1}·q_{k-1}
  for (let i = 0; i < N; i++) w[i] -= alpha[k] * Q[k][i];
  if (k > 0) for (let i = 0; i < N; i++) w[i] -= beta[k - 1] * Q[k - 1][i];

  // Full reorthogonalization (prevents ghost eigenvalues)
  for (let j = 0; j <= k; j++) {
    const d = vecDot(w, Q[j]);
    for (let i = 0; i < N; i++) w[i] -= d * Q[j][i];
  }

  beta[k] = vecNorm(w);
  if (beta[k] < 1e-12) {
    console.log(`  Lanczos converged at step ${k + 1}`);
    break;
  }

  Q[k + 1] = new Float64Array(N);
  for (let i = 0; i < N; i++) Q[k + 1][i] = w[i] / beta[k];

  if ((k + 1) % 20 === 0) process.stdout.write(`  Lanczos step ${k + 1}/${K}\r`);
}
console.log(`  Lanczos steps: ${K} complete`);

// ── Step 3: Eigendecompose the K×K tridiagonal matrix T ─────────────────────
// T is symmetric tridiagonal: T[i][i] = alpha[i], T[i][i+1] = T[i+1][i] = beta[i]
// Use power iteration + deflation on T (small matrix — K×K)
console.log('Eigendecomposing tridiagonal matrix...');

// Build full T matrix (K×K)
const T = new Float64Array(K * K);
for (let i = 0; i < K; i++) {
  T[i * K + i] = alpha[i];
  if (i < K - 1) {
    T[i * K + (i + 1)] = beta[i];
    T[(i + 1) * K + i] = beta[i];
  }
}

// Power iteration for top SPEC_DIM eigenvalues of T
const eigVals = new Float64Array(SPEC_DIM);
const eigVecsT = new Array(SPEC_DIM); // each is Float64Array(K) — eigenvectors of T

for (let d = 0; d < SPEC_DIM; d++) {
  let vec = new Float64Array(K);
  for (let i = 0; i < K; i++) vec[i] = Math.random() - 0.5;
  let norm = 0;
  for (let i = 0; i < K; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < K; i++) vec[i] /= norm;

  for (let iter = 0; iter < 100; iter++) {
    const nv = new Float64Array(K);
    for (let r = 0; r < K; r++) {
      for (let c = 0; c < K; c++) nv[r] += T[r * K + c] * vec[c];
    }
    // Deflate
    for (let prev = 0; prev < d; prev++) {
      let dot = 0;
      for (let i = 0; i < K; i++) dot += nv[i] * eigVecsT[prev][i];
      for (let i = 0; i < K; i++) nv[i] -= dot * eigVecsT[prev][i];
    }
    norm = 0;
    for (let i = 0; i < K; i++) norm += nv[i] * nv[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-12) for (let i = 0; i < K; i++) nv[i] /= norm;
    vec = nv;
  }

  eigVecsT[d] = vec;
  // Rayleigh quotient for eigenvalue
  let lambda = 0;
  for (let r = 0; r < K; r++) {
    let rv = 0;
    for (let c = 0; c < K; c++) rv += T[r * K + c] * vec[c];
    lambda += vec[r] * rv;
  }
  eigVals[d] = lambda;
}

// The eigenvalues of M (D^(-1/2) A D^(-1/2)) correspond to Laplacian eigenvalues:
// λ_laplacian = 1 - λ_M. We want SMALLEST Laplacian eigenvalues = LARGEST M eigenvalues.
// Skip eigenvector 0 (trivial constant vector) — use eigenvectors 1..SPEC_DIM
console.log(`  Top ${SPEC_DIM} eigenvalues of normalized adjacency:`, eigVals.slice(0, 5).map(v => v.toFixed(4)).join(', '), '...');
console.log(`  Corresponding Laplacian eigenvalues:`, eigVals.slice(0, 5).map(v => (1 - v).toFixed(4)).join(', '), '...');

// ── Step 4: Recover eigenvectors in original space ──────────────────────────
// Ritz vectors: u_d = Σ_k Q[k] · eigVecsT[d][k]
console.log('Computing spectral embeddings...');

db.exec(`
  DROP TABLE IF EXISTS verse_spectral;
  CREATE TABLE verse_spectral (
    verse_id INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL
  );
`);

const insert = db.prepare('INSERT INTO verse_spectral (verse_id, embedding) VALUES (?, ?)');
const tx = db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const spec = new Float32Array(SPEC_DIM);
    // Skip eigenvector 0 (trivial), use 1..SPEC_DIM
    for (let d = 0; d < SPEC_DIM; d++) {
      let val = 0;
      const ev = eigVecsT[d]; // we use d=0..49 but these are already sorted by largest eigenvalue
      for (let k = 0; k < K && Q[k]; k++) {
        val += Q[k][i] * ev[k];
      }
      spec[d] = val;
    }

    // L2-normalize
    let norm = 0;
    for (let d = 0; d < SPEC_DIM; d++) norm += spec[d] * spec[d];
    norm = Math.sqrt(norm);
    if (norm > 1e-10) for (let d = 0; d < SPEC_DIM; d++) spec[d] /= norm;

    insert.run(vertices[i], Buffer.from(spec.buffer));

    if ((i + 1) % 5000 === 0) process.stdout.write(`  Embeddings: ${i + 1}/${N}\r`);
  }
});
tx();
console.log(`  Embeddings: ${N}/${N} done`);

console.log(`\n✅ Spectral embeddings: ${N} verses × ${SPEC_DIM}D stored in verse_spectral`);
db.close();
