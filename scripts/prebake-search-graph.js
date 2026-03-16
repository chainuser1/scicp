#!/usr/bin/env node
// Create search-graph.db: a lightweight DB with pre-baked search tables for mobile
// Contains: verse_knn, verse_clusters, term_idf, entity indexes, topic indexes, PageRank
// This replaces the need for 83MB verse-embeddings.db on mobile

const Database = require('better-sqlite3');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'resources', 'db', 'search-graph.db');
const GRAPH_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-graph.db');
const MAIN_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const TG_PATH = path.join(__dirname, '..', 'resources', 'db', 'topical-guide.db');
const TAGS_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-tags.db');

const out = new Database(OUT_PATH);
out.pragma('journal_mode = WAL');

// ── 1. verse_knn from verse-graph.db ──
console.log('Copying verse_knn...');
out.exec(`
  DROP TABLE IF EXISTS verse_knn;
  CREATE TABLE verse_knn (
    verse_id INTEGER NOT NULL,
    neighbor_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    similarity REAL NOT NULL,
    PRIMARY KEY (verse_id, rank)
  );
`);

const graph = new Database(GRAPH_PATH, { readonly: true });
const knnRows = graph.prepare('SELECT verse_id, neighbor_id, rank, similarity FROM verse_knn ORDER BY verse_id, rank').all();
const insertKnn = out.prepare('INSERT INTO verse_knn VALUES (?, ?, ?, ?)');
out.transaction(() => {
  for (const r of knnRows) insertKnn.run(r.verse_id, r.neighbor_id, r.rank, r.similarity);
})();
out.exec('CREATE INDEX idx_knn_verse ON verse_knn(verse_id)');
console.log(`  ${knnRows.length} kNN rows`);

// ── 2. verse_clusters from verse-graph.db ──
console.log('Copying verse_clusters...');
out.exec(`
  DROP TABLE IF EXISTS verse_clusters;
  CREATE TABLE verse_clusters (
    verse_id INTEGER PRIMARY KEY,
    cluster_id INTEGER NOT NULL,
    centroid_distance REAL NOT NULL
  );
`);
const clRows = graph.prepare('SELECT verse_id, cluster_id, centroid_distance FROM verse_clusters').all();
const insertCl = out.prepare('INSERT INTO verse_clusters VALUES (?, ?, ?)');
out.transaction(() => {
  for (const r of clRows) insertCl.run(r.verse_id, r.cluster_id, r.centroid_distance);
})();
out.exec('CREATE INDEX idx_vc_cluster ON verse_clusters(cluster_id)');
console.log(`  ${clRows.length} cluster assignments`);
graph.close();

// ── 3. term_idf + term_llr + term_pmi from lds-scriptures-sqlite.db ──
console.log('Copying term tables...');
out.exec(`
  DROP TABLE IF EXISTS term_idf;
  CREATE TABLE term_idf (
    term TEXT PRIMARY KEY,
    doc_freq INTEGER NOT NULL,
    idf REAL NOT NULL
  );
`);
const main = new Database(MAIN_PATH, { readonly: true });
const idfRows = main.prepare('SELECT term, doc_freq, idf FROM term_idf').all();
const insertIdf = out.prepare('INSERT INTO term_idf VALUES (?, ?, ?)');
out.transaction(() => {
  for (const r of idfRows) insertIdf.run(r.term, r.doc_freq, r.idf);
})();
console.log(`  ${idfRows.length} IDF terms`);

// LLR table
try {
  out.exec(`
    DROP TABLE IF EXISTS term_llr;
    CREATE TABLE term_llr (
      term TEXT PRIMARY KEY,
      doc_freq INTEGER NOT NULL,
      llr REAL NOT NULL,
      idf REAL NOT NULL,
      burstiness REAL NOT NULL
    );
  `);
  const llrRows = main.prepare('SELECT term, doc_freq, llr, idf, burstiness FROM term_llr').all();
  const insertLlr = out.prepare('INSERT INTO term_llr VALUES (?, ?, ?, ?, ?)');
  out.transaction(() => {
    for (const r of llrRows) insertLlr.run(r.term, r.doc_freq, r.llr, r.idf, r.burstiness);
  })();
  out.exec('CREATE INDEX IF NOT EXISTS idx_llr_term ON term_llr(term)');
  console.log(`  ${llrRows.length} LLR terms`);
} catch (e) { console.log('  LLR table not found, skipping'); }

// PMI table
try {
  out.exec(`
    DROP TABLE IF EXISTS term_pmi;
    CREATE TABLE term_pmi (
      term TEXT NOT NULL,
      assoc TEXT NOT NULL,
      pmi REAL NOT NULL,
      cooccur INTEGER NOT NULL,
      PRIMARY KEY (term, assoc)
    );
  `);
  const pmiRows = main.prepare('SELECT term, assoc, pmi, cooccur FROM term_pmi').all();
  const insertPmi = out.prepare('INSERT INTO term_pmi VALUES (?, ?, ?, ?)');
  out.transaction(() => {
    for (const r of pmiRows) insertPmi.run(r.term, r.assoc, r.pmi, r.cooccur);
  })();
  out.exec('CREATE INDEX IF NOT EXISTS idx_pmi_term ON term_pmi(term)');
  console.log(`  ${pmiRows.length} PMI associations`);
} catch (e) { console.log('  PMI table not found, skipping'); }

main.close();

// ── 4. PageRank + topic indexes from topical-guide.db ──
console.log('Copying PageRank + topic indexes...');
const tg = new Database(TG_PATH, { readonly: true });

out.exec(`
  DROP TABLE IF EXISTS verse_pagerank;
  CREATE TABLE verse_pagerank (
    verse_id INTEGER PRIMARY KEY,
    pagerank REAL NOT NULL,
    topic_count INTEGER NOT NULL
  );
`);
const prRows = tg.prepare('SELECT verse_id, pagerank, topic_count FROM verse_pagerank').all();
const insertPr = out.prepare('INSERT INTO verse_pagerank VALUES (?, ?, ?)');
out.transaction(() => {
  for (const r of prRows) insertPr.run(r.verse_id, r.pagerank, r.topic_count);
})();
console.log(`  ${prRows.length} PageRank scores`);

out.exec(`
  DROP TABLE IF EXISTS verse_topics;
  CREATE TABLE verse_topics (
    verse_id INTEGER PRIMARY KEY,
    topic_slugs TEXT NOT NULL,
    topic_count INTEGER NOT NULL
  );
`);
const vtRows = tg.prepare('SELECT verse_id, topic_slugs, topic_count FROM verse_topics').all();
const insertVt = out.prepare('INSERT INTO verse_topics VALUES (?, ?, ?)');
out.transaction(() => {
  for (const r of vtRows) insertVt.run(r.verse_id, r.topic_slugs, r.topic_count);
})();
console.log(`  ${vtRows.length} verse topic assignments`);

// topic_ppr stays in topical-guide.db (not duplicated into search-graph)

tg.close();

// entity_person_index + entity_place_index stay in verse-tags.db (not duplicated)
const tags = new Database(TAGS_PATH, { readonly: true });

// ── 6. verse_rwr from verse-graph.db ──
try {
  const graph2 = new Database(GRAPH_PATH, { readonly: true });
  out.exec(`
    DROP TABLE IF EXISTS verse_rwr;
    CREATE TABLE verse_rwr (
      verse_id INTEGER NOT NULL,
      neighbor_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      rwr_score REAL NOT NULL,
      PRIMARY KEY (verse_id, rank)
    );
  `);
  const rwrRows = graph2.prepare('SELECT verse_id, neighbor_id, rank, rwr_score FROM verse_rwr ORDER BY verse_id, rank').all();
  const insertRwr = out.prepare('INSERT INTO verse_rwr VALUES (?, ?, ?, ?)');
  out.transaction(() => {
    for (const r of rwrRows) insertRwr.run(r.verse_id, r.neighbor_id, r.rank, r.rwr_score);
  })();
  out.exec('CREATE INDEX IF NOT EXISTS idx_rwr_verse ON verse_rwr(verse_id)');
  console.log(`  ${rwrRows.length} RWR rows`);
  graph2.close();
} catch (e) { console.log('  RWR table not found, skipping'); }

// Compact
out.exec('VACUUM');

// ── 9. AI entity profiles + verse map from verse-tags.db ──
console.log('Copying AI entity disambiguation tables...');
try {
  const tags2 = new Database(TAGS_PATH, { readonly: true });
  out.exec(`
    DROP TABLE IF EXISTS ai_entity_profiles;
    CREATE TABLE ai_entity_profiles (
      entity_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      qualifier TEXT,
      description TEXT,
      chapter_count INTEGER DEFAULT 0,
      verse_count INTEGER DEFAULT 0
    );
  `);
  const profiles = tags2.prepare('SELECT entity_id, name, type, qualifier, description, chapter_count, verse_count FROM ai_entity_profiles').all();
  const insertProf = out.prepare('INSERT INTO ai_entity_profiles VALUES (?,?,?,?,?,?,?)');
  out.transaction(() => {
    for (const p of profiles) insertProf.run(p.entity_id, p.name, p.type, p.qualifier, p.description, p.chapter_count, p.verse_count);
  })();
  console.log(`  ${profiles.length} AI entity profiles`);

  out.exec(`
    DROP TABLE IF EXISTS ai_entity_verse_map;
    CREATE TABLE ai_entity_verse_map (
      entity_id TEXT NOT NULL,
      verse_id INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      PRIMARY KEY (entity_id, verse_id)
    );
  `);
  const evmRows = tags2.prepare('SELECT entity_id, verse_id, chapter_id FROM ai_entity_verse_map').all();
  const insertEvm = out.prepare('INSERT INTO ai_entity_verse_map VALUES (?,?,?)');
  out.transaction(() => {
    for (const r of evmRows) insertEvm.run(r.entity_id, r.verse_id, r.chapter_id);
  })();
  out.exec('CREATE INDEX idx_aevm_entity ON ai_entity_verse_map(entity_id)');
  out.exec('CREATE INDEX idx_aevm_verse ON ai_entity_verse_map(verse_id)');
  console.log(`  ${evmRows.length} AI entity-verse mappings`);

  // ── Copy entity centroids for mathematical disambiguation ──
  try {
    out.exec(`
      DROP TABLE IF EXISTS ai_entity_centroids;
      CREATE TABLE ai_entity_centroids (
        entity_id TEXT PRIMARY KEY,
        centroid BLOB NOT NULL,
        verse_count INTEGER NOT NULL
      );
    `);
    const centRows = tags2.prepare('SELECT entity_id, centroid, verse_count FROM ai_entity_centroids').all();
    const insertCent = out.prepare('INSERT INTO ai_entity_centroids VALUES (?,?,?)');
    out.transaction(() => { for (const r of centRows) insertCent.run(r.entity_id, r.centroid, r.verse_count); })();
    console.log(`  ${centRows.length} AI entity centroids`);
  } catch (e) { console.log('  ai_entity_centroids not found, skipping:', e.message); }

  tags2.close();
} catch (e) { console.log('  AI entity tables not found, skipping:', e.message); }

out.exec('VACUUM');
const { size } = require('fs').statSync(OUT_PATH);
console.log(`\n✅ search-graph.db built: ${(size / 1024 / 1024).toFixed(1)}MB`);
out.close();
