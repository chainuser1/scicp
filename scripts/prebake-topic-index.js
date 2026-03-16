#!/usr/bin/env node
// Pre-bake reverse topic index + PageRank into topical-guide.db
// Eliminates runtime buildTopicalGuideCache() and adds scripture importance scores

const Database = require('better-sqlite3');
const path = require('path');

const TG_PATH = path.join(__dirname, '..', 'resources', 'db', 'topical-guide.db');

const db = new Database(TG_PATH);
db.pragma('journal_mode = WAL');

// ── 1. Reverse topic index (topic_slug → verse_ids) ──
db.exec(`
  DROP TABLE IF EXISTS topic_verse_index;
  CREATE TABLE topic_verse_index (
    topic_slug TEXT NOT NULL,
    verse_id INTEGER NOT NULL,
    PRIMARY KEY (topic_slug, verse_id)
  );
`);

const mappings = db.prepare('SELECT t.slug, tg.verse_id FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE tg.verse_id IS NOT NULL AND tg.verse_id != -1').all();
console.log(`  ${mappings.length} topic-verse mappings`);

const insertIdx = db.prepare('INSERT OR IGNORE INTO topic_verse_index (topic_slug, verse_id) VALUES (?, ?)');
db.transaction(() => {
  for (const { slug, verse_id } of mappings) insertIdx.run(slug, verse_id);
})();

db.exec('CREATE INDEX IF NOT EXISTS idx_tvi_verse ON topic_verse_index(verse_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tvi_topic ON topic_verse_index(topic_slug)');

// ── 2. Verse topic cache (verse_id → topic slugs as JSON array) ──
db.exec(`
  DROP TABLE IF EXISTS verse_topics;
  CREATE TABLE verse_topics (
    verse_id INTEGER PRIMARY KEY,
    topic_slugs TEXT NOT NULL,
    topic_count INTEGER NOT NULL
  );
`);

const verseTopics = new Map();
for (const { slug, verse_id } of mappings) {
  if (!verseTopics.has(verse_id)) verseTopics.set(verse_id, []);
  verseTopics.get(verse_id).push(slug);
}

const insertVT = db.prepare('INSERT INTO verse_topics (verse_id, topic_slugs, topic_count) VALUES (?, ?, ?)');
db.transaction(() => {
  for (const [vid, slugs] of verseTopics) {
    insertVT.run(vid, JSON.stringify(slugs), slugs.length);
  }
})();

console.log(`  ${verseTopics.size} verses with topic assignments`);

// ── 3. PageRank over cross-reference graph ──
// Edges: if two verses share a topic, they're connected (weighted by shared topic count)
// We use a simplified approach: verse importance = how many distinct topics reference it

db.exec(`
  DROP TABLE IF EXISTS verse_pagerank;
  CREATE TABLE verse_pagerank (
    verse_id INTEGER PRIMARY KEY,
    pagerank REAL NOT NULL,
    topic_count INTEGER NOT NULL
  );
`);

// Build adjacency: verse → Set<connected verses> (via shared topics)
// For PageRank, we need to iterate — but the graph is sparse enough
console.log('  Computing PageRank over topic cross-reference graph...');

const allVerseIds = [...verseTopics.keys()];
const N = allVerseIds.length;
const DAMPING = 0.85;
const ITERATIONS = 25;

// Build outgoing edges: for each verse, find all verses sharing any topic
// This is expensive for full graph, so we use topic-mediated PageRank:
// PR(v) = (1-d)/N + d * Σ PR(u)/(outDegree(u)) for all u→v
// Instead of materializing full graph, iterate per topic

// Initialize scores
const pr = new Float64Array(N);
const prNew = new Float64Array(N);
const idxMap = new Map(); // verse_id → array index
allVerseIds.forEach((vid, i) => { idxMap.set(vid, i); pr[i] = 1.0 / N; });

// Build topic → verse indices for iteration
const topicMembers = new Map();
for (const { slug, verse_id } of mappings) {
  if (!topicMembers.has(slug)) topicMembers.set(slug, []);
  topicMembers.get(slug).push(idxMap.get(verse_id));
}

const topicCount = topicMembers.size;
console.log(`  Graph: ${N} verses, ${topicCount} topics`);

for (let iter = 0; iter < ITERATIONS; iter++) {
  prNew.fill((1 - DAMPING) / N);

  // For each topic, distribute PR among co-members
  for (const [, members] of topicMembers) {
    if (members.length < 2) continue;
    const memberCount = members.length;
    // Each member distributes its PR equally to other members in this topic
    let topicPR = 0;
    for (const idx of members) topicPR += pr[idx];

    for (const idx of members) {
      // Verse gets share from all co-members (minus self, but uniform simplification)
      prNew[idx] += DAMPING * (topicPR - pr[idx]) / (memberCount - 1) / topicCount;
    }
  }

  // Normalize
  let sum = 0;
  for (let i = 0; i < N; i++) sum += prNew[i];
  for (let i = 0; i < N; i++) prNew[i] /= sum;

  // Copy
  pr.set(prNew);
}

// Insert PageRank scores
const insertPR = db.prepare('INSERT INTO verse_pagerank (verse_id, pagerank, topic_count) VALUES (?, ?, ?)');
db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const vid = allVerseIds[i];
    insertPR.run(vid, +pr[i].toFixed(10), verseTopics.get(vid)?.length || 0);
  }
})();

// Show top PageRank verses
const topPR = db.prepare('SELECT vp.verse_id, vp.pagerank, vp.topic_count FROM verse_pagerank vp ORDER BY vp.pagerank DESC LIMIT 10').all();
console.log('\n  Top 10 PageRank verses:');
for (const row of topPR) {
  console.log(`    verse_id=${row.verse_id} PR=${row.pagerank.toFixed(8)} topics=${row.topic_count}`);
}

const total = db.prepare('SELECT COUNT(*) AS n FROM verse_pagerank').get().n;
console.log(`\n✅ Topic index + PageRank built: ${total} verses in topical-guide.db`);
db.close();
