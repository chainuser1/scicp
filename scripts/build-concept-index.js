/**
 * Pre-build concept embeddings index
 * Embeds all Topical Guide topic names, entity names, and chapter summary topics
 * into a concept-embeddings.db for fast semantic concept expansion at search time.
 *
 * Usage: node scripts/build-concept-index.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '../resources/db');

async function main() {
  console.log('Loading pipeline...');
  const { pipeline } = await import('@xenova/transformers');
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Pipeline ready.');

  const outDb = new Database(path.join(DB_DIR, 'concept-embeddings.db'));
  outDb.pragma('journal_mode = WAL');
  outDb.exec(`
    CREATE TABLE IF NOT EXISTS concepts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phrase TEXT NOT NULL,
      source TEXT NOT NULL,
      embedding BLOB NOT NULL,
      UNIQUE(phrase, source)
    )
  `);
  outDb.exec('DELETE FROM concepts');

  const insert = outDb.prepare('INSERT INTO concepts (phrase, source, embedding) VALUES (?, ?, ?)');
  const phrases = new Map(); // phrase → source

  // 1. Topical Guide topic names
  try {
    const tgDb = new Database(path.join(DB_DIR, 'topical-guide.db'), { readonly: true });
    const topics = tgDb.prepare('SELECT name FROM topics').all();
    for (const t of topics) {
      if (t.name && t.name.trim()) phrases.set(t.name.trim().toLowerCase(), 'topical-guide');
    }
    tgDb.close();
    console.log(`  ${phrases.size} topical guide topics`);
  } catch (e) { console.warn('TG skip:', e.message); }

  // 2. Entity names (people + places)
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

  // 3. Chapter summary top topics
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

  // 4. Scripture synonyms keys
  try {
    const synonyms = require('../shared/scripture-synonyms.json');
    for (const key of Object.keys(synonyms)) {
      if (!phrases.has(key)) phrases.set(key, 'synonym');
    }
    console.log(`  ${Object.keys(synonyms).length} synonym keys`);
  } catch (e) { console.warn('Synonym skip:', e.message); }

  console.log(`\nTotal: ${phrases.size} unique concept phrases to embed`);

  // Batch embed
  const entries = [...phrases.entries()];
  const BATCH = 64;
  let done = 0;
  const insertMany = outDb.transaction((items) => {
    for (const { phrase, source, buf } of items) insert.run(phrase, source, buf);
  });

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const texts = batch.map(([p]) => p);
    const results = await pipe(texts, { pooling: 'mean', normalize: true });

    const items = batch.map(([phrase, source], j) => {
      const vec = new Float32Array(384);
      for (let k = 0; k < 384; k++) vec[k] = results[j].data[k];
      return { phrase, source, buf: Buffer.from(vec.buffer) };
    });
    insertMany(items);
    done += batch.length;
    process.stdout.write(`\r  Embedded ${done}/${entries.length}`);
  }

  console.log('\n✅ Concept index built:', path.join(DB_DIR, 'concept-embeddings.db'));
  outDb.close();
}

main().catch(e => { console.error(e); process.exit(1); });
