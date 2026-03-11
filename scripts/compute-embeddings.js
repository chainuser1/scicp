/**
 * compute-embeddings.js — Pre-compute verse embeddings locally.
 *
 * Writes to resources/db/verse-embeddings.db (separate from scripture DBs).
 * Resume-safe: skips already-computed verses.
 * Run once locally, commit via git-lfs, Railway never recomputes.
 *
 * Usage:
 *   node scripts/compute-embeddings.js
 *   node scripts/compute-embeddings.js --rebuild   # clear and recompute all
 */
'use strict';

const path  = require('path');
const DB    = require('better-sqlite3');

const DB_DIR   = path.resolve(__dirname, '../resources/db');
const EMBED_DB = path.join(DB_DIR, 'verse-embeddings.db');
const SRC_DB   = path.join(DB_DIR, 'lds-scriptures-sqlite.db');
const BATCH    = 50;
const REBUILD  = process.argv.includes('--rebuild');

async function main() {
  const src    = new DB(SRC_DB, { readonly: true, fileMustExist: true });
  const embed  = new DB(EMBED_DB);

  embed.exec(`
    CREATE TABLE IF NOT EXISTS verse_embeddings (
      verse_id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL
    );
  `);

  if (REBUILD) {
    embed.prepare('DELETE FROM verse_embeddings').run();
    console.log('Cleared all embeddings for rebuild.');
  }

  const total    = src.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
  const existing = embed.prepare('SELECT COUNT(*) AS n FROM verse_embeddings').get().n;
  console.log('Verses: ' + total + '  Already embedded: ' + existing);

  if (existing >= total && !REBUILD) {
    console.log('All embeddings already computed. Done.');
    src.close(); embed.close();
    return;
  }

  const embeddedIds = new Set(
    embed.prepare('SELECT verse_id FROM verse_embeddings').all().map(r => r.verse_id)
  );
  const missing = src.prepare('SELECT id AS verse_id, scripture_text FROM verses').all()
    .filter(v => !embeddedIds.has(v.verse_id));

  console.log('Computing ' + missing.length + ' embeddings...');

  const { pipeline } = await import('@xenova/transformers');
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model loaded. Starting...');

  const ins = embed.prepare('INSERT OR REPLACE INTO verse_embeddings (verse_id, embedding) VALUES (?, ?)');
  const insertBatch = embed.transaction(rows => {
    for (const { verse_id, buf } of rows) ins.run(verse_id, buf);
  });

  let done = 0;
  const start = Date.now();
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const rows  = [];
    for (const v of batch) {
      const out = await pipe(v.scripture_text, { pooling: 'mean', normalize: true });
      rows.push({ verse_id: v.verse_id, buf: Buffer.from(new Float32Array(out.data).buffer) });
    }
    insertBatch(rows);
    done += batch.length;
    if (done % 500 === 0 || done >= missing.length) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const remaining = done < missing.length
        ? Math.round((missing.length - done) * (Date.now() - start) / done / 1000)
        : 0;
      console.log('  ' + done + '/' + missing.length + '  (' + elapsed + 's elapsed' + (remaining ? ', ~' + remaining + 's remaining' : ' -- done') + ')');
    }
  }

  const finalCount = embed.prepare('SELECT COUNT(*) AS n FROM verse_embeddings').get().n;
  console.log('\nDone. ' + finalCount + '/' + total + ' embeddings stored in ' + EMBED_DB);
  src.close();
  embed.close();
}

main().catch(err => { console.error(err); process.exit(1); });
