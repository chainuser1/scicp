/**
 * Pre-build concept embeddings index — Step 1: collect phrases
 *
 * Gathers all concept phrases from:
 *   - Topical Guide topic names
 *   - Entity names (people + places)
 *   - Chapter summary top topics
 *   - Scripture synonym keys
 *
 * Writes phrases to resources/concept-phrases.json, then shells out to
 * scripts/embed-concepts.py which uses the fine-tuned PyTorch model
 * to encode them and write the final concept-embeddings.db.
 *
 * Why split? @xenova/transformers requires ONNX format and cannot load
 * local PyTorch model folders. sentence-transformers (Python) loads the
 * fine-tuned model natively, keeping concept + verse embeddings in the
 * same vector space.
 *
 * Usage: node scripts/build-concept-index.js
 *        SCRIPTURE_MODEL_DIR=resources/models/scripture-minilm-vNext node scripts/build-concept-index.js
 */
'use strict';

const Database     = require('better-sqlite3');
const path         = require('path');
const fs           = require('fs');
const { execSync } = require('child_process');

const DB_DIR      = path.resolve(__dirname, '../resources/db');
const PHRASES_TMP = path.resolve(__dirname, '../resources/concept-phrases.json');
const MODEL_DIR   = process.env.SCRIPTURE_MODEL_DIR ? path.resolve(process.cwd(), process.env.SCRIPTURE_MODEL_DIR) : null;

async function main() {
  const phrases = new Map(); // phrase → source

  // ── 1. Topical Guide topic names ────────────────────────────────────────
  try {
    const tgDb = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
    const topics = tgDb.prepare('SELECT name FROM topics').all();
    for (const t of topics) {
      if (t.name && t.name.trim()) phrases.set(t.name.trim().toLowerCase(), 'topical-guide');
    }
    tgDb.close();
    console.log(`  ${phrases.size} topical guide topics`);
  } catch (e) { console.warn('TG skip:', e.message); }

  // ── 2. Entity names (people + places) ───────────────────────────────────
  try {
    const tagsDb = new Database(path.join(DB_DIR, 'verse-tags.db'), { readonly: true });
    const rows = tagsDb.prepare('SELECT entities_json FROM chapter_entities WHERE entities_json IS NOT NULL').all();
    const entitySet = new Set();
    for (const r of rows) {
      try {
        const obj = JSON.parse(r.entities_json);
        for (const name of [...(obj.people || []), ...(obj.places || [])]) {
          const n = name.trim().toLowerCase();
          if (n.length > 1) entitySet.add(n);
        }
      } catch {}
    }
    for (const e of entitySet) {
      if (!phrases.has(e)) phrases.set(e, 'entity');
    }
    tagsDb.close();
    console.log(`  ${entitySet.size} entity names`);
  } catch (e) { console.warn('Entity skip:', e.message); }

  // ── 3. Chapter summary top topics ───────────────────────────────────────
  try {
    const sumDb = new Database(path.join(DB_DIR, 'chapter-summaries-fts.db'), { readonly: true });
    const rows = sumDb.prepare('SELECT top_topics_json FROM chapter_summaries WHERE top_topics_json IS NOT NULL').all();
    const topicSet = new Set();
    for (const r of rows) {
      try {
        const topics = JSON.parse(r.top_topics_json);
        for (const t of topics) {
          const n = (typeof t === 'string' ? t : t.label || t.topic || t.name || '').trim().toLowerCase();
          if (n.length > 1) topicSet.add(n);
        }
      } catch {}
    }
    for (const t of topicSet) {
      if (!phrases.has(t)) phrases.set(t, 'summary-topic');
    }
    sumDb.close();
    console.log(`  ${topicSet.size} summary topics`);
  } catch (e) { console.warn('Summary skip:', e.message); }

  // ── 4. Scripture synonym keys ────────────────────────────────────────────
  try {
    const synonyms = require('../shared/scripture-synonyms.json');
    for (const key of Object.keys(synonyms)) {
      if (!phrases.has(key)) phrases.set(key, 'synonym');
    }
    console.log(`  ${Object.keys(synonyms).length} synonym keys`);
  } catch (e) { console.warn('Synonym skip:', e.message); }

  console.log(`\nTotal: ${phrases.size} unique concept phrases`);

  // ── Write phrases to temp JSON for Python ────────────────────────────────
  const payload = [...phrases.entries()].map(([phrase, source]) => ({ phrase, source }));
  fs.writeFileSync(PHRASES_TMP, JSON.stringify(payload, null, 0));
  console.log(`Phrases written to: ${PHRASES_TMP}`);

  // ── Shell out to Python for encoding ────────────────────────────────────
  // embed-concepts.py loads the fine-tuned model, encodes all phrases,
  // and writes concept-embeddings.db. stdout is inherited so progress shows.
  console.log('\nShelling out to embed-concepts.py...');
  const embedScript = path.resolve(__dirname, 'embed-concepts.py');
  execSync(`python3 "${embedScript}"`, {
    stdio: 'inherit',
    env: MODEL_DIR ? { ...process.env, SCRIPTURE_MODEL_DIR: MODEL_DIR } : process.env,
  });

  // ── Cleanup temp file ────────────────────────────────────────────────────
  fs.unlinkSync(PHRASES_TMP);
  console.log('\n✅ Concept index complete.');
}

main().catch(e => { console.error(e); process.exit(1); });