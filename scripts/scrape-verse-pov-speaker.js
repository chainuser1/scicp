/**
 * Verse POV & Speaker Scraper
 *
 * For each chapter, sends the full chapter text to AI and asks it to identify
 * the POV and speaker for every verse. Updates verse_doctrine_tags.
 *
 * POV values: "spoken by God", "spoken by a prophet", "historical narrative",
 *             "prayer or praise", "poetic/wisdom", "dialogue", "epistle"
 *
 * Usage:
 *   node scripts/scrape-verse-pov-speaker.js
 *   node scripts/scrape-verse-pov-speaker.js --limit 20
 *   node scripts/scrape-verse-pov-speaker.js --reset
 *   node scripts/scrape-verse-pov-speaker.js --workers 8
 */

const https = require('https');
const Database = require('better-sqlite3');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const MODELS = [
  'meta/llama-3.1-405b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'moonshotai/kimi-k2-instruct-0905',
];
let modelIdx = 0;
function nextModel() { return MODELS[modelIdx++ % MODELS.length]; }

const DB_TAGS   = path.resolve(__dirname, '../resources/db/verse-tags.db');
const DB_NRSVUE = path.resolve(__dirname, '../resources/db/nrsvue-scriptures-sqlite.db');

const DELAY_MS    = 600;
const MAX_TOKENS  = 4096;
const TEMPERATURE = 0.05;
const CHUNK_SIZE  = 40; // max verses per LLM request

const args = process.argv.slice(2);
const LIMIT   = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i + 1]) : null; })();
const RESET   = args.includes('--reset');
const WORKERS = (() => { const i = args.indexOf('--workers'); return i !== -1 ? parseInt(args[i + 1]) : 6; })();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const POV_VALUES = [
  'spoken by God',
  'spoken by a prophet',
  'historical narrative',
  'prayer or praise',
  'poetic/wisdom',
  'dialogue',
  'epistle',
];

function buildPrompt(bookTitle, chapterNum, verses) {
  const verseBlock = verses.map(v => `${v.verse_number}. ${v.scripture_text}`).join('\n');
  return `Book: ${bookTitle}, Chapter ${chapterNum}

${verseBlock}

For each verse above, identify:
1. POV — one of: ${POV_VALUES.join(', ')}
2. Speaker — the person speaking or narrating (e.g. "Moses (narrator)", "The Lord (Jehovah)", "Paul", "David")

Reply as JSON array, one object per verse:
[{"v":1,"pov":"historical narrative","speaker":"Moses (narrator)"},{"v":2,...},...]

Rules:
- Use ONLY the text above to determine POV and speaker. Do not add outside knowledge.
- If God/the Lord is directly speaking, POV is "spoken by God".
- If a prophet is speaking or writing, POV is "spoken by a prophet".
- If it's a psalm, hymn, or prayer, POV is "prayer or praise".
- If it's wisdom literature (Proverbs, Ecclesiastes), POV is "poetic/wisdom".
- If it's a letter/epistle (Paul's letters, etc.), POV is "epistle".
- If someone other than the narrator is quoted in dialogue, POV is "dialogue".
- Default to "historical narrative" if unclear.
- For speaker, use the actual name. If unknown, say "Unknown (narrator)".
- Return ONLY the JSON array, no other text.`;
}

function nimRequest(prompt, model) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: 'You identify the point of view and speaker for each verse in a scripture chapter. Reply with JSON only.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: MAX_TOKENS,
    stream: false,
    temperature: TEMPERATURE,
    top_p: 1,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'integrate.api.nvidia.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          const text = json.choices?.[0]?.message?.content?.trim();
          if (!text) return reject(new Error('empty response'));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseResponse(text, verseCount) {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array found');
  cleaned = cleaned.slice(start, end + 1);

  // Fix common LLM JSON issues
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');           // trailing commas
  cleaned = cleaned.replace(/\{(\s*)(\w+)\s*:/g, '{$1"$2":'); // unquoted keys after {
  cleaned = cleaned.replace(/,(\s*)(\w+)\s*:/g, ',$1"$2":');  // unquoted keys after ,

  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) throw new Error('Not an array');
    return arr;
  } catch (firstErr) {
    // Fallback: extract individual objects
    const objects = [];
    const regex = /\{[^{}]+\}/g;
    let m;
    while ((m = regex.exec(cleaned)) !== null) {
      try {
        let s = m[0].replace(/,\s*\}/g, '}')
          .replace(/\{(\s*)(\w+)\s*:/g, '{$1"$2":')
          .replace(/,(\s*)(\w+)\s*:/g, ',$1"$2":');
        objects.push(JSON.parse(s));
      } catch {}
    }
    if (objects.length > 0) return objects;
    throw firstErr;
  }
}

async function main() {
  const db       = new Database(DB_TAGS);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  const nrsvueDb = new Database(DB_NRSVUE, { readonly: true });

  if (RESET) {
    db.prepare("UPDATE verse_doctrine_tags SET pov = NULL, speaker = NULL").run();
    console.log('✓ Reset all POV and speaker to NULL');
  }

  // Get all chapters
  const chapters = nrsvueDb.prepare(`
    SELECT c.id AS chapter_id, c.chapter_number, b.book_title, vol.volume_title
    FROM chapters c
    JOIN books b     ON c.book_id   = b.id
    JOIN volumes vol ON b.volume_id = vol.id
    ORDER BY c.id
  `).all();

  // Find chapters that need processing (have verses with NULL pov)
  const needsProcessing = db.prepare(`
    SELECT DISTINCT chapter_id FROM verse_doctrine_tags
    WHERE pov IS NULL OR pov = ''
  `).all().map(r => r.chapter_id);
  const needsSet = new Set(needsProcessing);

  const pending = chapters.filter(ch => needsSet.has(ch.chapter_id));
  const batch = LIMIT ? pending.slice(0, LIMIT) : pending;
  console.log(`📖 ${batch.length} chapters to process (${needsProcessing.length} with NULL pov)`);

  const verseStmt  = nrsvueDb.prepare('SELECT id AS verse_id, verse_number, scripture_text FROM verses WHERE chapter_id = ? ORDER BY verse_number');
  const updateStmt = db.prepare('UPDATE verse_doctrine_tags SET pov = ?, speaker = ? WHERE verse_id = ?');

  let done = 0, index = 0;
  function nextChapter() { return index < batch.length ? batch[index++] : null; }

  // Process one chunk of verses with retries
  async function processChunk(id, ch, chunkVerses, chunkLabel) {
    let attempts = 0;
    while (attempts < 5) {
      const model = nextModel();
      try {
        const prompt = buildPrompt(ch.book_title, ch.chapter_number, chunkVerses);
        const raw = await nimRequest(prompt, model);
        const results = parseResponse(raw, chunkVerses.length);

        const resultMap = new Map();
        for (const r of results) {
          const vn = r.v || r.verse || r.verse_number;
          if (vn) resultMap.set(vn, r);
        }

        let updated = 0;
        for (const v of chunkVerses) {
          const r = resultMap.get(v.verse_number);
          if (r) {
            const pov = POV_VALUES.includes(r.pov) ? r.pov : 'historical narrative';
            const speaker = r.speaker || 'Unknown (narrator)';
            updateStmt.run(pov, speaker, v.verse_id);
            updated++;
          }
        }
        return updated;
      } catch (e) {
        attempts++;
        const msg = (e?.message || String(e)).slice(0, 80);
        process.stderr.write(`  ↻ [W${id}] ${ch.book_title} ${ch.chapter_number} ${chunkLabel}(${model.split('/').pop()}): ${msg}\n`);
        const wait = (String(e).includes('429') || String(e).includes('rate') || String(e).includes('empty')) ? 10000 : 3000;
        await sleep(wait);
      }
    }
    return -1; // all retries failed
  }

  async function worker(id) {
    console.log(`🟢 Worker ${id} started`);
    let ch;
    while ((ch = nextChapter()) !== null) {
      const verses = verseStmt.all(ch.chapter_id);
      if (!verses.length) continue;

      // Split into chunks for large chapters
      const chunks = [];
      for (let i = 0; i < verses.length; i += CHUNK_SIZE) {
        chunks.push(verses.slice(i, i + CHUNK_SIZE));
      }

      let totalUpdated = 0;
      let failed = false;
      for (let ci = 0; ci < chunks.length; ci++) {
        const label = chunks.length > 1 ? `[chunk ${ci + 1}/${chunks.length}] ` : '';
        const result = await processChunk(id, ch, chunks[ci], label);
        if (result === -1) {
          failed = true;
          break;
        }
        totalUpdated += result;
        if (ci < chunks.length - 1) await sleep(DELAY_MS);
      }

      if (failed) {
        console.error(`  ⚠️ Failed: ${ch.book_title} ${ch.chapter_number} (${verses.length} verses, ${chunks.length} chunks)`);
      } else {
        done++;
        process.stdout.write(`[${done}/${batch.length}] ✓ ${ch.book_title} ${ch.chapter_number} (${totalUpdated}/${verses.length} verses${chunks.length > 1 ? `, ${chunks.length} chunks` : ''})\n`);
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`🚀 ${WORKERS} workers`);
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));

  db.close();
  nrsvueDb.close();
  console.log(`\n✅ Done: ${done} chapters processed`);
}

main().catch(e => { console.error(e); process.exit(1); });
