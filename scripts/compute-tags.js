#!/usr/bin/env node
/**
 * Pre-bake doctrinal tags + POV for every English verse.
 *
 * v4 Architecture (much faster):
 *  - Doctrine: MiniLM cosine similarity vs ALL LDS Topical Guide topics (~3000 labels)
 *    No NLI per topic — just vector dot products using pre-baked verse embeddings.
 *  - POV only: DistilBERT zero-shot with 4 labels (10x faster than before, batched)
 *
 * Topic normalization:
 *  - "God, Love of"          → "love of God"
 *  - "Repent, Repentance"    → "repentance"   (pick longest part)
 *  - "Know, Knew, Known"     → skipped        (verb conjugation clusters)
 *  - "Light [noun]"          → "light"        (strip brackets)
 *
 * Run once locally:  node scripts/compute-tags.js
 * Force full re-bake: node scripts/compute-tags.js --reset
 * Resumes automatically otherwise.
 */

const path = require('path');
const Database = require('better-sqlite3');
const os = require('os');

const DB_DIR  = path.resolve(__dirname, '../resources/db');
const db      = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true });
const db_emb  = new Database(path.join(DB_DIR, 'verse-embeddings.db'), { readonly: true });
const db_tg   = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
const db_tags = new Database(path.join(DB_DIR, 'verse-tags.db'));

const RESET = process.argv.includes('--reset');
if (RESET) {
  db_tags.exec('DROP TABLE IF EXISTS verse_doctrine_tags;');
  console.log('Reset: cleared verse_doctrine_tags.');
}

db_tags.exec(`
  CREATE TABLE IF NOT EXISTS verse_doctrine_tags (
    verse_id     INTEGER PRIMARY KEY,
    chapter_id   INTEGER,
    chapter_num  INTEGER,
    pov          TEXT,
    labels_json  TEXT
  );
`);

// ── Config ──────────────────────────────────────────────────────────────────
const DIMS           = 384;   // all-MiniLM-L6-v2 output dims
const TOP_N_DOCTRINE = 5;     // top matching TG topics per verse
const COSINE_THRESH  = 0.28;  // minimum cosine similarity to include a topic
const DB_BATCH       = 500;   // rows per SQLite transaction

// ── Topic normalization ──────────────────────────────────────────────────────
function normalizeTopic(raw) {
  // Strip bracket annotations: "Light [noun]" → "Light"
  let s = raw.replace(/\[.*?\]/g, '').trim();

  const parts = s.split(',').map(p => p.trim()).filter(Boolean);

  // 3+ comma-parts = verb conjugation cluster → skip
  if (parts.length >= 3) return null;

  if (parts.length === 2) {
    const [main, qualifier] = parts;
    // "God, Love of" → "love of God"
    // "Baptism, Essential" → "essential baptism"
    s = `${qualifier} ${main}`;
  }

  s = s.toLowerCase().trim();
  // skip very short results
  if (s.length < 3) return null;
  return s;
}

function loadTopics() {
  const rows = db_tg.prepare(`
    SELECT t.id, t.name, COUNT(tg.id) AS cnt
    FROM topics t
    LEFT JOIN topical_guide tg ON tg.topic_id = t.id
    GROUP BY t.id
    ORDER BY cnt DESC
  `).all();

  const seen   = new Set();
  const topics = [];
  for (const row of rows) {
    const label = normalizeTopic(row.name);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    topics.push({ id: row.id, raw: row.name, label });
  }
  console.log(`Loaded ${topics.length} unique normalized topics from Topical Guide`);
  return topics;
}

// ── POV heuristics (no model needed — strong lexical signal in scripture) ────
// Returns one of: 'spoken by God' | 'spoken by a prophet' | 'prayer or praise' | 'historical narrative'
const GOD_PATTERNS = [
  /\bsaith the lord\b/i,
  /\bthus saith\b/i,
  /\bI am the lord\b/i,
  /\bI the lord\b/i,
  /\bI, the lord\b/i,
  /\bmy commandments\b/i,
  /\bI have given you\b/i,
  /\bI will be your god\b/i,
  /\bmine own voice\b/i,
  /\bI created\b.*heaven/i,
  /\bI have made\b.*earth/i,
];
const PRAYER_PATTERNS = [
  /\bO Lord\b/,
  /\bO God\b/,
  /\bO my God\b/,
  /\bDear God\b/i,
  /\bwe thank\b/i,
  /\bI thank thee\b/i,
  /\bhallowed be\b/i,
  /\bour Father\b.*heaven/i,
  /\bpraise (?:the lord|god|him|ye)\b/i,
  /\bblessed art thou\b/i,
  /\bthou art worthy\b/i,
];
const PROPHET_PATTERNS = [
  /\bI say unto you\b/i,
  /\bbehold, I\b/i,
  /\bI, (?:nephi|alma|moroni|paul|peter|john|james|moses|isaiah|jeremiah|ezekiel)\b/i,
  /\bI have written\b/i,
  /\bI bear record\b/i,
  /\bI witness\b/i,
  /\bI preach\b/i,
  /\bI declare\b/i,
];

function classifyPov(text) {
  for (const p of GOD_PATTERNS)    if (p.test(text)) return 'spoken by God';
  for (const p of PRAYER_PATTERNS) if (p.test(text)) return 'prayer or praise';
  for (const p of PROPHET_PATTERNS) if (p.test(text)) return 'spoken by a prophet';
  return 'historical narrative';
}
function l2norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/**
 * For one verse embedding, return top-N {label,score} objects.
 * topicMatrix is a flat Float32Array [topics × DIMS], row-major.
 */
function topDoctrine(vEmb, vNorm, topicMatrix, topicNorms, topics) {
  const n = topics.length;
  const scores = new Float32Array(n);

  for (let t = 0; t < n; t++) {
    let dot = 0;
    const off = t * DIMS;
    for (let d = 0; d < DIMS; d++) dot += vEmb[d] * topicMatrix[off + d];
    scores[t] = dot / (vNorm * topicNorms[t] + 1e-9);
  }

  // Partial selection of top-N (avoids full sort on 3000 items)
  const result = [];
  for (let t = 0; t < n; t++) {
    if (scores[t] < COSINE_THRESH) continue;
    result.push({ label: topics[t].label, score: scores[t] });
  }
  result.sort((a, b) => b.score - a.score);
  return result.slice(0, TOP_N_DOCTRINE);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function blobToFloat32(blob) {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

async function embedTexts(extractor, texts, batchSize = 64) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch  = texts.slice(i, i + batchSize);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    for (let j = 0; j < tensor.dims[0]; j++) {
      out.push(new Float32Array(tensor.data.slice(j * DIMS, (j + 1) * DIMS)));
    }
    process.stdout.write(`\r  Embedding topics ${Math.min(i + batchSize, texts.length)}/${texts.length}   `);
  }
  process.stdout.write('\n');
  return out;
}

function formatEta(ms) {
  if (!isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), ss = s % 60;
  if (m < 60) return `${m}m${ss}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

const ins = db_tags.prepare(`INSERT OR REPLACE INTO verse_doctrine_tags (verse_id, chapter_id, chapter_num, pov, labels_json) VALUES (?, ?, ?, ?, ?)`);
const batchInsert = db_tags.transaction(items => { for (const i of items) ins.run(i.verse_id, i.chapter_id, i.chapter_num, i.pov, i.labels_json); });

async function main() {
  const { pipeline, env } = await import('@xenova/transformers');

  const threads = Math.max(1, os.cpus().length);
  env.backends.onnx.wasm.numThreads = threads;
  console.log(`Using ${threads} CPU threads`);

  // 1. Load + normalize TG topics
  const topics = loadTopics();

  // 2. Load MiniLM for topic embedding
  console.log('Loading MiniLM (for topic embedding)…');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // 3. Pre-embed all topic labels into a flat matrix
  console.log(`Pre-embedding ${topics.length} topic labels…`);
  const topicEmbList = await embedTexts(extractor, topics.map(t => t.label));
  const topicMatrix  = new Float32Array(topics.length * DIMS);
  const topicNorms   = new Float32Array(topics.length);
  for (let i = 0; i < topicEmbList.length; i++) {
    topicMatrix.set(topicEmbList[i], i * DIMS);
    topicNorms[i] = l2norm(topicEmbList[i]);
  }
  console.log('Topic matrix ready.');

  // 4. Load all verse embeddings into memory
  console.log('Loading verse embeddings…');
  const embRows    = db_emb.prepare('SELECT verse_id, embedding FROM verse_embeddings').all();
  const verseEmbMap = new Map();
  for (const row of embRows) verseEmbMap.set(row.verse_id, blobToFloat32(row.embedding));
  console.log(`  ${verseEmbMap.size} verse embeddings loaded.`);

  // 5. Filter verses to process
  const already = new Set(db_tags.prepare('SELECT verse_id FROM verse_doctrine_tags').all().map(r => r.verse_id));
  const verses = db.prepare(`
    SELECT v.id AS verse_id, v.scripture_text, v.chapter_id, c.chapter_number AS chapter_num
    FROM verses v JOIN chapters c ON c.id = v.chapter_id
  `).all().filter(v => !already.has(v.verse_id));
  const total   = verses.length + already.size;
  console.log(`Processing ${verses.length} verses (${already.size} already done)…`);

  let done = 0, dbBuf = [];
  const startMs = Date.now();

  for (const v of verses) {
    const vEmb   = verseEmbMap.get(v.verse_id);
    const labels = vEmb ? topDoctrine(vEmb, l2norm(vEmb), topicMatrix, topicNorms, topics) : [];
    dbBuf.push({ verse_id: v.verse_id, chapter_id: v.chapter_id, chapter_num: v.chapter_num, pov: classifyPov(v.scripture_text), labels_json: JSON.stringify(labels) });
    done++;

    if (dbBuf.length >= DB_BATCH) {
      batchInsert(dbBuf.splice(0, DB_BATCH));
      const elapsed = Date.now() - startMs;
      const eta     = (verses.length - done) / (done / elapsed);
      process.stdout.write(`\r${already.size + done}/${total}  ETA: ${formatEta(eta)}    `);
    }
  }

  if (dbBuf.length) batchInsert(dbBuf);
  console.log(`\nDone. ${done} verses tagged (${total} total).`);
  db.close(); db_emb.close(); db_tg.close(); db_tags.close();
}

main().catch(err => { console.error(err); process.exit(1); });
