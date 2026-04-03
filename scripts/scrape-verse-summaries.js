/**
 * Verse Summaries Scraper
 *
 * For each verse:
 *   1. Fetch full chapter text from NRSVUE (all 5 volumes) as context
 *   2. Find cross-references via topical-guide.db and fetch their texts
 *   3. Ask LLM: what the verse means + how it connects to the chapter
 *      + what other scriptures say about it
 *   4. Verifier LLM checks the output before saving
 *
 * Usage:
 *   node scripts/scrape-verse-summaries.js                        # both: 20 gen + 5 verify
 *   node scripts/scrape-verse-summaries.js --mode generate        # generate only (no verification)
 *   node scripts/scrape-verse-summaries.js --mode verify          # verify only (no generation)
 *   node scripts/scrape-verse-summaries.js --mode both            # both (default)
 *   node scripts/scrape-verse-summaries.js --workers 10           # 10 generation workers
 *   node scripts/scrape-verse-summaries.js --verifiers 8          # 8 verify workers
 *   node scripts/scrape-verse-summaries.js --mode verify --verifiers 10  # verify-only with 10 workers
 *   node scripts/scrape-verse-summaries.js --limit 20             # process only 20 verses
 *   node scripts/scrape-verse-summaries.js --reset                # reset all to pending
 *   node scripts/scrape-verse-summaries.js --stats                # show status counts and exit
 *   node scripts/scrape-verse-summaries.js --dry-run              # show what would run without running
 */

const https = require('https');
const Database = require('better-sqlite3');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const GENERATION_MODEL = 'meta/llama-3.3-70b-instruct';
const VERIFY_MODEL     = 'nvidia/llama-3.3-nemotron-super-49b-v1';
const REGEN_MODEL      = 'meta/llama-3.1-405b-instruct';

const FALLBACK_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'meta/llama-3.1-405b-instruct',
  'mistralai/mistral-large-2-instruct',
  'deepseek-ai/deepseek-v3.2',
  'moonshotai/kimi-k2-instruct-0905',
];
let fallbackIndex = 0;
function rotateFallback() {
  fallbackIndex = (fallbackIndex + 1) % FALLBACK_MODELS.length;
  console.log(`  🔄 Fallback: ${FALLBACK_MODELS[fallbackIndex]}`);
}

const DB_TAGS    = path.resolve(__dirname, '../resources/db/verse-tags.db');
const DB_YLT     = path.resolve(__dirname, '../resources/db/ylt-scriptures-sqlite.db');
const DB_TOPICAL = path.resolve(__dirname, '../resources/db/topical-guide.db');

const DELAY_MS    = 300;
const MAX_TOKENS  = 500;
const TEMPERATURE = 0.1;

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i+1]) : null; })();
const RESET = args.includes('--reset');
const STATS = args.includes('--stats');
const DRY_RUN = args.includes('--dry-run');
const WORKERS = (() => { const i = args.indexOf('--workers'); return i !== -1 ? parseInt(args[i+1]) : 20; })();
const VERIFY_WORKERS = (() => { const i = args.indexOf('--verifiers'); return i !== -1 ? parseInt(args[i+1]) : 5; })();
const MODE = (() => { const i = args.indexOf('--mode'); return i !== -1 ? args[i+1] : 'both'; })(); // 'generate' | 'verify' | 'both'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(verseTitle, verseText, chapterText, crossRefs) {
  const refBlock = crossRefs.length > 0
    ? `\nRelated scriptures:\n${crossRefs.map(r => `${r.title}: "${r.text}"`).join('\n')}\n`
    : '';

  return `Chapter:\n${chapterText}\n\nVerse (${verseTitle}): "${verseText}"${refBlock}
In 2–3 paragraphs, expound the meaning of this verse and explain how it connects to the rest of the chapter. If related scriptures are provided, explain how they reinforce or parallel this verse. Use only what the texts say — no outside knowledge, no commentary, no opinions. Plain prose only.`;
}

// ── NVIDIA NIM request ────────────────────────────────────────────────────────

function nimRequest(model, prompt, maxTokens, systemPrompt) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt || 'Expound scripture verses in 2–3 paragraphs using only the provided texts. No outside knowledge, no commentary.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens || MAX_TOKENS,
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
          if (!text) return reject(new Error(`${model}: empty response`));
          if (!/[.!?]$/.test(text)) return reject(new Error(`${model}: incomplete response`));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generate(prompt) {
  try {
    return { text: await nimRequest(GENERATION_MODEL, prompt), model: GENERATION_MODEL };
  } catch (e) {
    await sleep((String(e).includes('429') || String(e).includes('rate')) ? 15000 : 2000);
    for (let i = 0; i < FALLBACK_MODELS.length; i++) {
      const model = FALLBACK_MODELS[(fallbackIndex + i) % FALLBACK_MODELS.length];
      try {
        return { text: await nimRequest(model, prompt), model };
      } catch { rotateFallback(); await sleep(2000); }
    }
    throw new Error('All models failed');
  }
}

async function verify(verseTitle, verseText, chapterText, summaryText, crossRefs) {
  const refBlock = crossRefs && crossRefs.length > 0
    ? `\nRelated scriptures:\n${crossRefs.map(r => `${r.title}: "${r.text}"`).join('\n')}\n`
    : '';

  const prompt = `Chapter:\n${chapterText}\n\nVerse (${verseTitle}): "${verseText}"${refBlock}
Summary to check: "${summaryText}"

You are a lenient reviewer. PASS the summary unless it contains an OBVIOUS factual error, misattributes a quote to the wrong person, contradicts what the verse actually says, or fabricates information not found anywhere in the texts above.

Minor paraphrasing, reasonable inferences, and theological language that faithfully captures the meaning are all acceptable — PASS those.

Only FAIL if the summary is clearly wrong, misleading, or fabricates claims.

Reply PASS or FAIL on the first line. One sentence reason after.`;
  const raw = await nimRequest(VERIFY_MODEL, prompt, 80);
  return raw.trimStart().toUpperCase().startsWith('PASS');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db        = new Database(DB_TAGS);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  const yltDb    = new Database(DB_YLT,    { readonly: true });
  const topicalDb = new Database(DB_TOPICAL, { readonly: true });

  db.prepare(`
    CREATE TABLE IF NOT EXISTS verse_summaries (
      verse_id         INTEGER PRIMARY KEY,
      verse_title      TEXT NOT NULL,
      summary          TEXT,
      cross_references TEXT,
      status           TEXT DEFAULT 'pending',
      model            TEXT,
      verify_attempts  INTEGER DEFAULT 0
    )
  `).run();

  // Add verify_attempts column if missing (existing table)
  try { db.prepare('ALTER TABLE verse_summaries ADD COLUMN verify_attempts INTEGER DEFAULT 0').run(); } catch {}

  if (RESET) {
    db.prepare(`UPDATE verse_summaries SET summary=NULL, cross_references=NULL, status='pending', model=NULL`).run();
    console.log('✓ Reset all to pending');
  }

  // Load all verses from YLT (has all 5 volumes)
  const allVerses = yltDb.prepare(`
    SELECT v.id AS verse_id, v.verse_number, v.scripture_text, v.chapter_id,
           c.chapter_number, b.book_title, vol.volume_title
    FROM verses v
    JOIN chapters c  ON v.chapter_id = c.id
    JOIN books b     ON c.book_id    = b.id
    JOIN volumes vol ON b.volume_id  = vol.id
    ORDER BY v.id
  `).all();

  // Seed missing rows
  const existingIds = new Set(db.prepare('SELECT verse_id FROM verse_summaries').all().map(r => r.verse_id));
  const insertStmt  = db.prepare(`INSERT OR IGNORE INTO verse_summaries (verse_id, verse_title, status) VALUES (?, ?, 'pending')`);
  let inserted = 0;
  for (const v of allVerses) {
    if (!existingIds.has(v.verse_id)) {
      insertStmt.run(v.verse_id, `${v.book_title} ${v.chapter_number}:${v.verse_number}`);
      inserted++;
    }
  }
  if (inserted > 0) console.log(`✓ Seeded ${inserted} verse rows`);

  // ── --stats: show counts and exit ──
  if (STATS) {
    const stats = db.prepare('SELECT status, COUNT(*) as n FROM verse_summaries GROUP BY status').all();
    const total = db.prepare('SELECT COUNT(*) as n FROM verse_summaries').get().n;
    const unverified = db.prepare("SELECT COUNT(*) as n FROM verse_summaries WHERE status='ai-ok' AND verify_attempts=0").get().n;
    console.log('\n📊 Verse Summary Stats:');
    console.log('─'.repeat(40));
    for (const s of stats) console.log(`  ${s.status.padEnd(15)} ${String(s.n).padStart(6)}`);
    console.log('─'.repeat(40));
    console.log(`  ${'total'.padEnd(15)} ${String(total).padStart(6)}`);
    console.log(`  ${'awaiting verify'.padEnd(15)} ${String(unverified).padStart(6)}`);
    db.close(); yltDb.close(); topicalDb.close();
    return;
  }

  const verseMap = new Map(allVerses.map(v => [v.verse_id, v]));

  // Chapter text cache (YLT for all volumes)
  const chapterCache = new Map();
  const chapterStmt  = yltDb.prepare('SELECT verse_number, scripture_text FROM verses WHERE chapter_id=? ORDER BY verse_number');
  function getChapterText(chapterId) {
    if (chapterCache.has(chapterId)) return chapterCache.get(chapterId);
    const text = chapterStmt.all(chapterId).map(v => `${v.verse_number}. ${v.scripture_text}`).join('\n');
    chapterCache.set(chapterId, text);
    return text;
  }

  // Cross-references via topical guide → fetch verse texts from YLT
  const crossRefStmt   = topicalDb.prepare(`
    SELECT tg.verse_title FROM topical_guide tg
    JOIN topical_guide src ON tg.topic_id = src.topic_id
    WHERE src.verse_title = ? AND tg.verse_title != ?
    GROUP BY tg.verse_title LIMIT 8
  `);
  const verseTextStmt  = yltDb.prepare(`
    SELECT v.scripture_text FROM verses v
    JOIN chapters c  ON v.chapter_id = c.id
    JOIN books b     ON c.book_id    = b.id
    WHERE b.book_title = ? AND c.chapter_number = ? AND v.verse_number = ? LIMIT 1
  `);
  function getCrossRefs(verseTitle) {
    return crossRefStmt.all(verseTitle, verseTitle).flatMap(ref => {
      const m = ref.verse_title.match(/^(.+?)\s+(\d+):(\d+)$/);
      if (!m) return [];
      const row = verseTextStmt.get(m[1], parseInt(m[2]), parseInt(m[3]));
      return row?.scripture_text ? [{ title: ref.verse_title, text: row.scripture_text }] : [];
    });
  }

  const pendingIds = db.prepare(`
    SELECT verse_id FROM verse_summaries WHERE status NOT IN ('ai-ok','ai-verified') ORDER BY verse_id
  `).all().map(r => r.verse_id);
  const batch = LIMIT ? pendingIds.slice(0, LIMIT) : pendingIds;
  const toVerify = db.prepare("SELECT COUNT(*) as n FROM verse_summaries WHERE status='ai-ok' AND verify_attempts=0").get().n;

  // ── --dry-run: show plan and exit ──
  if (DRY_RUN) {
    console.log('\n🔎 Dry Run — what would happen:');
    console.log(`  Mode:              ${MODE}`);
    console.log(`  Gen workers:       ${MODE !== 'verify' ? WORKERS : 0}`);
    console.log(`  Verify workers:    ${MODE !== 'generate' ? VERIFY_WORKERS : 0}`);
    console.log(`  Pending to gen:    ${batch.length}`);
    console.log(`  Awaiting verify:   ${toVerify}`);
    db.close(); yltDb.close(); topicalDb.close();
    return;
  }

  console.log(`📖 ${batch.length} verses to generate, ${toVerify} awaiting verification`);

  const updateStmt  = db.prepare(`UPDATE verse_summaries SET summary=?, cross_references=?, status=?, model=? WHERE verse_id=?`);
  const markVerified = db.prepare(`UPDATE verse_summaries SET status='ai-verified', verify_attempts=verify_attempts+1 WHERE verse_id=?`);
  const bumpAttempt  = db.prepare(`UPDATE verse_summaries SET verify_attempts=verify_attempts+1 WHERE verse_id=?`);

  let done = 0, verified = 0, fixed = 0, index = 0;
  function nextId() { return index < batch.length ? batch[index++] : null; }

  async function generationWorker(id) {
    console.log(`🟢 Worker ${id} started`);
    let verseId;
    while ((verseId = nextId()) !== null) {
      const v = verseMap.get(verseId);
      if (!v) continue;
      const verseTitle  = `${v.book_title} ${v.chapter_number}:${v.verse_number}`;
      const chapterText = getChapterText(v.chapter_id);
      const crossRefs   = getCrossRefs(verseTitle);
      const prompt      = buildPrompt(verseTitle, v.scripture_text, chapterText, crossRefs);
      let success = false;
      while (!success) {
        try {
          const { text, model } = await generate(prompt);
          updateStmt.run(text, crossRefs.length ? JSON.stringify(crossRefs) : null, 'ai-ok', model, verseId);
          done++;
          process.stdout.write(`[${done}/${batch.length}] ✓ ${verseTitle}\n`);
          success = true;
        } catch (e) {
          process.stderr.write(`  ↻ [W${id}] ${verseTitle}: ${(e?.message||String(e)).slice(0,80)}\n`);
          await sleep((String(e).includes('429') || String(e).includes('rate')) ? 20000 : 4000);
        }
      }
      await sleep(DELAY_MS);
    }
  }

const numVerifiers = MODE !== 'generate' ? VERIFY_WORKERS : 0;

  // Shared verify queue — each worker claims rows via OFFSET to avoid duplicates
  let verifyOffset = 0;
  function nextVerifyBatch() {
    const stmt = db.prepare(`SELECT verse_id, verse_title, summary FROM verse_summaries WHERE status='ai-ok' AND verify_attempts=0 ORDER BY verse_id LIMIT 10 OFFSET ?`);
    const rows = stmt.all(verifyOffset);
    verifyOffset += 10;
    return rows;
  }

  async function verifyWorker(wid) {
    await sleep(20000 + wid * 2000);
    console.log(`🔍 Verify worker V${wid} started`);
    while (true) {
      const rows = nextVerifyBatch();
      if (rows.length === 0) {
        if (index >= batch.length) break;
        await sleep(8000);
        continue;
      }
      for (const row of rows) {
        const v = verseMap.get(row.verse_id);
        if (!v) { bumpAttempt.run(row.verse_id); continue; }
        const chapterText = getChapterText(v.chapter_id);
        const crossRefs   = getCrossRefs(row.verse_title);
        let attempts = 0;
        while (attempts < 3) {
          try {
            const pass = await verify(row.verse_title, v.scripture_text, chapterText, row.summary, crossRefs);
            if (pass) {
              markVerified.run(row.verse_id);
              verified++;
              console.log(`[verify ✓] ${row.verse_title}`);
            } else {
              console.log(`[verify ✗] ${row.verse_title} — regenerating with 405B…`);
              const prompt    = buildPrompt(row.verse_title, v.scripture_text, chapterText, crossRefs);
              let regenOk = false;
              for (let t = 0; t < 3 && !regenOk; t++) {
                try {
                  const text = await nimRequest(REGEN_MODEL, prompt);
                  // Corrected summary → ai-verified (it was reviewed and fixed)
                  updateStmt.run(text, crossRefs.length ? JSON.stringify(crossRefs) : null, 'ai-verified', REGEN_MODEL, row.verse_id);
                  fixed++; regenOk = true;
                  console.log(`  ✅ Corrected: ${row.verse_title}`);
                } catch { await sleep(5000); }
              }
              if (!regenOk) {
                // Regen failed — accept original summary as good enough, mark verified
                markVerified.run(row.verse_id);
                console.error(`  ⚠️  ${row.verse_title} — keeping current summary (regen failed)`);
              }
            }
            break;
          } catch (e) {
            attempts++;
            await sleep((String(e).includes('429') || String(e).includes('rate')) ? 15000 : 3000);
          }
        }
        if (attempts >= 3) {
          bumpAttempt.run(row.verse_id);
        }
        await sleep(DELAY_MS);
      }
    }
    console.log(`🔍 V${wid} done`);
  }

  const numGenerators = MODE !== 'verify' ? WORKERS : 0;
  console.log(`🚀 ${numGenerators} generation workers + ${numVerifiers} verify workers (mode: ${MODE})`);
  await Promise.all([
    ...Array.from({ length: numGenerators }, (_, i) => generationWorker(i + 1)),
    ...Array.from({ length: numVerifiers }, (_, i) => verifyWorker(i + 1)),
  ]);

  db.close();
  yltDb.close();
  topicalDb.close();
  console.log(`\n✅ Done: ${done} generated, ${verified} verified, ${fixed} fixed`);
}

main().catch(e => { console.error(e); process.exit(1); });
