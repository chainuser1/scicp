'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const cosineSim = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

(async () => {
  // Load embeddings DB and main DB
  const embDb = new Database(path.join(ROOT, 'resources/db/verse-embeddings.db'), { readonly: true });
  const mainDb = new Database(path.join(ROOT, 'resources/db/lds-scriptures-sqlite.db'), { readonly: true });

  // Load ONNX pipeline
  const { pipeline, env } = await import('@xenova/transformers');
  const ONNX_DIR = path.join(ROOT, 'resources/onnx');
  env.localModelPath = ONNX_DIR;
  env.allowRemoteModels = false;
  const pipe = await pipeline('feature-extraction', 'scripture-bge', { quantized: true });
  console.log('Pipeline ready');

  const tests = [
    { q: 'exhort you brethren that ye might come unto Christ', targetId: 37690, desc: 'Moroni 10:30' },
    { q: 'wisdom foolishness of God wiser than men', targetId: 28389, desc: '1 Corinthians 1:25' },
  ];

  for (const t of tests) {
    const out = await pipe(t.q, { pooling: 'mean', normalize: true });
    const qvec = new Float32Array(out.data);
    console.log('\nQuery: "' + t.q + '"');
    console.log('  qvec len=' + qvec.length + ' norm=' + Math.sqrt(Array.from(qvec).reduce((s,v)=>s+v*v,0)).toFixed(4));

    const row = embDb.prepare('SELECT embedding FROM verse_embeddings WHERE verse_id = ?').get(t.targetId);
    if (!row) { console.log('  Target verse not in embeddings!'); continue; }
    const vvec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    const cos = cosineSim(qvec, vvec);
    const vrow = mainDb.prepare('SELECT verse_title, scripture_text FROM scriptures WHERE verse_id=?').get(t.targetId);
    console.log('  → ' + t.desc + ' (verse_id=' + t.targetId + ')');
    console.log('    cosine=' + cos.toFixed(4));
    console.log('    text: ' + (vrow?.scripture_text||'').slice(0, 100));

    // Find HNSW-level ranking by brute force top-20 cosine similarity
    console.log('  Top 10 by cosine:');
    const allRows = embDb.prepare('SELECT verse_id, embedding FROM verse_embeddings').all();
    const scores = allRows.map(r => {
      const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength/4);
      return { verse_id: r.verse_id, cos: cosineSim(qvec, v) };
    });
    scores.sort((a,b) => b.cos - a.cos);
    for (const s of scores.slice(0, 10)) {
      const vr = mainDb.prepare('SELECT verse_title FROM scriptures WHERE verse_id=?').get(s.verse_id);
      const mark = s.verse_id === t.targetId ? ' <<<' : '';
      console.log('    verse_id=' + s.verse_id + ' cos=' + s.cos.toFixed(4) + ' ' + (vr?.verse_title||'?') + mark);
    }
    // Find rank of target
    const rank = scores.findIndex(s => s.verse_id === t.targetId) + 1;
    console.log('  Target rank in brute-force: #' + rank + ' / 41995');
  }

  process.exit(0);
})();
