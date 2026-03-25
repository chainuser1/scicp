#!/usr/bin/env node
// ── ZCA Whitening for Verse Embeddings ───────────────────────────────────────
//
// Problem: MiniLM embeddings are anisotropic — cosine similarity is compressed
// into a narrow band, making thresholds like SEM_THRESHOLD=0.28 arbitrary.
//
// Solution: ZCA whitening decorrelates the embedding space so each dimension
// carries equal variance. After whitening, cosine similarity approximates
// Mahalanobis distance — each direction weighted by its informativeness.
//
// Math:
//   μ = (1/N) Σ v_i                         (mean vector, 384D)
//   Σ = (1/N) Σ (v_i - μ)(v_i - μ)^T       (covariance matrix, 384×384)
//   Σ = U Λ U^T                             (eigendecomposition)
//   W = U · diag(1/√(λ_i + ε)) · U^T       (ZCA whitening matrix)
//   v_white = W · (v - μ)                   (whitened vector)
//
// Output: two new tables in verse-embeddings.db
//   embedding_whitening: W (384×384) + μ (384) as BLOBs
//   verse_embeddings_white: whitened + L2-normalized verse embeddings
//
// Also prints distribution stats for SEM_THRESHOLD calibration.

const Database = require('better-sqlite3');
const path = require('path');

const EMB_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-embeddings.db');
const DIM = 384;
const EPSILON = 1e-5;  // regularization to prevent division by zero

const db = new Database(EMB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -512000');

// ── Step 1: Load all embeddings ──────────────────────────────────────────────
console.log('Loading verse embeddings...');
const rows = db.prepare('SELECT verse_id, embedding FROM verse_embeddings').all();
const N = rows.length;
console.log(`  ${N} embeddings loaded (${DIM}D)`);

const verseIds = new Array(N);
const vecs = new Array(N);
for (let i = 0; i < N; i++) {
  verseIds[i] = rows[i].verse_id;
  const buf = rows[i].embedding;
  vecs[i] = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ── Step 2: Compute mean vector μ ────────────────────────────────────────────
console.log('Computing mean vector...');
const mean = new Float64Array(DIM);
for (let i = 0; i < N; i++) {
  const v = vecs[i];
  for (let d = 0; d < DIM; d++) mean[d] += v[d];
}
for (let d = 0; d < DIM; d++) mean[d] /= N;

// ── Step 3: Compute covariance matrix Σ (384×384) ───────────────────────────
// Σ = (1/N) Σ (v_i - μ)(v_i - μ)^T
// This is a 384×384 symmetric matrix. We store the full matrix for clarity.
console.log('Computing covariance matrix (384×384)...');
const cov = new Float64Array(DIM * DIM); // row-major

for (let i = 0; i < N; i++) {
  const v = vecs[i];
  // Compute centered vector (v - μ)
  const centered = new Float64Array(DIM);
  for (let d = 0; d < DIM; d++) centered[d] = v[d] - mean[d];

  // Outer product: cov += centered · centered^T
  for (let r = 0; r < DIM; r++) {
    const cr = centered[r];
    if (Math.abs(cr) < 1e-12) continue;
    const rowOff = r * DIM;
    for (let c = r; c < DIM; c++) {
      cov[rowOff + c] += cr * centered[c];
    }
  }

  if ((i + 1) % 5000 === 0) process.stdout.write(`  Covariance: ${i + 1}/${N}\r`);
}
// Fill lower triangle (symmetric) and divide by N
for (let r = 0; r < DIM; r++) {
  for (let c = r; c < DIM; c++) {
    cov[r * DIM + c] /= N;
    cov[c * DIM + r] = cov[r * DIM + c];
  }
}
console.log(`  Covariance: ${N}/${N} done`);

// ── Step 4: Eigendecomposition via power iteration + deflation ───────────────
// We need ALL 384 eigenvalues/eigenvectors for ZCA.
// Power iteration with Hotelling deflation: extract one eigenvector at a time.
console.log('Eigendecomposition (384 eigenvectors via power iteration)...');

const MAX_ITER = 100;
const CONVERGENCE_TOL = 1e-8;
const eigenvalues = new Float64Array(DIM);
const eigenvectors = new Array(DIM); // each is Float64Array(DIM)

// Work on a copy of cov so deflation doesn't corrupt it
const covWork = new Float64Array(cov);

for (let k = 0; k < DIM; k++) {
  // Random initial vector
  let vec = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    vec[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) vec[i] /= norm;

  let lambda = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Multiply: newVec = covWork · vec
    const newVec = new Float64Array(DIM);
    for (let r = 0; r < DIM; r++) {
      let dot = 0;
      const rowOff = r * DIM;
      for (let c = 0; c < DIM; c++) dot += covWork[rowOff + c] * vec[c];
      newVec[r] = dot;
    }

    // Compute eigenvalue (Rayleigh quotient)
    let newLambda = 0;
    for (let i = 0; i < DIM; i++) newLambda += vec[i] * newVec[i];

    // Normalize
    norm = 0;
    for (let i = 0; i < DIM; i++) norm += newVec[i] * newVec[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-15) {
      for (let i = 0; i < DIM; i++) newVec[i] /= norm;
    }

    // Check convergence
    if (Math.abs(newLambda - lambda) < CONVERGENCE_TOL * Math.max(1, Math.abs(newLambda))) {
      lambda = newLambda;
      vec = newVec;
      break;
    }
    lambda = newLambda;
    vec = newVec;
  }

  eigenvalues[k] = lambda;
  eigenvectors[k] = vec;

  // Hotelling deflation: covWork -= lambda * vec · vec^T
  for (let r = 0; r < DIM; r++) {
    const lv_r = lambda * vec[r];
    if (Math.abs(lv_r) < 1e-15) continue;
    const rowOff = r * DIM;
    for (let c = 0; c < DIM; c++) {
      covWork[rowOff + c] -= lv_r * vec[c];
    }
  }

  if ((k + 1) % 50 === 0 || k === DIM - 1) {
    process.stdout.write(`  Eigenvectors: ${k + 1}/${DIM}\r`);
  }
}
console.log(`  Eigenvectors: ${DIM}/${DIM} done`);

// Print variance distribution
const totalVar = eigenvalues.reduce((s, v) => s + Math.max(0, v), 0);
let cumVar = 0;
console.log('\nVariance distribution:');
for (let i = 0; i < DIM; i++) {
  cumVar += Math.max(0, eigenvalues[i]);
  if ([10, 50, 100, 200, 300, 384].includes(i + 1)) {
    console.log(`  Top ${i + 1} dims: ${(100 * cumVar / totalVar).toFixed(1)}% of variance`);
  }
}
console.log(`  Min eigenvalue: ${eigenvalues[DIM - 1].toExponential(4)}`);
console.log(`  Max eigenvalue: ${eigenvalues[0].toExponential(4)}`);
console.log(`  Condition number: ${(eigenvalues[0] / Math.max(eigenvalues[DIM - 1], EPSILON)).toExponential(2)}`);

// ── Step 5: Compute ZCA whitening matrix ─────────────────────────────────────
// W = U · diag(1/√(λ_i + ε)) · U^T
// Where U has eigenvectors as columns: U[:,k] = eigenvectors[k]
console.log('\nComputing ZCA whitening matrix...');

// W[r][c] = Σ_k  U[r][k] * (1/√(λ_k+ε)) * U[c][k]
const W = new Float64Array(DIM * DIM);
for (let r = 0; r < DIM; r++) {
  const rowOff = r * DIM;
  for (let c = r; c < DIM; c++) {
    let val = 0;
    for (let k = 0; k < DIM; k++) {
      const scale = 1.0 / Math.sqrt(Math.max(eigenvalues[k], 0) + EPSILON);
      val += eigenvectors[k][r] * scale * eigenvectors[k][c];
    }
    W[rowOff + c] = val;
    W[c * DIM + r] = val; // symmetric
  }
  if ((r + 1) % 50 === 0) process.stdout.write(`  W matrix: row ${r + 1}/${DIM}\r`);
}
console.log(`  W matrix: ${DIM}×${DIM} computed`);

// ── Step 6: Apply whitening to all verse embeddings ──────────────────────────
console.log('Whitening all verse embeddings...');

db.exec(`
  DROP TABLE IF EXISTS verse_embeddings_white;
  CREATE TABLE verse_embeddings_white (
    verse_id INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL
  );
  DROP TABLE IF EXISTS embedding_whitening;
  CREATE TABLE embedding_whitening (
    key TEXT PRIMARY KEY,
    data BLOB NOT NULL
  );
`);

// Store W and mean
const W_f32 = new Float32Array(DIM * DIM);
for (let i = 0; i < DIM * DIM; i++) W_f32[i] = W[i];
const mean_f32 = new Float32Array(DIM);
for (let i = 0; i < DIM; i++) mean_f32[i] = mean[i];

db.prepare('INSERT INTO embedding_whitening (key, data) VALUES (?, ?)').run('W', Buffer.from(W_f32.buffer));
db.prepare('INSERT INTO embedding_whitening (key, data) VALUES (?, ?)').run('mean', Buffer.from(mean_f32.buffer));
console.log('  Stored W (384×384) and μ (384) in embedding_whitening table');

// Whiten each verse embedding: v_white = W · (v - μ), then L2-normalize
const insertWhite = db.prepare('INSERT INTO verse_embeddings_white (verse_id, embedding) VALUES (?, ?)');

// Collect similarity stats for threshold calibration
const sampleSims = [];
let whitenedVecs = new Array(N);

const tx = db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const v = vecs[i];
    // Center: v - μ
    const centered = new Float64Array(DIM);
    for (let d = 0; d < DIM; d++) centered[d] = v[d] - mean[d];

    // Multiply: w = W · centered
    const w = new Float64Array(DIM);
    for (let r = 0; r < DIM; r++) {
      let dot = 0;
      const rowOff = r * DIM;
      for (let c = 0; c < DIM; c++) dot += W[rowOff + c] * centered[c];
      w[r] = dot;
    }

    // L2-normalize
    let norm = 0;
    for (let d = 0; d < DIM; d++) norm += w[d] * w[d];
    norm = Math.sqrt(norm);
    const wf32 = new Float32Array(DIM);
    if (norm > 1e-10) {
      for (let d = 0; d < DIM; d++) wf32[d] = w[d] / norm;
    }

    whitenedVecs[i] = wf32;
    insertWhite.run(verseIds[i], Buffer.from(wf32.buffer));

    if ((i + 1) % 5000 === 0) process.stdout.write(`  Whitening: ${i + 1}/${N}\r`);
  }
});
tx();
console.log(`  Whitening: ${N}/${N} done`);

// ── Step 7: Distribution analysis for threshold calibration ──────────────────
// Sample random pairs to understand the new cosine similarity distribution
console.log('\nAnalyzing whitened similarity distribution...');

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Random pairs (for background distribution)
const NUM_RANDOM = 50000;
const randomSims = [];
for (let s = 0; s < NUM_RANDOM; s++) {
  const i = Math.floor(Math.random() * N);
  const j = Math.floor(Math.random() * N);
  if (i !== j) randomSims.push(dot(whitenedVecs[i], whitenedVecs[j]));
}
randomSims.sort((a, b) => a - b);

// kNN pairs (for positive distribution — adjacent verses tend to be related)
const knnSims = [];
for (let i = 0; i < Math.min(N - 1, 10000); i++) {
  knnSims.push(dot(whitenedVecs[i], whitenedVecs[i + 1]));
}
knnSims.sort((a, b) => a - b);

function percentile(arr, p) {
  const idx = Math.floor(arr.length * p);
  return arr[Math.min(idx, arr.length - 1)];
}

console.log('  Random pair similarities (background):');
console.log(`    Min:    ${percentile(randomSims, 0).toFixed(4)}`);
console.log(`    P5:     ${percentile(randomSims, 0.05).toFixed(4)}`);
console.log(`    P25:    ${percentile(randomSims, 0.25).toFixed(4)}`);
console.log(`    Median: ${percentile(randomSims, 0.50).toFixed(4)}`);
console.log(`    P75:    ${percentile(randomSims, 0.75).toFixed(4)}`);
console.log(`    P95:    ${percentile(randomSims, 0.95).toFixed(4)}`);
console.log(`    Max:    ${percentile(randomSims, 1.0).toFixed(4)}`);

console.log('  Adjacent verse similarities (positive signal):');
console.log(`    P5:     ${percentile(knnSims, 0.05).toFixed(4)}`);
console.log(`    P25:    ${percentile(knnSims, 0.25).toFixed(4)}`);
console.log(`    Median: ${percentile(knnSims, 0.50).toFixed(4)}`);
console.log(`    P75:    ${percentile(knnSims, 0.75).toFixed(4)}`);
console.log(`    P95:    ${percentile(knnSims, 0.95).toFixed(4)}`);

// Suggest threshold: P95 of random (background) as semantic threshold
const suggestedThreshold = percentile(randomSims, 0.95);
console.log(`\n  ► Suggested SEM_THRESHOLD: ${suggestedThreshold.toFixed(4)}`);
console.log(`    (P95 of random background — 95% of random pairs score below this)`);

// Compare with raw (unwhitened) distribution
console.log('\nComparing raw vs whitened distributions...');
const rawRandomSims = [];
for (let s = 0; s < NUM_RANDOM; s++) {
  const i = Math.floor(Math.random() * N);
  const j = Math.floor(Math.random() * N);
  if (i !== j) rawRandomSims.push(dot(vecs[i], vecs[j]));
}
rawRandomSims.sort((a, b) => a - b);
console.log('  Raw (unwhitened) random pairs:');
console.log(`    P5:     ${percentile(rawRandomSims, 0.05).toFixed(4)}`);
console.log(`    Median: ${percentile(rawRandomSims, 0.50).toFixed(4)}`);
console.log(`    P95:    ${percentile(rawRandomSims, 0.95).toFixed(4)}`);
console.log('  Whitened random pairs:');
console.log(`    P5:     ${percentile(randomSims, 0.05).toFixed(4)}`);
console.log(`    Median: ${percentile(randomSims, 0.50).toFixed(4)}`);
console.log(`    P95:    ${percentile(randomSims, 0.95).toFixed(4)}`);
console.log(`    Spread improvement: ${((percentile(randomSims, 0.95) - percentile(randomSims, 0.05)) / (percentile(rawRandomSims, 0.95) - percentile(rawRandomSims, 0.05))).toFixed(2)}x wider`);

// Free memory
whitenedVecs = null;

console.log(`\n✅ Whitening complete: ${N} whitened embeddings stored`);
console.log(`   Tables: embedding_whitening (W + μ), verse_embeddings_white`);
db.close();
