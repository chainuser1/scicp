/**
 * Groq + OpenRouter AI Chapter Summaries Scraper (Hallucination-resistant version)
 *
 * Usage:
 *   node scripts/scrape-chapter-summaries.js
 *   node scripts/scrape-chapter-summaries.js --limit 10
 *   node scripts/scrape-chapter-summaries.js --reset
 */

const https = require('https');
const Database = require('better-sqlite3');
const path = require('path');
const { OpenRouter } = require('@openrouter/sdk');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const openrouter = new OpenRouter({ apiKey: OPENROUTER_API_KEY });
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// NVIDIA NIM models — large + fast, no thinking models
const NVIDIA_MODELS = [
  'moonshotai/kimi-k2-instruct-0905',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-405b-instruct',
  'meta/llama-4-scout-17b-16e-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'mistralai/mistral-large-2-instruct',
  'qwen/qwen3-next-80b-a3b-instruct',
  'google/gemma-3-27b-it',
];
let nvidiaModelIndex = 0;
function currentNvidiaModel() { return NVIDIA_MODELS[nvidiaModelIndex]; }
function rotateNvidiaModel() {
  nvidiaModelIndex = (nvidiaModelIndex + 1) % NVIDIA_MODELS.length;
  console.log(`  🔄 NVIDIA switched to: ${currentNvidiaModel()}`);
}
const GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];
let currentModelIndex = 0;
function currentModel() { return GROQ_MODELS[currentModelIndex]; }
function rotateModel() {
  currentModelIndex = (currentModelIndex + 1) % GROQ_MODELS.length;
  console.log(`  🔄 Groq switched to: ${currentModel()}`);
}

const DB_TAGS = path.resolve(__dirname, '../resources/db/chapter-summaries-fts.db');
const DB_SCRIPTURE = path.resolve(__dirname, '../resources/db/lds-scriptures-sqlite.db');
const DB_YLT = path.resolve(__dirname, '../resources/db/ylt-scriptures-sqlite.db');

const DELAY_MS = 1000;
const MAX_TOKENS = 400;

/*
Lower temperature = fewer hallucinations
*/
const TEMPERATURE = 0.2;

const TRIPLE_COMBINATION = new Set([
  'Book of Mormon',
  'Doctrine and Covenants',
  'Pearl of Great Price'
]);

const args = process.argv.slice(2);

const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1]) : null;
})();

const RESET = args.includes('--reset');

// Default 5 workers. Groq free tier: ~30 req/min across all workers.
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return i !== -1 ? Math.min(parseInt(args[i + 1]), 10) : 5;
})();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}


/**
 * Pure chapter summary prompt — no perspectives, no scholars, no interpretations.
 */
function buildPrompt(bookTitle, chapterNum, volumeTitle, verseText) {

  const textBlock = verseText
    ? `CHAPTER TEXT:\n"""\n${verseText}\n"""`
    : `CHAPTER: ${bookTitle} chapter ${chapterNum}`;

  return `${textBlock}

Write a 2–3 paragraph summary of the chapter text above.
- Summarize only what is in the text: who, what, and what happens or is said.
- Do not add any interpretation, perspective, doctrine, or outside knowledge.
- Do not mention scholars, churches, traditions, or any viewpoint.
- Plain prose only. No bullet points, no headers, no first-person.`;
}


function groqRequest(bookTitle, chapterNum, volumeTitle, verseText) {
  const prompt = buildPrompt(bookTitle, chapterNum, volumeTitle, verseText);

  const body = JSON.stringify({
    model: currentModel(),
    messages: [
      {
        role: 'system',
        content: 'You are a scripture summarizer. Summarize ONLY what is in the text provided. Never add facts, names, events, or quotes from memory or training data.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE
  });

  return new Promise((resolve, reject) => {

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {

      let data = '';

      res.on('data', d => data += d);

      res.on('end', () => {
        try {

          const json = JSON.parse(data);

          if (json.error) {
            return reject(new Error(json.error.message));
          }

          const text = json.choices?.[0]?.message?.content?.trim();

          if (!text) {
            return reject(new Error('Empty response'));
          }

          // Validate completeness — must end with a sentence-ending punctuation
          if (!/[.!?]$/.test(text)) {
            return reject(new Error('Incomplete response (does not end with punctuation)'));
          }

          resolve(text);

        } catch (e) {
          reject(e);
        }
      });

    });

    req.on('error', reject);

    req.write(body);
    req.end();
  });
}


// OpenRouter fallback — nvidia/nemotron-3-super-120b-a12b:free via SDK
async function openrouterRequest(bookTitle, chapterNum, volumeTitle, verseText) {
  const prompt = buildPrompt(bookTitle, chapterNum, volumeTitle, verseText);
  const response = await openrouter.chat.send({
    chatGenerationParams: {
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      messages: [
        { role: 'system', content: 'You are a scripture summarizer. Summarize ONLY what is in the text provided. Never add facts, names, events, or quotes from memory or training data.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE
    }
  });
  const text = response?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenRouter: empty response');
  if (!/[.!?]$/.test(text)) throw new Error('OpenRouter: incomplete response');
  return text;
}

// NVIDIA NIM API
function nvidiaRequest(bookTitle, chapterNum, volumeTitle, verseText) {
  const prompt = buildPrompt(bookTitle, chapterNum, volumeTitle, verseText);
  const body = JSON.stringify({
    model: currentNvidiaModel(),
    messages: [
      { role: 'system', content: 'You are a scripture summarizer. Summarize ONLY what is in the text provided. Never add facts, names, events, or quotes from memory or training data.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: MAX_TOKENS,
    stream: false,
    temperature: TEMPERATURE,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
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
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          const text = json.choices?.[0]?.message?.content?.trim();
          if (!text) return reject(new Error('NVIDIA: empty response'));
          if (!/[.!?]$/.test(text)) return reject(new Error('NVIDIA: incomplete response'));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {

  const db = new Database(DB_TAGS);
  const scriptureDb = new Database(DB_SCRIPTURE, { readonly: true });
  const yltDb = new Database(DB_YLT, { readonly: true });

  const BIBLE_VOLUMES = new Set(['Old Testament', 'New Testament']);

  if (RESET) {
    db.prepare(`
      UPDATE chapter_summaries
      SET summary_text=NULL,
          summary_method='pending',
          summary_model=NULL
    `).run();

    console.log('✓ Reset all to pending');
  }

  const pendingIds = new Set(
    db.prepare(`
      SELECT chapter_id
      FROM chapter_summaries
      WHERE summary_text IS NULL OR summary_text = '' OR summary_method != 'ai-ok'
      ORDER BY chapter_id
    `).all().map(r => r.chapter_id)
  );

  const allChapters = scriptureDb.prepare(`
    SELECT
      c.id as chapter_id,
      c.chapter_number,
      b.book_title,
      v.volume_title
    FROM chapters c
    JOIN books b ON c.book_id = b.id
    JOIN volumes v ON b.volume_id = v.id
    ORDER BY c.id
  `).all();

  // Verse text: use YLT for Bible (OT/NT), LDS DB for Triple Combination
  const verseStmtLds = scriptureDb.prepare(`
    SELECT verse_number, scripture_text FROM verses WHERE chapter_id=? ORDER BY verse_number
  `);
  const verseStmtYlt = yltDb.prepare(`
    SELECT verse_number, scripture_text FROM verses WHERE chapter_id=? ORDER BY verse_number
  `);
  function getVerseText(chapterId, volumeTitle) {
    const stmt = BIBLE_VOLUMES.has(volumeTitle) ? verseStmtYlt : verseStmtLds;
    const verses = stmt.all(chapterId);
    return verses.map(v => `${v.verse_number}. ${v.scripture_text}`).join('\n');
  }

  const todo = allChapters.filter(c => pendingIds.has(c.chapter_id));

  const batch = LIMIT ? todo.slice(0, LIMIT) : todo;

  console.log(`📖 ${batch.length} chapters to process (${todo.length} pending total)`);

  const updateStmt = db.prepare(`
    UPDATE chapter_summaries
    SET summary_text=?,
        summary_method=?,
        summary_model=?
    WHERE chapter_id=?
  `);

  let done = 0;
  let errors = 0; // kept for future use
  let index = 0;

  // Shared queue — all workers pull from the same batch
  function nextChapter() {
    return index < batch.length ? batch[index++] : null;
  }

  // Groq worker — tries all 3 Groq models before giving up on a chapter
  async function groqWorker() {
    let ch;
    while ((ch = nextChapter())) {
      const verseText = getVerseText(ch.chapter_id, ch.volume_title);
      let success = false;
      let attempts = 0;
      while (!success) {
        try {
          const summary = await groqRequest(ch.book_title, ch.chapter_number, ch.volume_title, verseText);
          const src = currentModel();
          updateStmt.run(summary, 'ai-ok', src, ch.chapter_id);
          done++;
          console.log(`[${done}/${batch.length}] ✓ ${ch.book_title} ${ch.chapter_number} (${src})`);
          success = true;
        } catch (e) {
          attempts++;
          console.error(`  ↻ Groq error on ${ch.book_title} ${ch.chapter_number}: ${(e?.message || String(e)).slice(0, 80)}`);
          rotateModel();
          const msg = e?.message || String(e);
          const waitMs = (msg.includes('429') || msg.includes('rate')) ? 15000 : 3000;
          await sleep(waitMs);
        }
      }
      await sleep(DELAY_MS);
    }
  }

  // NVIDIA NIM worker
  let nvidiaWorkerCount = 0;
  async function nvidiaWorker() {
    const id = ++nvidiaWorkerCount;
    console.log(`🟢 NVIDIA worker ${id} started (${currentNvidiaModel()})`);
    let ch;
    while ((ch = nextChapter())) {
      const verseText = getVerseText(ch.chapter_id, ch.volume_title);
      let success = false;
      while (!success) {
        try {
          const summary = await nvidiaRequest(ch.book_title, ch.chapter_number, ch.volume_title, verseText);
          updateStmt.run(summary, 'ai-ok', `nvidia/${currentNvidiaModel()}`, ch.chapter_id);
          done++;
          console.log(`[${done}/${batch.length}] ✓ ${ch.book_title} ${ch.chapter_number} (nvidia/${currentNvidiaModel()})`);
          success = true;
        } catch (e) {
          console.error(`  ↻ NVIDIA error on ${ch.book_title} ${ch.chapter_number}: ${(e?.message || String(e)).slice(0, 80)}`);
          rotateNvidiaModel();
          const msg = e?.message || String(e);
          const waitMs = (msg.includes('429') || msg.includes('rate')) ? 15000 : 3000;
          await sleep(waitMs);
        }
      }
      await sleep(DELAY_MS);
    }
  }

  // Nemotron 70B verification worker
  // Fetches ai-ok summaries that haven't been verified yet and checks
  // whether the summary faithfully reflects the actual chapter text.
  // PASS → sets summary_method = 'ai-verified'
  // FAIL → resets to pending so a generation worker regenerates it
  const VERIFY_MODEL   = 'nvidia/llama-3.3-nemotron-super-49b-v1';
  const REGEN_MODEL    = 'meta/llama-3.1-405b-instruct';
  let verified = 0;
  let rejected = 0;

  const verifyStmt = db.prepare(`
    SELECT chapter_id, book_id, chapter_num, summary_text, summary_model
    FROM chapter_summaries
    WHERE summary_method = 'ai-ok'
    ORDER BY chapter_id
  `);

  const markVerified = db.prepare(`
    UPDATE chapter_summaries SET summary_method='ai-verified' WHERE chapter_id=?
  `);
  const markFailed = db.prepare(`
    UPDATE chapter_summaries SET summary_text=NULL, summary_method='pending', summary_model=NULL WHERE chapter_id=?
  `);

  async function nemotronVerify(chapterId, bookTitle, chapterNum, summaryText, verseText) {
    const prompt = `CHAPTER TEXT:
"""
${verseText}
"""

SUMMARY TO CHECK:
"""
${summaryText}
"""

Does the summary contain ONLY information present in the chapter text above?
- Reply PASS if every claim in the summary is supported by the chapter text.
- Reply FAIL if the summary adds names, events, quotes, or details not found in the text.
- First line must be exactly "PASS" or "FAIL". Then one sentence explaining why.`;

    const body = JSON.stringify({
      model: VERIFY_MODEL,
      messages: [
        { role: 'system', content: 'You are a fact-checker. Compare the summary strictly against the provided text. Reply PASS or FAIL only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 120,
      stream: false,
      temperature: 0.1,
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
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
            const text = json.choices?.[0]?.message?.content?.trim();
            if (!text) return reject(new Error('Nemotron: empty response'));
            resolve(text);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async function verifyWorker() {
    const toVerify = verifyStmt.all();
    console.log(`🔍 Nemotron verifier: ${toVerify.length} ai-ok summaries to verify`);
    for (const row of toVerify) {
      const ch = scriptureDb.prepare(`
        SELECT c.chapter_number, b.book_title, v.volume_title
        FROM chapters c JOIN books b ON c.book_id = b.id JOIN volumes v ON b.volume_id = v.id
        WHERE c.id = ?
      `).get(row.chapter_id);
      if (!ch) continue;
      const verseText = getVerseText(row.chapter_id, ch.volume_title);
      let attempts = 0;
      while (attempts < 3) {
        try {
          const verdict = await nemotronVerify(row.chapter_id, ch.book_title, ch.chapter_number, row.summary_text, verseText);
          const pass = verdict.trimStart().toUpperCase().startsWith('PASS');
          if (pass) {
            markVerified.run(row.chapter_id);
            verified++;
            console.log(`[verify ✓] ${ch.book_title} ${ch.chapter_number} — PASS`);
          } else {
            const reason = verdict.split('\n')[1] || verdict.slice(0, 80);
            console.log(`[verify ✗] ${ch.book_title} ${ch.chapter_number} — FAIL: ${reason}`);
            // Regenerate using 405B (fast + most accurate on NIM)
            console.log(`  🔁 Regenerating ${ch.book_title} ${ch.chapter_number} with 405B...`);
            let regenSuccess = false;
            for (let t = 0; t < 3 && !regenSuccess; t++) {
              try {
                const prompt = buildPrompt(ch.book_title, ch.chapter_number, ch.volume_title, verseText);
                const body = JSON.stringify({
                  model: REGEN_MODEL,
                  messages: [
                    { role: 'system', content: 'You are a scripture summarizer. Summarize ONLY what is in the text provided. Never add facts, names, events, or quotes from memory or training data.' },
                    { role: 'user', content: prompt }
                  ],
                  max_tokens: MAX_TOKENS, stream: false, temperature: 0.05, top_p: 1,
                });
                const newSummary = await new Promise((resolve, reject) => {
                  const req = https.request({
                    hostname: 'integrate.api.nvidia.com', path: '/v1/chat/completions', method: 'POST',
                    headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                  }, res => {
                    let data = ''; res.on('data', d => data += d);
                    res.on('end', () => {
                      try {
                        const json = JSON.parse(data);
                        if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
                        const text = json.choices?.[0]?.message?.content?.trim();
                        if (!text) return reject(new Error('405B regen: empty'));
                        if (!/[.!?]$/.test(text)) return reject(new Error('405B regen: incomplete'));
                        resolve(text);
                      } catch (e) { reject(e); }
                    });
                  });
                  req.on('error', reject); req.write(body); req.end();
                });
                updateStmt.run(newSummary, 'ai-verified', REGEN_MODEL, row.chapter_id);
                rejected++;
                console.log(`  ✅ Regenerated: ${ch.book_title} ${ch.chapter_number} (405B)`);
                regenSuccess = true;
              } catch (re) {
                console.error(`  ↻ 405B regen error: ${(re?.message || String(re)).slice(0, 80)}`);
                await sleep(5000);
              }
            }
            if (!regenSuccess) {
              markFailed.run(row.chapter_id);
              console.error(`  ⚠️  405B regen failed for ${ch.book_title} ${ch.chapter_number} — reset to pending`);
            }
          }
          break;
        } catch (e) {
          attempts++;
          console.error(`  ↻ Nemotron verify error on ${ch.book_title} ${ch.chapter_number}: ${(e?.message || String(e)).slice(0, 80)}`);
          const waitMs = (String(e).includes('429') || String(e).includes('rate')) ? 15000 : 3000;
          await sleep(waitMs);
        }
      }
      await sleep(DELAY_MS);
    }
    console.log(`\n🔍 Verification done: ${verified} passed, ${rejected} rejected`);
  }

  // NVIDIA only — 6 NVIDIA workers + 1 Nemotron verifier.
  const GROQ_WORKERS = 0;
  const NVIDIA_WORKERS = 6;
  console.log(`🚀 Running with ${NVIDIA_WORKERS} NVIDIA workers + 1 Nemotron verifier`);
  await Promise.all([
    ...Array.from({ length: NVIDIA_WORKERS }, nvidiaWorker),
    verifyWorker(),
  ]);

  db.close();
  scriptureDb.close();
  yltDb.close();

  console.log(`\n✅ Done: ${done} generated, ${verified} verified, ${rejected} rejected → repending | ${errors} errors`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
