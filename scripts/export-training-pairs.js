#!/usr/bin/env node
/**
 * Export training pairs for multilingual scripture fine-tuning.
 *
 * Pair sources (by training signal strength):
 *   1. Translation pairs   — same verse across LDS ↔ YLT ↔ Tagalog ↔ ... (paraphrase)
 *      Note: YLT is hyper-literal/archaic (similar register to KJV), so the vocabulary
 *      gap is smaller than NRSVUE was. Signal is still valid — same verse = same meaning.
 *   2. Topical guide        — topic name ↔ verse text (concept grounding)
 *   3. Triple Combination Index — topic name ↔ verse text (broader concept coverage)
 *   4. Cross-references     — theologically linked verses
 *   5. kNN top-3 neighbors  — semantically similar verses stay close
 *   6. Adjacent verses      — same-chapter continuity
 *   7. Same-topic verse pairs (TG) — two verses under the same TG topic
 *   8. Same-topic verse pairs (Triple) — two verses under the same Triple Index topic
 *
 * Output: resources/training-pairs.json
 *   [ { "anchor": "...", "positive": "..." }, ... ]
 *
 * Usage:
 *   node scripts/export-training-pairs.js
 */

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const ROOT    = path.join(__dirname, '..');
const DB_DIR  = path.join(ROOT, 'resources/db');
const OUT     = path.join(ROOT, 'resources/training-pairs.json');

// ── Load all language DBs ────────────────────────────────────────────────────
const LANG_DBS = {
  lds:       'lds-scriptures-sqlite.db',
  ylt:       'ylt-scriptures-sqlite.db',
  rotherham: 'rotherham-scriptures-sqlite.db',
  // Only English sources — non-English translations risk contaminating
  // the embedding space with bad translations and split capacity across
  // languages we don't use for semantic search.
};

// verse_id → { lang: scripture_text }
const versesByLang = new Map(); // lang → Map(verse_id → text)

for (const [lang, file] of Object.entries(LANG_DBS)) {
  const dbPath = path.join(DB_DIR, file);
  if (!fs.existsSync(dbPath)) { console.log(`  skip ${lang} (not found)`); continue; }
  const db = new Database(dbPath, { readonly: true });
  const map = new Map();
  for (const r of db.prepare('SELECT id, scripture_text FROM verses').all()) {
    if (r.scripture_text && r.scripture_text.length > 15) map.set(r.id, r.scripture_text);
  }
  versesByLang.set(lang, map);
  console.log(`  ${lang}: ${map.size.toLocaleString()} verses`);
  db.close();
}

const ldsVerses = versesByLang.get('lds');
const pairs = [];

// ── 1. Translation pairs: LDS ↔ every other language ────────────────────────
// Same verse in different translations = strongest paraphrase signal
let translationCount = 0;
for (const [lang, map] of versesByLang) {
  if (lang === 'lds') continue;
  for (const [vid, text] of map) {
    const ldsText = ldsVerses.get(vid);
    if (ldsText) {
      pairs.push({ anchor: ldsText, positive: text });
      translationCount++;
    }
  }
}
console.log(`\n1. Translation pairs (LDS↔YLT↔Rotherham): ${translationCount.toLocaleString()}`);

// (Cross-translation pairs removed — English-only training)

// ── 3. Topical guide: topic name ↔ verse text ───────────────────────────────
let topicCount = 0;
try {
  const tg = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
  const topics = new Map();
  for (const r of tg.prepare('SELECT id, name FROM topics').all())
    topics.set(r.id, r.name);

  for (const r of tg.prepare('SELECT topic_id, verse_id FROM topical_guide').all()) {
    const topic = topics.get(r.topic_id);
    const verse = ldsVerses.get(r.verse_id);
    if (topic && verse) {
      pairs.push({ anchor: topic, positive: verse });
      topicCount++;
    }
  }
  tg.close();
} catch (e) { console.log('  topical-guide.db error:', e.message); }
console.log(`2. Topical guide pairs: ${topicCount.toLocaleString()}`);

// ── 3. Triple Combination Index: topic name ↔ verse text ─────────────────────
// Same pattern as topical guide but from the Triple Combination Index
// (broader coverage: 3,059 topics, 44k mappings). Snippets are ignored.
let tripleTopicCount = 0;
try {
  const ti = new Database(path.join(DB_DIR, 'triple-index.db'), { readonly: true });
  const triTopics = new Map();
  for (const r of ti.prepare('SELECT id, name FROM topics').all())
    triTopics.set(r.id, r.name);

  for (const r of ti.prepare('SELECT topic_id, verse_id FROM triple_index WHERE verse_id IS NOT NULL').all()) {
    const topic = triTopics.get(r.topic_id);
    const verse = ldsVerses.get(r.verse_id);
    if (topic && verse) {
      pairs.push({ anchor: topic, positive: verse });
      tripleTopicCount++;
    }
  }
  ti.close();
} catch (e) { console.log('  triple-index.db error:', e.message); }
console.log(`3. Triple Index pairs: ${tripleTopicCount.toLocaleString()}`);

// ── 4. Cross-references: theologically linked verses ────────────────────────
let crossRefCount = 0;
try {
  const crDb = new Database(path.join(DB_DIR, 'verse-cross-refs.db'), { readonly: true });
  for (const r of crDb.prepare('SELECT verse_id, cross_references FROM verse_cross_references').all()) {
    const srcText = ldsVerses.get(r.verse_id);
    if (!srcText) continue;
    let refs;
    try { refs = JSON.parse(r.cross_references); } catch { continue; }
    // Take up to 3 cross-refs per verse to limit explosion
    for (let i = 0; i < Math.min(3, refs.length); i++) {
      const ref = refs[i];
      if (ref.text && ref.text.length > 15) {
        pairs.push({ anchor: srcText, positive: ref.text });
        crossRefCount++;
      }
    }
  }
  crDb.close();
} catch (e) { console.log('  cross-refs error:', e.message); }
console.log(`4. Cross-reference pairs: ${crossRefCount.toLocaleString()}`);

// ── 5. kNN top-3: semantically similar verses ───────────────────────────────
let knnCount = 0;
try {
  const gDb = new Database(path.join(DB_DIR, 'verse-graph.db'), { readonly: true });
  for (const r of gDb.prepare('SELECT verse_id, neighbor_id FROM verse_knn WHERE rank <= 3').all()) {
    const srcText = ldsVerses.get(r.verse_id);
    const nbrText = ldsVerses.get(r.neighbor_id);
    if (srcText && nbrText) {
      pairs.push({ anchor: srcText, positive: nbrText });
      knnCount++;
    }
  }
  gDb.close();
} catch (e) { console.log('  verse-graph.db error:', e.message); }
console.log(`5. kNN neighbor pairs: ${knnCount.toLocaleString()}`);

// ── 6. Adjacent verses: same-chapter continuity ─────────────────────────────
let adjCount = 0;
const sortedIds = [...ldsVerses.keys()].sort((a, b) => a - b);
for (let i = 0; i < sortedIds.length - 1; i++) {
  const a = sortedIds[i], b = sortedIds[i + 1];
  // Only pair if consecutive IDs (same chapter continuity)
  if (b - a === 1) {
    pairs.push({ anchor: ldsVerses.get(a), positive: ldsVerses.get(b) });
    adjCount++;
  }
}
console.log(`6. Adjacent verse pairs: ${adjCount.toLocaleString()}`);

// ── 7. Same-topic verse pairs (TG): two verses under same topical guide topic
let sameTopicCount = 0;
try {
  const tg = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
  const topicVerses = new Map(); // topic_id → [verse_id, ...]
  for (const r of tg.prepare('SELECT topic_id, verse_id FROM topical_guide').all()) {
    if (!ldsVerses.has(r.verse_id)) continue;
    if (!topicVerses.has(r.topic_id)) topicVerses.set(r.topic_id, []);
    topicVerses.get(r.topic_id).push(r.verse_id);
  }
  // For each topic, sample up to 3 random pairs of verses
  for (const [, vids] of topicVerses) {
    if (vids.length < 2) continue;
    const limit = Math.min(3, Math.floor(vids.length * (vids.length - 1) / 2));
    const seen = new Set();
    for (let p = 0; p < limit; p++) {
      const i = Math.floor(Math.random() * vids.length);
      let j = Math.floor(Math.random() * vids.length);
      if (i === j) j = (j + 1) % vids.length;
      const key = Math.min(vids[i], vids[j]) + ':' + Math.max(vids[i], vids[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ anchor: ldsVerses.get(vids[i]), positive: ldsVerses.get(vids[j]) });
      sameTopicCount++;
    }
  }
  tg.close();
} catch (e) { console.log('  same-topic error:', e.message); }
console.log(`7. Same-topic verse pairs (TG): ${sameTopicCount.toLocaleString()}`);

// ── 8. Same-topic verse pairs (Triple Index): two verses under same TI topic ─
let sameTripleCount = 0;
try {
  const ti = new Database(path.join(DB_DIR, 'triple-index.db'), { readonly: true });
  const triTopicVerses = new Map(); // topic_id → [verse_id, ...]
  for (const r of ti.prepare('SELECT topic_id, verse_id FROM triple_index WHERE verse_id IS NOT NULL').all()) {
    if (!ldsVerses.has(r.verse_id)) continue;
    if (!triTopicVerses.has(r.topic_id)) triTopicVerses.set(r.topic_id, []);
    triTopicVerses.get(r.topic_id).push(r.verse_id);
  }
  for (const [, vids] of triTopicVerses) {
    if (vids.length < 2) continue;
    const limit = Math.min(3, Math.floor(vids.length * (vids.length - 1) / 2));
    const seen = new Set();
    for (let p = 0; p < limit; p++) {
      const i = Math.floor(Math.random() * vids.length);
      let j = Math.floor(Math.random() * vids.length);
      if (i === j) j = (j + 1) % vids.length;
      const key = Math.min(vids[i], vids[j]) + ':' + Math.max(vids[i], vids[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ anchor: ldsVerses.get(vids[i]), positive: ldsVerses.get(vids[j]) });
      sameTripleCount++;
    }
  }
  ti.close();
} catch (e) { console.log('  same-triple error:', e.message); }
console.log(`8. Same-topic verse pairs (Triple): ${sameTripleCount.toLocaleString()}`);

// ── 9. Strong's semantic expansion pairs ────────────────────────────────────
let strongsCount = 0;
const STRONGS_PAIRS = path.join(ROOT, 'resources/strongs-pairs.json');
try {
  if (fs.existsSync(STRONGS_PAIRS)) {
    const strongsPairs = JSON.parse(fs.readFileSync(STRONGS_PAIRS, 'utf8'));
    for (const p of strongsPairs) {
      if (p.anchor && p.positive && p.anchor.length > 15 && p.positive.length > 15) {
        pairs.push(p);
        strongsCount++;
      }
    }
  } else {
    console.log('  strongs-pairs.json not found — run scripts/build-strongs-pairs.js to generate');
  }
} catch (e) { console.log('  strongs-pairs error:', e.message); }
console.log(`9. Strong's semantic pairs: ${strongsCount.toLocaleString()}`);

// ── Shuffle and write ───────────────────────────────────────────────────────
// Deterministic shuffle with seed
let seed = 42;
function seededRandom() { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; }
pairs.sort(() => seededRandom() - 0.5);

fs.writeFileSync(OUT, JSON.stringify(pairs, null, 0));
const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);

console.log(`\n════════════════════════════════════════`);
console.log(`Total pairs: ${pairs.length.toLocaleString()}`);
console.log(`File: ${OUT} (${sizeMB} MB)`);
console.log(`════════════════════════════════════════`);
console.log(`\nBreakdown:`);
console.log(`  Translation (LDS↔YLT↔Rotherham): ${translationCount.toLocaleString()}`);
console.log(`  Topical guide:            ${topicCount.toLocaleString()}`);
console.log(`  Triple Index:             ${tripleTopicCount.toLocaleString()}`);
console.log(`  Cross-references:         ${crossRefCount.toLocaleString()}`);
console.log(`  kNN neighbors:            ${knnCount.toLocaleString()}`);
console.log(`  Adjacent verses:          ${adjCount.toLocaleString()}`);
console.log(`  Same-topic (TG):          ${sameTopicCount.toLocaleString()}`);
console.log(`  Same-topic (Triple):      ${sameTripleCount.toLocaleString()}`);
  console.log(`  Strong's semantic:        ${strongsCount.toLocaleString()}`);
console.log(`\nNext: upload resources/training-pairs.json to Google Colab`);
