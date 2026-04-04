#!/usr/bin/env node
// Pre-bake semantic labels for each k-means verse cluster.
//
// For each cluster:
//   1. Collect all member verse texts
//   2. Compute TF-IDF score for every term within the cluster
//      (TF = within-cluster frequency, IDF = pre-baked from lds-scriptures-sqlite.db)
//   3. Take the top-5 highest-scoring *unstemmed* terms as the label
//   4. Pick the single verse closest to the centroid as the representative verse
//   5. Store in verse-graph.db → cluster_labels table
//
// Also stores per-cluster centroid vectors so the backend can do
// nearest-cluster lookup at query time (for faceted results).
//
// Run: node scripts/prebake-cluster-labels.js

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_DIR    = path.join(__dirname, '..', 'resources', 'db');
const MAIN_PATH = path.join(DB_DIR, 'lds-scriptures-sqlite.db');
const EMB_PATH  = path.join(DB_DIR, 'verse-embeddings.db');
const GRAPH_PATH= path.join(DB_DIR, 'verse-graph.db');

// Minimum IDF threshold — below this a term is too common to be a label
// (covers: the, and, of, unto, lord, shall, he, be, god, covenant, said, king…)
const MIN_IDF = 4.5;

// Theological stop-terms that are too universal to distinguish clusters
// (high IDF but appear in almost every theological topic)
const TOPIC_STOPWORDS = new Set([
  'saith','said','thus','thereof','wherefore','behold','verily','amen',
  'hath','doth','didst','hast','wilt','wouldst','thy','thee','thine',
  'ye','yea','nay','lo','yonder','also','even','yet','both','nor',
  'whereby','theref','thereof','hereof','whereof','hereunto','thereunto',
  'come','came','went','go','gone','say','tell','told','speak','spoken',
  'seen','see','saw','hear','heard','know','knew','known','take','taken',
  'give','given','gave','make','made','put','set','brought','bring',
  'first','second','third','fourth','fifth','last','great','good','new',
  'one','two','three','seven','twelve','forty','thousand','many','much',
  'day','days','year','years','time','place','land','way','hand','eye',
  'house','city','people','man','men','son','sons','children','father',
  'woman','women','servant','servants','king','kings','priest','priests',
  'israel','jerusalem','egypt','babylon','zion','adam','moses','elijah',
  'nephi','alma','moroni','helaman','mormon','lehi','jacob','joseph',
  'jesus','christ','holy','spirit','ghost','father','god','lord','savior',
]);

// Porter-style stem → display form heuristics (just reversal of common suffixes)
// We will prefer the most frequent *original* word form in the cluster instead.

const mainDb  = new Database(MAIN_PATH, { readonly: true });
const embDb   = new Database(EMB_PATH,  { readonly: true });
const graphDb = new Database(GRAPH_PATH);
graphDb.pragma('journal_mode = WAL');
graphDb.pragma('cache_size = -131072');

// DIM detected at runtime — centroids written to cluster_labels must match
// the verse embedding dimension exactly or nearest-cluster lookup will be wrong.
function detectDim(db) {
  const row = db.prepare('SELECT embedding FROM verse_embeddings LIMIT 1').get();
  if (!row) throw new Error('[prebake-cluster-labels] No rows in verse_embeddings');
  const dim = row.embedding.byteLength / 4;
  if (!Number.isInteger(dim) || dim < 64 || dim > 4096)
    throw new Error(`[prebake-cluster-labels] Unexpected BLOB size ${row.embedding.byteLength} (dim=${dim})`);
  return dim;
}

const DIM = detectDim(embDb);
console.log(`[prebake-cluster-labels] Detected embedding dim: ${DIM}`);

// ── Load IDF table ──────────────────────────────────────────────────────────
console.log('Loading IDF table…');
const idfMap = new Map();
for (const row of mainDb.prepare('SELECT term, idf FROM term_idf').all()) {
  idfMap.set(row.term, row.idf);
}
console.log(`  ${idfMap.size} terms loaded`);

// ── Load cluster assignments ────────────────────────────────────────────────
console.log('Loading cluster assignments…');
const clusterRows = graphDb.prepare('SELECT verse_id, cluster_id, centroid_distance FROM verse_clusters ORDER BY cluster_id, centroid_distance').all();
const clusterMap  = new Map(); // cluster_id → [{ verse_id, centroid_distance }]
for (const row of clusterRows) {
  if (!clusterMap.has(row.cluster_id)) clusterMap.set(row.cluster_id, []);
  clusterMap.get(row.cluster_id).push(row);
}
console.log(`  ${clusterMap.size} clusters, ${clusterRows.length} verse assignments`);

// ── Load verse texts ────────────────────────────────────────────────────────
console.log('Loading verse texts…');
const verseTextMap = new Map();
for (const row of mainDb.prepare('SELECT id, scripture_text FROM verses').all()) {
  verseTextMap.set(row.id, row.scripture_text);
}
console.log(`  ${verseTextMap.size} verses`);

// ── Load verse scripture info for representative verse display ──────────────
console.log('Loading verse metadata…');
const verseMeta = new Map();
for (const row of mainDb.prepare(`
  SELECT v.id AS verse_id, b.book_title, ch.chapter_number, v.verse_number, v.scripture_text
  FROM verses v
  JOIN chapters ch ON ch.id = v.chapter_id
  JOIN books b ON b.id = ch.book_id
`).all()) {
  verseMeta.set(row.verse_id, row);
}

// ── Load embeddings ─────────────────────────────────────────────────────────
console.log('Loading embeddings…');
const embMap = new Map();
for (const row of embDb.prepare('SELECT verse_id, embedding FROM verse_embeddings').all()) {
  embMap.set(row.verse_id, new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
}
console.log(`  ${embMap.size} embeddings loaded`);

// ── Tokenize a verse into lower-case word tokens ────────────────────────────
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
}

// ── Very minimal Porter-style stemmer (matches prebake-idf stems) ───────────
// We only need this to look up IDF scores — display will use original words.
function stem(word) {
  let w = word;
  if (w.endsWith('ing'))  w = w.slice(0, -3);
  else if (w.endsWith('eth'))  w = w.slice(0, -3);
  else if (w.endsWith('ness')) w = w.slice(0, -4);
  else if (w.endsWith('tion')) w = w.slice(0, -4);
  else if (w.endsWith('tions')) w = w.slice(0, -5);
  else if (w.endsWith('ness')) w = w.slice(0, -4);
  else if (w.endsWith('ed'))   w = w.slice(0, -2);
  else if (w.endsWith('es'))   w = w.slice(0, -2);
  else if (w.endsWith('s') && w.length > 3) w = w.slice(0, -1);
  return w;
}

// ── Create output tables ────────────────────────────────────────────────────
graphDb.exec(`
  DROP TABLE IF EXISTS cluster_labels;
  CREATE TABLE cluster_labels (
    cluster_id       INTEGER PRIMARY KEY,
    label_terms      TEXT NOT NULL,   -- JSON array of top display terms
    rep_verse_id     INTEGER NOT NULL, -- verse closest to centroid
    member_count     INTEGER NOT NULL,
    centroid         BLOB NOT NULL    -- Float32Array(dim) — for nearest-cluster query
  );
  CREATE INDEX IF NOT EXISTS idx_cl_cluster ON cluster_labels(cluster_id);
`);

const insertLabel = graphDb.prepare(`
  INSERT INTO cluster_labels (cluster_id, label_terms, rep_verse_id, member_count, centroid)
  VALUES (?, ?, ?, ?, ?)
`);

// ── Process each cluster ────────────────────────────────────────────────────
console.log('Computing labels for each cluster…');
const clusterIds = [...clusterMap.keys()].sort((a, b) => a - b);

let done = 0;
const tx = graphDb.transaction(() => {
  for (const clusterId of clusterIds) {
    const members = clusterMap.get(clusterId);

    // ── 1. TF: count raw term occurrences across all cluster verses ──
    const rawTf   = new Map(); // token → raw count
    const display = new Map(); // stem → most-frequent original form

    for (const { verse_id } of members) {
      const text = verseTextMap.get(verse_id);
      if (!text) continue;
      for (const token of tokenize(text)) {
        if (token.length < 3) continue;
        const s = stem(token);
        rawTf.set(s, (rawTf.get(s) || 0) + 1);
        // track most common surface form for this stem
        const cur = display.get(s);
        if (!cur) {
          display.set(s, { form: token, count: 1 });
        } else {
          cur.count++;
          if (cur.count % 3 === 0) cur.form = token; // approximate mode
        }
      }
    }

    // ── 2. TF-IDF score per stem ──
    const scores = [];
    for (const [s, tf] of rawTf) {
      const idf = idfMap.get(s);
      if (!idf || idf < MIN_IDF) continue;
      const surfaceForm = display.get(s)?.form || s;
      if (TOPIC_STOPWORDS.has(surfaceForm) || TOPIC_STOPWORDS.has(s)) continue;
      if (/^\d+$/.test(surfaceForm)) continue; // skip pure numbers
      scores.push({ stem: s, form: surfaceForm, score: tf * idf });
    }
    scores.sort((a, b) => b.score - a.score);

    const topTerms = scores.slice(0, 5).map(t => t.form);

    // ── 3. Representative verse: closest to centroid (already sorted) ──
    const repVerseId = members[0].verse_id;

    // ── 4. Compute centroid vector ──
    const centroid = new Float32Array(DIM);
    let vecCount = 0;
    for (const { verse_id } of members) {
      const vec = embMap.get(verse_id);
      if (!vec) continue;
      for (let i = 0; i < DIM; i++) centroid[i] += vec[i];
      vecCount++;
    }
    if (vecCount > 0) {
      for (let i = 0; i < DIM; i++) centroid[i] /= vecCount;
    }
    // Normalize centroid to unit length for cosine similarity
    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += centroid[i] * centroid[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < DIM; i++) centroid[i] /= norm;

    const centroidBuf = Buffer.from(centroid.buffer);

    insertLabel.run(
      clusterId,
      JSON.stringify(topTerms),
      repVerseId,
      members.length,
      centroidBuf
    );

    done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${clusterIds.length}\r`);
  }
});

tx();
console.log(`\nLabelled ${done} clusters.`);

// ── Spot-check: print 10 sample cluster labels ──────────────────────────────
console.log('\nSample cluster labels:');
const samples = graphDb.prepare(`
  SELECT cl.cluster_id, cl.label_terms, cl.member_count, cl.rep_verse_id
  FROM cluster_labels cl
  ORDER BY cl.member_count DESC
  LIMIT 10
`).all();

for (const s of samples) {
  const meta = verseMeta.get(s.rep_verse_id);
  const ref  = meta ? `${meta.book_title} ${meta.chapter_number}:${meta.verse_number}` : `verse #${s.rep_verse_id}`;
  const text = meta ? meta.scripture_text.slice(0, 80) : '';
  console.log(`  Cluster ${String(s.cluster_id).padStart(3)}: [${JSON.parse(s.label_terms).join(', ')}]`);
  console.log(`    (${s.member_count} verses) rep: ${ref} — "${text}…"`);
}

mainDb.close();
embDb.close();
graphDb.close();
console.log('\nDone.');