#!/usr/bin/env node
/**
 * Pre-bake chapter summaries.
 * Default mode: contextual synthesis (official LDS chapter description + chapter signals).
 * Optional mode: extractive centroid (fast, local) with --extractive.
 *
 * Stores per chapter:
 *  - summary_text    : contextual prose summary
 *  - key_verses_json : top-3 most central verses with verse_id, verse_number, text
 *  - top_topics_json : top-5 doctrine topics aggregated from verse_doctrine_tags
 *
 * Optional: add --abstractive flag to generate distilbart prose summaries
 *           (adds ~40h on CPU — only use with a GPU or don't bother).
 *
 * Run once locally (contextual): node scripts/compute-chapters.js
 * Run extractive only:           node scripts/compute-chapters.js --extractive
 * Force full re-bake: node scripts/compute-chapters.js --reset
 * Resumes from where it left off otherwise.
 */

const path = require('path');
const Database = require('better-sqlite3');
const os = require('os');

const DB_DIR  = path.resolve(__dirname, '../resources/db');
const db      = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true });
const db_emb  = new Database(path.join(DB_DIR, 'verse-embeddings.db'),       { readonly: true });
const db_tags = new Database(path.join(DB_DIR, 'verse-tags.db'));

const RESET       = process.argv.includes('--reset');
const ABSTRACTIVE = process.argv.includes('--abstractive');
const EXTRACTIVE  = process.argv.includes('--extractive');
const CONTEXTUAL  = !ABSTRACTIVE && !EXTRACTIVE;
const RESUME      = process.argv.includes('--resume');

if (RESUME && !ABSTRACTIVE) {
  console.log(`Resume mode: continuing from where ${CONTEXTUAL ? 'contextual' : 'extractive'} left off (skipping already-done chapters).`);
}
// RESUME only applies when upgrading extractive → abstractive
const RESUME_ABSTRACTIVE = RESUME && ABSTRACTIVE;
if (RESET) {
  db_tags.exec('DROP TABLE IF EXISTS chapter_summaries;');
  console.log('Reset: cleared chapter_summaries.');
}

db_tags.exec(`
  CREATE TABLE IF NOT EXISTS chapter_summaries (
    chapter_id      INTEGER PRIMARY KEY,
    book_id         INTEGER,
    chapter_num     INTEGER,
    summary_text    TEXT,
    summary_method  TEXT DEFAULT 'contextual',
    key_verses_json TEXT,
    top_topics_json TEXT
  );
`);

// ── Config ───────────────────────────────────────────────────────────────────
const DIMS          = 384;
const MAX_INPUT_LEN = 900;  // chars per summarizer chunk (safe under 1024 tokens)
const DB_BATCH      = 50;   // rows per SQLite transaction (chapters are heavy)

// ── Helpers ───────────────────────────────────────────────────────────────────
function blobToFloat32(blob) {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function l2norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function cosine(a, b) {
  return dot(a, b) / (l2norm(a) * l2norm(b) + 1e-9);
}

/** Centroid of a list of Float32Arrays */
function centroid(vecs) {
  const c = new Float32Array(DIMS);
  for (const v of vecs) for (let i = 0; i < DIMS; i++) c[i] += v[i];
  for (let i = 0; i < DIMS; i++) c[i] /= vecs.length;
  return c;
}

/**
 * Chunk long text into segments of at most maxLen chars, splitting on sentence
 * boundaries where possible.
 */
function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > maxLen && cur.length > 0) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += s + ' ';
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

function formatEta(ms) {
  if (!isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60), ss = s % 60;
  if (m < 60)  return `${m}m${ss}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function decodeHtmlEntities(s = '') {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function clipWords(text, maxWords = 10) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, maxWords).join(' ');
}

function dominantPovLabel(povCounts) {
  if (!povCounts.size) return 'historical narrative';
  return [...povCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function fetchChapterDescription(volumeSlug, bookSlug, chapterNum) {
  if (!volumeSlug || !bookSlug || !chapterNum) return null;
  const url = `https://www.churchofjesuschrist.org/study/scriptures/${volumeSlug}/${bookSlug}/${chapterNum}?lang=eng`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const html = await res.text();
    const m1 = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
    const m2 = html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
    return decodeHtmlEntities((m1 || m2)?.[1] || '').trim() || null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildContextualSummary(chap, chapterDesc, keyVerses, topTopics, povCounts) {
  const topicLabels = topTopics.map(t => t.label).slice(0, 3);
  const topicsText = topicLabels.length ? topicLabels.join(', ') : 'core covenant themes';
  const pov = dominantPovLabel(povCounts);
  const heading = chapterDesc || `${chap.book_title} ${chap.chapter_num} presents teachings and events central to this part of scripture.`;
  const kvRefs = keyVerses.length
    ? keyVerses.map(k => `${chap.book_title} ${chap.chapter_num}:${k.verse_number}`).join(', ')
    : `${chap.book_title} ${chap.chapter_num}`;
  const kvSnippet = clipWords(keyVerses[0]?.text || '', 12);

  const p1 = [
    `${chap.book_title} ${chap.chapter_num} opens with this chapter focus: ${heading}.`,
    `Across ${chap.verses.length} verses, the passage develops its message with a clear scriptural progression from opening statements to concluding emphasis.`,
    `Major doctrinal threads in this chapter include ${topicsText}.`,
    `The overall voice is best described as ${pov}, which shapes how the chapter teaches and testifies.`,
    `Taken together, the chapter establishes a foundation for understanding the surrounding chapters and their covenant context.`
  ].join(' ');

  const p2 = [
    `Key verses such as ${kvRefs} anchor the chapter's central teachings and narrative movement.`,
    `${kvSnippet ? `One representative line begins, "${kvSnippet}..." and highlights the chapter's main direction.` : 'Its strongest verses repeatedly reinforce the chapter’s main direction and purpose.'}`,
    `These verses connect doctrine to lived discipleship by pairing truth claims with action, obedience, and spiritual response.`,
    `For modern readers, the chapter invites study, repentance, trust in the Lord, and practical faithfulness in daily life.`,
    `Overall, this chapter contributes to the broader witness of Jesus Christ and the work of God's covenant people.`
  ].join(' ');

  return `${p1}\n\n${p2}`;
}

const ins = db_tags.prepare(`
  INSERT OR REPLACE INTO chapter_summaries
    (chapter_id, book_id, chapter_num, summary_text, summary_method, key_verses_json, top_topics_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const batchInsert = db_tags.transaction(items => {
  for (const r of items) ins.run(r.chapter_id, r.book_id, r.chapter_num, r.summary_text, r.summary_method, r.key_verses_json, r.top_topics_json);
});

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let summarizer = null;
  if (ABSTRACTIVE) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.backends.onnx.wasm.numThreads = Math.max(1, os.cpus().length);
    console.log('Loading distilbart-cnn-6-6 (abstractive — this will be slow on CPU)…');
    summarizer = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
    console.log('Summarizer ready.');
  } else {
    console.log(CONTEXTUAL
      ? 'Contextual mode (web chapter descriptions + chapter signals). Use --extractive for local-only summaries.'
      : 'Extractive mode (fast, local). Use --abstractive for model prose summaries.');
  }

  // Load verse embeddings
  console.log('Loading verse embeddings…');
  const embMap = new Map();
  for (const row of db_emb.prepare('SELECT verse_id, embedding FROM verse_embeddings').all()) {
    embMap.set(row.verse_id, blobToFloat32(row.embedding));
  }
  console.log(`  ${embMap.size} verse embeddings loaded.`);

  // Load all chapters with their verses
  const chapRows = db.prepare(`
      SELECT c.id AS chapter_id, c.book_id, c.chapter_number AS chapter_num,
           b.book_title, b.book_lds_url AS book_slug, vol.volume_lds_url AS volume_slug,
           v.id AS verse_id, v.verse_number, v.scripture_text
    FROM chapters c
    JOIN volumes vol ON vol.id = (
      SELECT b2.volume_id FROM books b2 WHERE b2.id = c.book_id
    )
    JOIN books b ON b.id = c.book_id
    JOIN verses v ON v.chapter_id = c.id
    ORDER BY c.id, v.verse_number
  `).all();

  const chapMap = new Map();
  for (const row of chapRows) {
    if (!chapMap.has(row.chapter_id)) {
      chapMap.set(row.chapter_id, {
        chapter_id: row.chapter_id,
        book_id: row.book_id,
        chapter_num: row.chapter_num,
        book_title: row.book_title,
        book_slug: row.book_slug,
        volume_slug: row.volume_slug,
        verses: []
      });
    }
    chapMap.get(row.chapter_id).verses.push({ verse_id: row.verse_id, verse_number: row.verse_number, scripture_text: row.scripture_text });
  }
  const allChapters = [...chapMap.values()];
  console.log(`  ${allChapters.length} chapters loaded.`);

  // Load pre-baked doctrine tags for top-topics aggregation
  const tagsMap = new Map();
  try {
    for (const r of db_tags.prepare('SELECT verse_id, pov, labels_json FROM verse_doctrine_tags').all()) {
      tagsMap.set(r.verse_id, { labels: JSON.parse(r.labels_json || '[]'), pov: r.pov || null });
    }
    console.log(`  ${tagsMap.size} doctrine tag rows loaded.`);
  } catch (_) {
    console.log('  No doctrine tags yet — top_topics will be empty (run compute-tags.js first).');
  }

  // Filter already-done — if --resume, skip only chapters already abstractively summarized
  const already = new Set(
    db_tags.prepare(
      RESUME_ABSTRACTIVE
        ? "SELECT chapter_id FROM chapter_summaries WHERE summary_method = 'abstractive'"
        : 'SELECT chapter_id FROM chapter_summaries'
    ).all().map(r => r.chapter_id)
  );
  const chapters = allChapters.filter(c => !already.has(c.chapter_id));
  const total    = allChapters.length;
  if (RESUME_ABSTRACTIVE) console.log(`Resume mode: upgrading ${chapters.length} extractive chapters to abstractive…\n`);
  else console.log(`\nProcessing ${chapters.length} chapters (${already.size} already done)…\n`);

  let done = 0, dbBuf = [];
  const startMs = Date.now();

  for (const chap of chapters) {
    // ── Extractive key verses (centroid) ─────────────────────────────────
    const verseVecs = chap.verses.map(v => ({ v, emb: embMap.get(v.verse_id) })).filter(x => x.emb);
    let keyVerses = [];
    if (verseVecs.length > 0) {
      const c = centroid(verseVecs.map(x => x.emb));
      keyVerses = verseVecs
        .map(x => ({ verse_id: x.v.verse_id, verse_number: x.v.verse_number, text: x.v.scripture_text, score: cosine(c, x.emb) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }
    const keyVersesJson = JSON.stringify(keyVerses.map(s => ({ verse_id: s.verse_id, verse_number: s.verse_number, text: s.text })));

    // ── Top topics from doctrine tags ─────────────────────────────────────
    const topicScores = new Map();
    const povCounts   = new Map();
    for (const v of chap.verses) {
      const tag = tagsMap.get(v.verse_id);
      for (const t of (tag?.labels || [])) {
        topicScores.set(t.label, (topicScores.get(t.label) || 0) + t.score);
      }
      if (tag?.pov) povCounts.set(tag.pov, (povCounts.get(tag.pov) || 0) + 1);
    }
    const topTopics = [...topicScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, score]) => ({ label, score: +score.toFixed(3) }));
    const topTopicsJson = JSON.stringify(topTopics);

    // ── Summary text ──────────────────────────────────────────────────────
    let summaryText;
    if (summarizer) {
      // Abstractive (slow, --abstractive flag)
      const fullText = chap.verses.map(v => v.scripture_text).join(' ');
      const chunks   = chunkText(fullText, 900);
      if (chunks.length === 1) {
        summaryText = (await summarizer(chunks[0], { max_new_tokens: 60, min_length: 20 }))[0].summary_text.trim();
      } else {
        const parts = await Promise.all(chunks.map(ch => summarizer(ch, { max_new_tokens: 40, min_length: 10 })));
        const combined = parts.map(r => r[0].summary_text).join(' ');
        summaryText = (await summarizer(chunkText(combined, 900)[0], { max_new_tokens: 60, min_length: 20 }))[0].summary_text.trim();
      }
    } else {
      if (CONTEXTUAL) {
        const chapterDesc = await fetchChapterDescription(chap.volume_slug, chap.book_slug, chap.chapter_num);
        summaryText = buildContextualSummary(chap, chapterDesc, keyVerses, topTopics, povCounts);
      } else {
        // Extractive: join top-3 central verses as the summary
        summaryText = keyVerses.map(k => k.text).join(' ');
      }
    }

    dbBuf.push({
      chapter_id: chap.chapter_id,
      book_id: chap.book_id,
      chapter_num: chap.chapter_num,
      summary_text: summaryText,
      summary_method: summarizer ? 'abstractive' : (CONTEXTUAL ? 'contextual' : 'extractive'),
      key_verses_json: keyVersesJson,
      top_topics_json: topTopicsJson
    });
    done++;

    if (dbBuf.length >= DB_BATCH) batchInsert(dbBuf.splice(0, DB_BATCH));

    const elapsed = Date.now() - startMs;
    const eta     = (chapters.length - done) / (done / elapsed);
    process.stdout.write(`\r${already.size + done}/${total}  ${chap.book_title} ${chap.chapter_num}  ETA: ${formatEta(eta)}    `);
  }

  if (dbBuf.length) batchInsert(dbBuf);
  console.log(`\nDone. ${done} chapters summarized (${total} total).`);
  db.close(); db_emb.close(); db_tags.close();
}

main().catch(err => { console.error(err); process.exit(1); });
