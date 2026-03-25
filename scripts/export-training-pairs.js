#!/usr/bin/env node
/**
 * Export training pairs for multilingual scripture fine-tuning.
 *
 * Pair sources (by training signal strength):
 *   1. Translation pairs   — same verse across LDS ↔ NRSVUE ↔ Tagalog ↔ ... (paraphrase)
 *   2. Topical guide        — topic name ↔ verse text (concept grounding)
 *   3. Cross-references     — theologically linked verses
 *   4. kNN top-3 neighbors  — semantically similar verses stay close
 *   5. Adjacent verses      — same-chapter continuity
 *   6. Same-topic verse pairs — two verses under the same topic are related
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
  lds:     'lds-scriptures-sqlite.db',
  nrsvue:  'nrsvue-scriptures-sqlite.db',
  tagalog: 'tagalog-scriptures-sqlite.db',
  cebuano: 'cebuano-scriptures-sqlite.db',
  spanish: 'spanish-scriptures-sqlite.db',
  ilocano: 'ilocano-scriptures-sqlite.db',
  // waray omitted — incomplete text for triple combinations (only 28k/42k verses)
  japanese:'japanese-scriptures-sqlite.db',
  greek:   'greek-scriptures-sqlite.db',
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
console.log(`\n1. Translation pairs: ${translationCount.toLocaleString()}`);

// ── 2. NRSVUE ↔ other languages (cross-translation without LDS) ─────────────
// Reinforces that ALL translations of the same verse should cluster
let crossTransCount = 0;
const nrsvueVerses = versesByLang.get('nrsvue');
if (nrsvueVerses) {
  for (const [lang, map] of versesByLang) {
    if (lang === 'lds' || lang === 'nrsvue') continue;
    // Sample 1/3 to avoid overwhelming the dataset with translation pairs
    let i = 0;
    for (const [vid, text] of map) {
      if (i++ % 3 !== 0) continue;
      const nText = nrsvueVerses.get(vid);
      if (nText) {
        pairs.push({ anchor: nText, positive: text });
        crossTransCount++;
      }
    }
  }
}
console.log(`2. Cross-translation pairs: ${crossTransCount.toLocaleString()}`);

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
console.log(`3. Topical guide pairs: ${topicCount.toLocaleString()}`);

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

// ── 7. Same-topic verse pairs (sampled): two verses under same topic ────────
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
console.log(`7. Same-topic verse pairs: ${sameTopicCount.toLocaleString()}`);

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
console.log(`  Translation (LDS↔langs): ${translationCount.toLocaleString()}`);
console.log(`  Cross-translation:       ${crossTransCount.toLocaleString()}`);
console.log(`  Topical guide:           ${topicCount.toLocaleString()}`);
console.log(`  Cross-references:        ${crossRefCount.toLocaleString()}`);
console.log(`  kNN neighbors:           ${knnCount.toLocaleString()}`);
console.log(`  Adjacent verses:         ${adjCount.toLocaleString()}`);
console.log(`  Same-topic verses:       ${sameTopicCount.toLocaleString()}`);
console.log(`\nNext: upload resources/training-pairs.json to Google Colab`);
