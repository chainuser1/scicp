#!/usr/bin/env node
/**
 * prebake-entity-centroids.js
 *
 * Compute centroid embedding for each entity in ai_entity_profiles.
 * Centroid = L2-normalised mean of all verse embeddings mapped to that entity.
 *
 * Math:  c_e = normalise( (1/|V_e|) Σ_{v ∈ V_e} emb(v) )
 *
 * Output: ai_entity_centroids table in verse-tags.db
 *   entity_id TEXT PK, centroid BLOB (dim × Float32), verse_count INT
 *   (dim is detected at runtime from verse_embeddings BLOB size)
 */

const Database = require('better-sqlite3');
const path = require('path');

const TAGS_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-tags.db');
const EMB_PATH  = path.join(__dirname, '..', 'resources', 'db', 'verse-embeddings.db');

const tagsDb = new Database(TAGS_PATH);
const embDb  = new Database(EMB_PATH, { readonly: true });

tagsDb.pragma('journal_mode = WAL');

// DIM detected at runtime — entity centroids must match verse embedding dim
// or cosine similarity lookups at query time will be silently wrong.
function detectDim(db) {
  const row = db.prepare('SELECT embedding FROM verse_embeddings LIMIT 1').get();
  if (!row) throw new Error('[prebake-entity-centroids] No rows in verse_embeddings');
  const dim = row.embedding.byteLength / 4;
  if (!Number.isInteger(dim) || dim < 64 || dim > 4096)
    throw new Error(`[prebake-entity-centroids] Unexpected BLOB size ${row.embedding.byteLength} (dim=${dim})`);
  return dim;
}

// ── Load all verse embeddings into memory ──
console.log('Loading verse embeddings...');
const DIM = detectDim(embDb);
console.log(`[prebake-entity-centroids] Detected embedding dim: ${DIM}`);

const embRows = embDb.prepare('SELECT verse_id, embedding FROM verse_embeddings').all();
const embMap = new Map();
for (const r of embRows) {
  embMap.set(r.verse_id, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4));
}
console.log(`  ${embMap.size} verse embeddings loaded (${DIM}-dim)`);

// ── Load entity → verse mappings ──
console.log('Loading entity-verse mappings...');
const entityVerses = new Map(); // entity_id → [verse_id, ...]
const mapRows = tagsDb.prepare('SELECT entity_id, verse_id FROM ai_entity_verse_map').all();
for (const r of mapRows) {
  if (!entityVerses.has(r.entity_id)) entityVerses.set(r.entity_id, []);
  entityVerses.get(r.entity_id).push(r.verse_id);
}
console.log(`  ${entityVerses.size} entities with verse mappings`);

// ── Create output table ──
tagsDb.exec(`
  DROP TABLE IF EXISTS ai_entity_centroids;
  CREATE TABLE ai_entity_centroids (
    entity_id   TEXT PRIMARY KEY,
    centroid    BLOB NOT NULL,
    verse_count INTEGER NOT NULL
  );
`);

// ── Compute centroids ──
console.log('Computing centroids...');
const insert = tagsDb.prepare('INSERT INTO ai_entity_centroids (entity_id, centroid, verse_count) VALUES (?, ?, ?)');

let computed = 0, skipped = 0;

const insertAll = tagsDb.transaction(() => {
  for (const [entityId, verseIds] of entityVerses) {
    // Accumulate mean vector
    const sum = new Float32Array(DIM);
    let count = 0;
    for (const vid of verseIds) {
      const vec = embMap.get(vid);
      if (!vec) continue;
      for (let i = 0; i < DIM; i++) sum[i] += vec[i];
      count++;
    }
    if (count === 0) { skipped++; continue; }

    // Mean
    const invN = 1.0 / count;
    for (let i = 0; i < DIM; i++) sum[i] *= invN;

    // L2 normalise so dot product = cosine similarity
    let norm = 0.0;
    for (let i = 0; i < DIM; i++) norm += sum[i] * sum[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-9) {
      const invNorm = 1.0 / norm;
      for (let i = 0; i < DIM; i++) sum[i] *= invNorm;
    }

    // Store as BLOB
    insert.run(entityId, Buffer.from(sum.buffer), count);
    computed++;
  }
});

insertAll();

console.log(`✅ ${computed} entity centroids computed (${skipped} skipped — no embeddings)`);

// ── Verify ──
const total = tagsDb.prepare('SELECT COUNT(*) AS n FROM ai_entity_centroids').get().n;
const sample = tagsDb.prepare('SELECT entity_id, verse_count, length(centroid) AS bytes FROM ai_entity_centroids ORDER BY verse_count DESC LIMIT 5').all();
console.log(`  ${total} rows in ai_entity_centroids`);
console.log('  Top entities:', sample);

tagsDb.close();
embDb.close();