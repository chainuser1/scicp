#!/usr/bin/env node
/**
 * Export training pairs for scripture embedding fine-tuning (BGE-Large).
 *
 * Pair sources (ranked by training signal strength):
 *
 *   1. Verse summaries — scholarly commentary ↔ verse (meaning grounding)
 *        1a. paragraph_1 ↔ verse    — narrative context anchor
 *        1b. paragraph_2 ↔ verse    — cross-canon pattern anchor
 *        1c. verse ↔ full commentary — bidirectional meaning retrieval
 *
 *   2. Translation pairs    — LDS ↔ modern-English (paraphrase invariance)
 *   3. Topical guide        — topic name ↔ verse (concept grounding)
 *   4. Triple Index         — topic name ↔ verse (broader concept coverage)
 *   5. Cross-references     — theologically linked verses (human-curated)
 *   6. Adjacent verses      — same-chapter narrative continuity
 *   7. Same-topic (TG)      — two verses under the same TG topic
 *   8. Same-topic (TI)      — two verses under the same Triple Index topic
 *
 * Sources intentionally excluded:
 *   ✗ kNN neighbors — encodes the geometry of the current embedding model, not ground truth.
 *     Neighbor structure should be discovered after retraining and prebaking, not baked back into supervision.
 *     Re-add only in a later round using the new model's own embeddings and a measured justification.
 *
 * Output: resources/training-pairs.json
 *   [ { "anchor": "...", "positive": "..." }, ... ]
 *
 * Usage:
 *   node scripts/export-training-pairs.js
 */

'use strict';

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const ROOT   = path.join(__dirname, '..');
const DB_DIR = path.join(ROOT, 'resources/db');
const OUT    = path.join(ROOT, 'resources/training-pairs.json');

// ── Deterministic PRNG (LCG, seed=42) ───────────────────────────────────────
// Used for ALL random sampling — Math.random() is never called in this script.
// Every run produces identical output, making training fully reproducible.
let _seed = 42;
function seededRandom() {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return _seed / 2147483647;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function clean(text, minLen = 15) {
  if (!text) return null;
  const t = text.trim();
  return t.length >= minLen ? t : null;
}

// Join two paragraphs into one coherent commentary block.
function joinParagraphs(p1, p2) {
  const parts = [p1, p2].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

// ── Load all language DBs ────────────────────────────────────────────────────
// English-only: non-English translations contaminate the embedding space
// and split model capacity toward languages we never search in.
const LANG_DBS = {
  lds:    'lds-scriptures-sqlite.db',
  ylt:    'ylt-scriptures-sqlite.db',
  nrsvue: 'nrsvue-scriptures-sqlite.db',
};

const versesByLang = new Map();

console.log('Loading verse databases...');
for (const [lang, file] of Object.entries(LANG_DBS)) {
  const dbPath = path.join(DB_DIR, file);
  if (!fs.existsSync(dbPath)) {
    console.log(`  skip ${lang} (not found: ${file})`);
    continue;
  }
  const db  = new Database(dbPath, { readonly: true });
  const map = new Map();
  for (const r of db.prepare('SELECT id, scripture_text FROM verses').all()) {
    const t = clean(r.scripture_text);
    if (t) map.set(r.id, t);
  }
  versesByLang.set(lang, map);
  console.log(`  ${lang}: ${map.size.toLocaleString()} verses`);
  db.close();
}

const ldsVerses = versesByLang.get('lds');
if (!ldsVerses || ldsVerses.size === 0)
  throw new Error('LDS verse database not loaded — cannot continue.');

// ── Build chapter membership map for safe adjacency checks ──────────────────
// verse_id → chapter_id, so we never pair across chapter boundaries
// even when verse IDs happen to be numerically consecutive there.
const verseChapter = new Map();
try {
  const ldsDb = new Database(path.join(DB_DIR, LANG_DBS.lds), { readonly: true });
  for (const r of ldsDb.prepare('SELECT id, chapter_id FROM verses').all())
    verseChapter.set(r.id, r.chapter_id);
  ldsDb.close();
  console.log(`  chapter map: ${verseChapter.size.toLocaleString()} entries`);
} catch (e) {
  console.warn('  ⚠️  Could not load chapter_id — adjacent pairs will use ID-gap fallback');
}

const pairs = [];

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 1 — Verse summaries (scholarly commentary)
// ════════════════════════════════════════════════════════════════════════════
//
// The verse_summaries table contains two-paragraph scholarly commentary per verse:
//
//   paragraph_1 — Narrative/contextual analysis: positions the verse within its
//                 chapter, identifies key literary and theological details, and
//                 explains what the verse accomplishes in its immediate context.
//
//   paragraph_2 — Cross-canon pattern analysis: identifies related scriptures,
//                 names the theological pattern they share (e.g. "weeping before
//                 divine reversal"), and explains how the anchor verse fits that
//                 canon-wide pattern.
//
// Three pair types are generated per verse:
//
//   1a. paragraph_1 → verse
//       Anchor: narrative description of the verse's meaning and context.
//       Teaches: "what this verse means in context" → retrieve the verse.
//
//   1b. paragraph_2 → verse  ← highest-value pair type in the entire dataset
//       Anchor: named cross-canon theological pattern + related scriptures.
//       Teaches: "weeping before divine reversal" → retrieve ALL verses that
//       participate in that pattern across testaments and canonicals.
//       No other source provides this pattern-level cross-canon signal.
//
//   1c. verse → full commentary (bidirectional)
//       Teaches: given a verse, retrieve its full theological interpretation.
//       Reinforces 1a and 1b in the reverse retrieval direction.
//
// Only rows where status = 'ai-verified' are included.
// Paragraphs shorter than 40 characters are treated as incomplete and skipped.

let summaryP1Count = 0;
let summaryP2Count = 0;
let summaryBiCount = 0;

try {
  const vsDb = new Database(path.join(DB_DIR, 'verse-summaries.db'), { readonly: true });

  // Detect column layout — support both paragraph_1/paragraph_2 and legacy summary
  const cols        = vsDb.pragma('table_info(verse_summaries)').map(c => c.name);
  const hasParagraphs = cols.includes('paragraph_1') && cols.includes('paragraph_2');
  const hasSummary    = cols.includes('summary');

  if (!hasParagraphs && !hasSummary) {
    console.warn('  ⚠️  verse_summaries: no recognised text columns — skipping source 1');
  } else {
    const query = hasParagraphs
      ? "SELECT verse_id, paragraph_1, paragraph_2 FROM verse_summaries WHERE status = 'ai-verified'"
      : "SELECT verse_id, summary            FROM verse_summaries WHERE status = 'ai-verified'";

    for (const r of vsDb.prepare(query).all()) {
      const verseText = ldsVerses.get(r.verse_id);
      if (!verseText) continue;

      let p1, p2;

      if (hasParagraphs) {
        p1 = clean(r.paragraph_1, 40);
        p2 = clean(r.paragraph_2, 40);
      } else {
        // Fallback: split single summary on blank line to approximate paragraphs
        const raw   = clean(r.summary, 40);
        if (!raw) continue;
        const parts = raw.split(/\n\n+/);
        p1 = parts[0]?.trim() || null;
        p2 = parts.length > 1 ? parts.slice(1).join(' ').trim() : null;
        if (!p1) p1 = raw; // no split found — use full text as p1
      }

      // 1a — narrative context → verse
      if (p1) {
        pairs.push({ anchor: p1, positive: verseText });
        summaryP1Count++;
      }

      // 1b — cross-canon pattern → verse (highest-value pair type)
      if (p2) {
        pairs.push({ anchor: p2, positive: verseText });
        summaryP2Count++;
      }

      // 1c — verse → full commentary (bidirectional)
      const fullCommentary = joinParagraphs(p1, p2);
      if (fullCommentary) {
        pairs.push({ anchor: verseText, positive: fullCommentary });
        summaryBiCount++;
      }
    }
  }

  vsDb.close();
} catch (e) { console.error('  verse-summaries.db error:', e.message); }

const summaryTotal = summaryP1Count + summaryP2Count + summaryBiCount;
console.log(`\n1. Verse summary pairs: ${summaryTotal.toLocaleString()}`);
console.log(`   1a. paragraph_1 → verse : ${summaryP1Count.toLocaleString()}`);
console.log(`   1b. paragraph_2 → verse : ${summaryP2Count.toLocaleString()}`);
console.log(`   1c. verse → commentary  : ${summaryBiCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 2 — Translation pairs: LDS ↔ modern English
// ════════════════════════════════════════════════════════════════════════════
// Same verse, different words — teaches paraphrase invariance.
// KJV archaic forms ("thee", "thou", "hath") map to modern equivalents.
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
console.log(`2. Translation pairs (LDS ↔ modern English): ${translationCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 3 — Topical guide: topic name ↔ verse
// ════════════════════════════════════════════════════════════════════════════
// Teaches concept grounding — enables queries like "faith" → verse.
let topicCount = 0;
try {
  const tg     = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
  const topics = new Map();
  for (const r of tg.prepare('SELECT id, name FROM topics').all())
    topics.set(r.id, r.name.trim());

  for (const r of tg.prepare('SELECT topic_id, verse_id FROM topical_guide').all()) {
    const topic = topics.get(r.topic_id);
    const verse = ldsVerses.get(r.verse_id);
    if (topic && verse) {
      pairs.push({ anchor: topic, positive: verse });
      topicCount++;
    }
  }
  tg.close();
} catch (e) { console.error('  topical-guide.db error:', e.message); }
console.log(`3. Topical guide pairs: ${topicCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 4 — Triple Combination Index: topic name ↔ verse
// ════════════════════════════════════════════════════════════════════════════
// Broader coverage than TG (3,059 topics, ~44k mappings).
// TI snippets ignored — verse text only for consistent pair format.
let tripleTopicCount = 0;
try {
  const ti        = new Database(path.join(DB_DIR, 'triple-index.db'), { readonly: true });
  const triTopics = new Map();
  for (const r of ti.prepare('SELECT id, name FROM topics').all())
    triTopics.set(r.id, r.name.trim());

  for (const r of ti.prepare(
    'SELECT topic_id, verse_id FROM triple_index WHERE verse_id IS NOT NULL'
  ).all()) {
    const topic = triTopics.get(r.topic_id);
    const verse = ldsVerses.get(r.verse_id);
    if (topic && verse) {
      pairs.push({ anchor: topic, positive: verse });
      tripleTopicCount++;
    }
  }
  ti.close();
} catch (e) { console.error('  triple-index.db error:', e.message); }
console.log(`4. Triple Index pairs: ${tripleTopicCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 5 — Cross-references: theologically linked verses
// ════════════════════════════════════════════════════════════════════════════
// Human scholars explicitly marked these as connected — strong inter-verse
// signal. Capped at 3 per verse to prevent high-ref verses dominating.
let crossRefCount = 0;
try {
  const crDb = new Database(path.join(DB_DIR, 'verse-cross-refs.db'), { readonly: true });
  for (const r of crDb.prepare(
    'SELECT verse_id, cross_references FROM verse_cross_references'
  ).all()) {
    const srcText = ldsVerses.get(r.verse_id);
    if (!srcText) continue;
    let refs;
    try { refs = JSON.parse(r.cross_references); } catch { continue; }
    for (let i = 0; i < Math.min(3, refs.length); i++) {
      const refText = clean(refs[i]?.text);
      if (refText) {
        pairs.push({ anchor: srcText, positive: refText });
        crossRefCount++;
      }
    }
  }
  crDb.close();
} catch (e) { console.error('  cross-refs error:', e.message); }
console.log(`5. Cross-reference pairs: ${crossRefCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 6 — Adjacent verses: same-chapter narrative continuity
// ════════════════════════════════════════════════════════════════════════════
// Consecutive verses within the same chapter share narrative flow.
// chapter_id equality verified from DB — never pairs across chapter boundaries.
let adjCount = 0;
const sortedIds = [...ldsVerses.keys()].sort((a, b) => a - b);

for (let i = 0; i < sortedIds.length - 1; i++) {
  const idA = sortedIds[i];
  const idB = sortedIds[i + 1];

  const sameChapter = verseChapter.size > 0
    ? verseChapter.get(idA) !== undefined &&
      verseChapter.get(idA) === verseChapter.get(idB)
    : (idB - idA === 1); // fallback if chapter map unavailable

  if (sameChapter) {
    pairs.push({ anchor: ldsVerses.get(idA), positive: ldsVerses.get(idB) });
    adjCount++;
  }
}
console.log(`6. Adjacent verse pairs: ${adjCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 7 — Same-topic verse pairs (Topical Guide)
// ════════════════════════════════════════════════════════════════════════════
// Two verses grouped under the same TG topic by human editors.
// Up to 5 pairs per topic, seeded PRNG, canonical min:max deduplication.
let sameTopicTGCount = 0;
try {
  const tg          = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
  const topicVerses = new Map();
  for (const r of tg.prepare('SELECT topic_id, verse_id FROM topical_guide').all()) {
    if (!ldsVerses.has(r.verse_id)) continue;
    if (!topicVerses.has(r.topic_id)) topicVerses.set(r.topic_id, []);
    topicVerses.get(r.topic_id).push(r.verse_id);
  }
  tg.close();

  for (const [, vids] of topicVerses) {
    if (vids.length < 2) continue;
    const maxPairs = Math.min(5, Math.floor(vids.length * (vids.length - 1) / 2));
    const seen     = new Set();
    let attempts   = 0;
    while (seen.size < maxPairs && attempts < maxPairs * 4) {
      attempts++;
      const i   = Math.floor(seededRandom() * vids.length);
      let j     = Math.floor(seededRandom() * vids.length);
      if (i === j) j = (j + 1) % vids.length;
      const key = Math.min(vids[i], vids[j]) + ':' + Math.max(vids[i], vids[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ anchor: ldsVerses.get(vids[i]), positive: ldsVerses.get(vids[j]) });
      sameTopicTGCount++;
    }
  }
} catch (e) { console.error('  same-topic (TG) error:', e.message); }
console.log(`7. Same-topic verse pairs (TG): ${sameTopicTGCount.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 8 — Same-topic verse pairs (Triple Index)
// ════════════════════════════════════════════════════════════════════════════
// Same pattern as source 7 using Triple Index groupings.
// Broader doctrinal coverage — TI topics tend to be more specific.
let sameTopicTICount = 0;
try {
  const ti             = new Database(path.join(DB_DIR, 'triple-index.db'), { readonly: true });
  const triTopicVerses = new Map();
  for (const r of ti.prepare(
    'SELECT topic_id, verse_id FROM triple_index WHERE verse_id IS NOT NULL'
  ).all()) {
    if (!ldsVerses.has(r.verse_id)) continue;
    if (!triTopicVerses.has(r.topic_id)) triTopicVerses.set(r.topic_id, []);
    triTopicVerses.get(r.topic_id).push(r.verse_id);
  }
  ti.close();

  for (const [, vids] of triTopicVerses) {
    if (vids.length < 2) continue;
    const maxPairs = Math.min(5, Math.floor(vids.length * (vids.length - 1) / 2));
    const seen     = new Set();
    let attempts   = 0;
    while (seen.size < maxPairs && attempts < maxPairs * 4) {
      attempts++;
      const i   = Math.floor(seededRandom() * vids.length);
      let j     = Math.floor(seededRandom() * vids.length);
      if (i === j) j = (j + 1) % vids.length;
      const key = Math.min(vids[i], vids[j]) + ':' + Math.max(vids[i], vids[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ anchor: ldsVerses.get(vids[i]), positive: ldsVerses.get(vids[j]) });
      sameTopicTICount++;
    }
  }
} catch (e) { console.error('  same-topic (TI) error:', e.message); }
console.log(`8. Same-topic verse pairs (Triple): ${sameTopicTICount.toLocaleString()}`);

// ── Deduplicate ──────────────────────────────────────────────────────────────
// Remove exact (anchor, positive) duplicates — arise when the same verse
// appears in both TG and TI under identically named topics, or when a summary
// paragraph coincidentally matches a topical entry.
// Null-byte separator cannot appear in scripture or commentary text.
const beforeDedup  = pairs.length;
const dedupSeen    = new Set();
const dedupedPairs = pairs.filter(p => {
  const key = p.anchor + '\x00' + p.positive;
  if (dedupSeen.has(key)) return false;
  dedupSeen.add(key);
  return true;
});
const dedupRemoved = beforeDedup - dedupedPairs.length;
if (dedupRemoved > 0)
  console.log(`\nDeduplication: removed ${dedupRemoved.toLocaleString()} exact duplicates`);

// ── Deterministic shuffle ────────────────────────────────────────────────────
// Interleave all sources uniformly across training batches.
// Uses seededRandom() — fully reproducible across runs.
dedupedPairs.sort(() => seededRandom() - 0.5);

// ── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(OUT, JSON.stringify(dedupedPairs, null, 0));
const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);

console.log(`
════════════════════════════════════════════════════════════
Total pairs : ${dedupedPairs.length.toLocaleString()}
Output      : ${OUT}
Size        : ${sizeMB} MB
════════════════════════════════════════════════════════════

Breakdown:
  1. Verse summaries                      : ${summaryTotal.toLocaleString()}
     1a. paragraph_1 → verse              : ${summaryP1Count.toLocaleString()}
     1b. paragraph_2 → verse              : ${summaryP2Count.toLocaleString()}
     1c. verse → full commentary          : ${summaryBiCount.toLocaleString()}
  2. Translation (LDS ↔ modern English)   : ${translationCount.toLocaleString()}
  3. Topical guide (topic ↔ verse)        : ${topicCount.toLocaleString()}
  4. Triple Index (topic ↔ verse)         : ${tripleTopicCount.toLocaleString()}
  5. Cross-references (verse ↔ verse)     : ${crossRefCount.toLocaleString()}
  6. Adjacent verses (same chapter)       : ${adjCount.toLocaleString()}
  7. Same-topic pairs (TG)                : ${sameTopicTGCount.toLocaleString()}
  8. Same-topic pairs (TI)                : ${sameTopicTICount.toLocaleString()}
  ────────────────────────────────────────────────────────
  Duplicates removed                      : ${dedupRemoved.toLocaleString()}

Next: upload resources/training-pairs.json to Kaggle → scicp-training dataset
`);