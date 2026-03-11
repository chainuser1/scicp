const fastify = require('fastify')({ logger: true });
const { Server } = require("socket.io");
const path = require('path');
const crypto = require('crypto');
const { BetterSqliteAdapter } = require('../shared/db-adapter');
const engine = require('../shared/scripture-engine');

const DB_DIR = process.env.DB_DIR || path.resolve(__dirname, '../resources/db');
const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST_DIR || path.resolve(__dirname, '../frontend/dist');
// Inside Electron the DBs live in the read-only ASAR archive — open them
// without journal/WAL writes so SQLite never attempts filesystem mutations.
const IS_ELECTRON_PKG = !!process.versions?.electron;
const DB_OPTS = { fileMustExist: true, readonly: IS_ELECTRON_PKG };
// english scriptures database (LDS standard works)
const db = require('better-sqlite3')(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), DB_OPTS);
// additional language databases (optional)
const db_tagalog = require('better-sqlite3')(path.join(DB_DIR, 'tagalog-scriptures-sqlite.db'),  DB_OPTS);
const db_cebuano = require('better-sqlite3')(path.join(DB_DIR, 'cebuano-scriptures-sqlite.db'),  DB_OPTS);
const db_spanish = require('better-sqlite3')(path.join(DB_DIR, 'spanish-scriptures-sqlite.db'),  DB_OPTS);
const db_greek   = require('better-sqlite3')(path.join(DB_DIR, 'greek-scriptures-sqlite.db'),    DB_OPTS);
const db_ilocano = require('better-sqlite3')(path.join(DB_DIR, 'ilocano-scriptures-sqlite.db'),  DB_OPTS);
// Optional language databases (loaded when DB file exists; gracefully absent during scraping)
let db_japanese = null;
try { db_japanese = require('better-sqlite3')(path.join(DB_DIR, 'japanese-scriptures-sqlite.db'), DB_OPTS); } catch (_) {}
let db_nrsvue = null;
try { db_nrsvue   = require('better-sqlite3')(path.join(DB_DIR, 'nrsvue-scriptures-sqlite.db'),   DB_OPTS); } catch (_) {}
let db_waray = null;
try { db_waray    = require('better-sqlite3')(path.join(DB_DIR, 'waray-scriptures-sqlite.db'),    DB_OPTS); } catch (_) {}

// Topical Guide DB (optional — built by scripts/scrape-topical-guide.js)
let db_tg = null;
try { db_tg = require('better-sqlite3')(path.join(DB_DIR, 'topical-guide.db'), { readonly: true, fileMustExist: true }); } catch (_) {}

// ── Wrapped adapters for the shared scripture engine ─────────────────────────
const dba          = new BetterSqliteAdapter(db);
const dba_tagalog  = new BetterSqliteAdapter(db_tagalog);
const dba_cebuano  = new BetterSqliteAdapter(db_cebuano);
const dba_spanish  = new BetterSqliteAdapter(db_spanish);
const dba_greek    = new BetterSqliteAdapter(db_greek);
const dba_ilocano  = new BetterSqliteAdapter(db_ilocano);
let dba_japanese   = db_japanese ? new BetterSqliteAdapter(db_japanese) : null;
let dba_nrsvue     = db_nrsvue   ? new BetterSqliteAdapter(db_nrsvue)   : null;
let dba_waray      = db_waray    ? new BetterSqliteAdapter(db_waray)    : null;

// Resolve the correct adapter for a given language code
function resolveDbAdapter(language) {
  switch (language) {
    case 'ceb':    return dba_cebuano;
    case 'tl':     return dba_tagalog;
    case 'es':     return dba_spanish;
    case 'el':     return dba_greek;
    case 'ilo':    return dba_ilocano;
    case 'ja':     return dba_japanese || dba;
    case 'nrsvue': return dba_nrsvue || dba;
    case 'war':    return dba_waray || dba;
    default:       return dba;
  }
}

const fastifyStatic = require('@fastify/static');

// ── Utility ───────────────────────────────────────────────────────────────────
const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');

fastify.register(require('@fastify/cors'), {
  origin: "*",
});

// Register static file serving for frontend distribution
fastify.register(fastifyStatic, {
  root: FRONTEND_DIST_DIR,
  prefix: '/',
});

// Handle client-side routing fallback for React Router
fastify.setNotFoundHandler((request, reply) => {
  reply.sendFile('index.html');
});

fastify.get('/health', async () => {
  return { status: 'ok' };
});

// ── /config — returns the canonical public origin so Client can build a correct
//    QR code even when running behind a reverse proxy or Cloudflare Tunnel.
//    Set PUBLIC_ORIGIN=https://your-domain.com in the environment; falls back
//    to the request's Host header, which is usually correct on a LAN.
fastify.get('/config', async (request) => {
  const publicOrigin =
    process.env.PUBLIC_ORIGIN ||
    `${request.protocol}://${request.hostname}`;
  return { publicOrigin };
});

// theme management endpoints
fastify.get('/themes', async (request, reply) => {
  const rows = db.prepare('SELECT id, name, data FROM themes').all();
  return rows.map(r => ({ id: r.id, name: r.name, data: JSON.parse(r.data) }));
});

fastify.post('/themes', async (request, reply) => {
  const { name, data } = request.body;
  if (!name || !data) {
    reply.code(400);
    return { error: 'name and data are required' };
  }
  try {
    const stmt = db.prepare('INSERT INTO themes (name, data) VALUES (?, ?)');
    const info = stmt.run(name, JSON.stringify(data));
    return { id: info.lastInsertRowid, name, data };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not create theme' };
  }
});

fastify.put('/themes/:id', async (request, reply) => {
  const { id } = request.params;
  const { name, data } = request.body;
  if (!name || !data) {
    reply.code(400);
    return { error: 'name and data are required' };
  }
  try {
    const stmt = db.prepare('UPDATE themes SET name = ?, data = ? WHERE id = ?');
    stmt.run(name, JSON.stringify(data), id);
    return { id: Number(id), name, data };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not update theme' };
  }
});

fastify.delete('/themes/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    const stmt = db.prepare('DELETE FROM themes WHERE id = ?');
    stmt.run(id);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not delete theme' };
  }
});

// ── setlist management endpoints (F3) ─────────────────────────────────────────
fastify.get('/setlists', async (request, reply) => {
  const rows = db.prepare('SELECT id, name, items, created_at FROM setlists ORDER BY created_at DESC').all();
  return rows.map(r => ({ id: r.id, name: r.name, items: JSON.parse(r.items), created_at: r.created_at }));
});

fastify.post('/setlists', async (request, reply) => {
  const { name, items } = request.body;
  if (!name) { reply.code(400); return { error: 'name is required' }; }
  try {
    const stmt = db.prepare('INSERT INTO setlists (name, items) VALUES (?, ?)');
    const info = stmt.run(name, JSON.stringify(items || []));
    return { id: info.lastInsertRowid, name, items: items || [] };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not create setlist' };
  }
});

fastify.put('/setlists/:id', async (request, reply) => {
  const { id } = request.params;
  const { name, items } = request.body;
  if (!name) { reply.code(400); return { error: 'name is required' }; }
  try {
    db.prepare('UPDATE setlists SET name = ?, items = ? WHERE id = ?')
      .run(name, JSON.stringify(items || []), id);
    return { id: Number(id), name, items: items || [] };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not update setlist' };
  }
});

fastify.delete('/setlists/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    db.prepare('DELETE FROM setlists WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not delete setlist' };
  }
});

// ── scripture browser endpoints (F1) ──────────────────────────────────────────
fastify.get('/browse/books', async (request, reply) => {
  const { language } = request.query;
  const targetDb = resolveDbAdapter(language);
  try {
    return engine.browseBooks(targetDb);
  } catch (err) {
    fastify.log.error('browse/books failed', err);
    reply.code(500);
    return { error: 'fetch failed' };
  }
});

fastify.get('/browse/chapters', async (request, reply) => {
  const { book_id, language } = request.query;
  if (!book_id) { reply.code(400); return { error: 'book_id is required' }; }
  const targetDb = resolveDbAdapter(language);
  try {
    return engine.browseChapters(targetDb, book_id);
  } catch (err) {
    fastify.log.error('browse/chapters failed', err);
    reply.code(500);
    return { error: 'fetch failed' };
  }
});

fastify.get('/browse/verses', async (request, reply) => {
  const { chapter_id, language } = request.query;
  if (!chapter_id) { reply.code(400); return { error: 'chapter_id is required' }; }
  const targetDb = resolveDbAdapter(language);
  try {
    return engine.browseVerses(targetDb, chapter_id);
  } catch (err) {
    fastify.log.error('browse/verses failed', err);
    reply.code(500);
    return { error: 'fetch failed' };
  }
});

// ─── Service timing constants ─────────────────────────────────────────────────
// These are tuned for a church / worship-service environment where:
//   • WiFi in chapel buildings is often congested and unreliable
//   • Sessions last 1–3 hours with long silent stretches (prayers, music)
//   • A dropped socket during a sacrament prayer must not kill the session
//   • The operator cannot be expected to notice and intervene quickly
const SERVICE_CONFIG = {
  // How long Socket.IO waits between heartbeat pings (ms).
  // 25 s gives headroom over mobile 4G keep-alive timers (~30 s).
  PING_INTERVAL_MS: 25_000,

  // How long without a pong before the socket is considered dead (ms).
  // 90 s tolerates a brief building WiFi hiccup or phone screen-lock.
  PING_TIMEOUT_MS: 90_000,

  // How long after the last socket leaves a session before its state is
  // garbage-collected (ms).  4 hours covers multi-hour worship services,
  // intermissions, and sessions where the presenting device goes to sleep.
  SESSION_GRACE_MS: 4 * 60 * 60 * 1000,

  // Shorter grace for sessions that never had a TV viewer (e.g. a presenter
  // who opened the app but never connected a display, or a stale test session).
  // These have no QR code displayed anywhere, so nobody is coming back for them.
  SESSION_NO_VIEWER_GRACE_MS: 2 * 60 * 1000,

  // How long to wait before broadcasting presenter-left after a socket drop.
  // Absorbs brief WiFi blips and phone screen-locks without the TV ever seeing
  // the presenter as gone.  If the presenter reconnects and re-joins within this
  // window the timer is cancelled and the TV display is never disturbed.
  PRESENTER_LEFT_DEBOUNCE_MS: 5_000,

  // Maximum number of concurrent named sessions (prevents memory exhaustion
  // if the server is left running across multiple weeks of service).
  MAX_SESSIONS: 50,
};

const io = new Server(fastify.server, {
  cors: { origin: '*' },
  pingInterval: SERVICE_CONFIG.PING_INTERVAL_MS,
  pingTimeout:  SERVICE_CONFIG.PING_TIMEOUT_MS,
});

// ensure themes table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE,
      data TEXT NOT NULL
    );
  `);
} catch (err) {
  fastify.log.error('failed to ensure themes table', err);
}

// ensure setlists table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS setlists (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL UNIQUE,
      items      TEXT    NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);
} catch (err) {
  fastify.log.error('failed to ensure setlists table', err);
}

// ensure verse_embeddings table exists (skip in Electron — DB is read-only ASAR)
if (!IS_ELECTRON_PKG) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS verse_embeddings (
        verse_id INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL
      );
    `);
  } catch (err) {
    fastify.log.error('failed to ensure verse_embeddings table', err);
  }
}

// Build the FTS table once (or when explicitly forced) instead of rebuilding every startup.
// Uses the shared engine's initializeFts via adapters.
const { initializeFts, segmentVerseText, segmentVerseTextDual, parseScriptureReference,
        searchScripture, searchScriptureInDb, getAdjacentVerse, fetchVerseByCoords,
        getVersionCitation, getVerseOfTheDay, VOTD_POOL, phraseSearch,
        applyDoctrineAliases, DOCTRINE_ALIASES,
        BIBLE_CITATIONS, TRIPLE_CITATIONS, LANGUAGE_NAMES } = engine;

// ── Semantic embedding infrastructure ────────────────────────────────────────
const REBUILD_EMBEDDINGS = process.env.REBUILD_EMBEDDINGS === 'true';
const EMBED_BATCH_SIZE   = 50;

let embeddingsReady     = false;
const embeddingCache    = new Map(); // verse_id → Float32Array(384)
const verseMetaCache    = new Map(); // verse_id → { chapter_id, scripture_text }
const verseConceptCache = new Map(); // verse_id → Set<string> of matched concept keys

// Topical Guide caches (populated at startup if topical-guide.db is present)
const verseTopicCache = new Map(); // verse_id → Set<topic_slug>
const topicNameMap    = new Map(); // topic_slug → topic_name (display)
let topicalGuideReady = false;

function buildTopicalGuideCache() {
  if (!db_tg) return;
  try {
    const tcount = db_tg.prepare('SELECT COUNT(*) AS c FROM topical_guide WHERE verse_id IS NOT NULL').get().c;
    if (tcount === 0) return; // scraper still running
    const topics = db_tg.prepare('SELECT id, slug, name FROM topics').all();
    const topicSlugById = new Map();
    for (const t of topics) {
      topicNameMap.set(t.slug, t.name);
      topicSlugById.set(t.id, t.slug);
    }
    const rows = db_tg.prepare('SELECT topic_id, verse_id FROM topical_guide WHERE verse_id IS NOT NULL').all();
    for (const r of rows) {
      const slug = topicSlugById.get(r.topic_id);
      if (!slug) continue;
      let s = verseTopicCache.get(r.verse_id);
      if (!s) { s = new Set(); verseTopicCache.set(r.verse_id, s); }
      s.add(slug);
    }
    topicalGuideReady = true;
    fastify.log.info(`Topical Guide loaded: ${topicNameMap.size} topics, ${verseTopicCache.size} verses mapped`);
  } catch (err) {
    fastify.log.warn('Topical Guide cache build failed (non-fatal):', err.message);
  }
}

function detectConcepts(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const [key, def] of Object.entries(DOCTRINE_ALIASES)) {
    const hit = def.terms?.some(t => lower.includes(t.toLowerCase()))
             || def.phrases?.some(p => lower.includes(p.toLowerCase()));
    if (hit) found.add(key);
  }
  return found;
}

function setsOverlap(a, b) {
  for (const item of a) if (b.has(item)) return true;
  return false;
}

function cosineSimilarity(a, b) {
  let sum = 0.0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function buildVerseMetaCache() {
  const rows = db.prepare('SELECT id AS verse_id, chapter_id, scripture_text FROM verses').all();
  for (const r of rows) {
    verseMetaCache.set(r.verse_id, { chapter_id: r.chapter_id, scripture_text: r.scripture_text });
    verseConceptCache.set(r.verse_id, detectConcepts(r.scripture_text));
  }
}

function buildEmbeddingCache() {
  const rows = db.prepare('SELECT verse_id, embedding FROM verse_embeddings').all();
  for (const r of rows) {
    embeddingCache.set(
      r.verse_id,
      new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)
    );
  }
  embeddingsReady = true;
}

async function processBatchAsync(pipe, verses, offset) {
  if (offset >= verses.length) {
    buildEmbeddingCache();
    fastify.log.info('[Embeddings] Ready — in-memory cache built.');
    return;
  }
  const batch = verses.slice(offset, offset + EMBED_BATCH_SIZE);
  const rows = [];
  for (const v of batch) {
    const out = await pipe(v.scripture_text, { pooling: 'mean', normalize: true });
    rows.push({ verse_id: v.verse_id, buf: Buffer.from(new Float32Array(out.data).buffer) });
  }
  const ins = db.prepare('INSERT OR REPLACE INTO verse_embeddings (verse_id, embedding) VALUES (?, ?)');
  db.transaction(items => { for (const { verse_id, buf } of items) ins.run(verse_id, buf); })(rows);
  const done = offset + batch.length;
  if (done % 1000 < EMBED_BATCH_SIZE || done >= verses.length)
    fastify.log.info(`[Embeddings] ${done}/${verses.length}`);
  setImmediate(() => processBatchAsync(pipe, verses, done));
}

async function initEmbeddings() {
  try {
    fastify.log.info('[Embeddings] Loading pipeline…');
    const { pipeline } = await import('@xenova/transformers');
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    fastify.log.info('[Embeddings] Pipeline loaded.');
    if (REBUILD_EMBEDDINGS) {
      db.prepare('DELETE FROM verse_embeddings').run();
      fastify.log.info('[Embeddings] Cleared for rebuild.');
    }
    const total    = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
    const existing = db.prepare('SELECT COUNT(*) AS n FROM verse_embeddings').get().n;
    if (existing >= total) {
      fastify.log.info(`[Embeddings] ${existing}/${total} already stored — building cache.`);
      buildEmbeddingCache();
      return;
    }
    const missing = db.prepare(`
      SELECT v.id AS verse_id, v.scripture_text FROM verses v
      LEFT JOIN verse_embeddings e ON v.id = e.verse_id
      WHERE e.verse_id IS NULL
    `).all();
    fastify.log.info(`[Embeddings] Computing ${missing.length} embeddings in background…`);
    setImmediate(() => processBatchAsync(pipe, missing, 0));
  } catch (err) {
    fastify.log.error('[Embeddings] Init failed: ' + err.message);
  }
}

// Build verse meta + concept cache synchronously before any requests are served
buildVerseMetaCache();
buildTopicalGuideCache();

// ── HTTP route: adjacent verse ───────────────────────────────────────────────
fastify.get('/verse/adjacent', async (request, reply) => {
    const { verse_id, direction, language, book_id, chapter_number, verse_number } = request.query;
    if (!verse_id || !direction) {
        reply.code(400);
        return { error: 'missing parameters' };
    }

    const targetDb = resolveDbAdapter(language);

    const result = getAdjacentVerse({
        verse_id: Number(verse_id),
        book_id:        book_id        ? Number(book_id)        : undefined,
        chapter_number: chapter_number ? Number(chapter_number) : undefined,
        verse_number:   verse_number   ? Number(verse_number)   : undefined,
        direction,
    }, targetDb, fastify.log);

    if (!result) {
        reply.code(404);
        return { error: 'not found' };
    }
    return { ...result, version_citation: getVersionCitation(language || 'en', result.volume_id) };
});

// ── HTTP route: semantically related verses ───────────────────────────────────
fastify.get('/verse/:verse_id/related', async (request, reply) => {
  const verseId = parseInt(request.params.verse_id, 10);
  if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; }

  const meta = verseMetaCache.get(verseId);
  if (!meta) { reply.code(404); return { error: 'Verse not found' }; }

  // Fallback: FTS-based results while embeddings are still computing
  if (!embeddingsReady) {
    const concepts = verseConceptCache.get(verseId);
    let phrase;
    if (concepts && concepts.size > 0) {
      const firstConcept = [...concepts][0];
      const aliasDef = DOCTRINE_ALIASES[firstConcept];
      phrase = aliasDef ? (aliasDef.terms || []).slice(0, 5).join(' ') : null;
    }
    if (!phrase) phrase = meta.scripture_text.split(/\s+/).slice(0, 6).join(' ');
    const { results } = phraseSearch(phrase, 0, 12, dba, fastify.log);
    return { results: results.filter(r => r.verse_id !== verseId), fallback: true };
  }

  const liveVec = embeddingCache.get(verseId);
  if (!liveVec) { reply.code(404); return { error: 'Embedding not found' }; }

  const liveConcepts = verseConceptCache.get(verseId);
  const liveTopics   = topicalGuideReady ? (verseTopicCache.get(verseId) ?? new Set()) : new Set();
  const liveChapter  = meta.chapter_id;

  const scores = [];
  for (const [cid, cvec] of embeddingCache) {
    const cmeta = verseMetaCache.get(cid);
    if (cmeta.chapter_id === liveChapter) continue;
    let score = cosineSimilarity(liveVec, cvec);
    // Topical Guide boost (canonical topic match — preferred signal)
    if (topicalGuideReady && liveTopics.size) {
      const cTopics = verseTopicCache.get(cid);
      if (cTopics && setsOverlap(liveTopics, cTopics)) score += 0.15;
    } else if (liveConcepts.size && setsOverlap(liveConcepts, verseConceptCache.get(cid))) {
      // Fall back to DOCTRINE_ALIASES concept boost when TG not loaded
      score += 0.15;
    }
    scores.push({ verse_id: cid, score });
  }
  scores.sort((a, b) => b.score - a.score);

  const stmt = dba.prepare(`
    SELECT verse_id, verse_title, scripture_text, book_title,
           chapter_number, verse_number, chapter_id
    FROM scriptures WHERE verse_id = ?
  `);
  const results = scores.slice(0, 12).map(({ verse_id, score }) => {
    const row = stmt.get(verse_id);
    // Matched concept: prefer Topical Guide topic name, fall back to DOCTRINE_ALIASES key
    let matchedConcept = null;
    if (topicalGuideReady && liveTopics.size) {
      const cTopics = verseTopicCache.get(verse_id);
      if (cTopics) {
        const sharedSlug = [...liveTopics].find(s => cTopics.has(s)) ?? null;
        matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? sharedSlug) : null;
      }
    } else if (liveConcepts.size) {
      const concepts = verseConceptCache.get(verse_id);
      matchedConcept = [...liveConcepts].find(c => concepts.has(c)) ?? null;
    }
    return { ...row, similarity_score: +score.toFixed(4), matched_concept: matchedConcept };
  });

  const matchedConcept = topicalGuideReady && liveTopics.size
    ? (topicNameMap.get([...liveTopics][0]) ?? null)
    : (liveConcepts.size ? [...liveConcepts][0] : null);

  return { results, matchedConcept };
});

// ── verse translation endpoint (F4) ───────────────────────────────────────────
fastify.get('/verse/:verse_id/translation', async (request, reply) => {
  const { verse_id } = request.params;
  const { language } = request.query;
  if (!language || !['tl', 'ceb', 'es', 'el', 'ilo', 'ja', 'nrsvue', 'war'].includes(language.toLowerCase())) {
    reply.code(400);
    return { error: 'language must be tl, ceb, es, el, ilo, ja, nrsvue or war' };
  }
  const targetDb = resolveDbAdapter(language);
  try {
    // Resolve coordinates from the KJV DB so non-KJV versification (e.g. Japanese) is handled correctly.
    const coords = dba.prepare(
      'SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1'
    ).get(Number(verse_id));
    if (!coords) { reply.code(404); return { error: 'verse not found' }; }
    const row = fetchVerseByCoords(targetDb, coords, 'scripture_text');
    if (!row) { reply.code(404); return { error: 'verse not found in translation' }; }
    return { verse_id: Number(verse_id), language: language.toLowerCase(), scripture_text: row.scripture_text };
  } catch (err) {
    fastify.log.error('translation fetch failed', err);
    reply.code(500);
    return { error: 'fetch failed' };
  }
});

// ── Verse of the Day ────────────────────────────────────────────────────────
fastify.get('/verse/of-the-day', async (request, reply) => {
  try {
    const result = getVerseOfTheDay(dba);
    if (!result) { reply.code(404); return { error: 'not found' }; }
    return result;
  } catch (err) {
    fastify.log.error('verse-of-the-day failed', err);
    reply.code(500);
    return { error: 'internal error' };
  }
});

function registerSocketHandlers(io, { segmentVerseText, db, db_cebuano, db_tagalog, db_spanish, db_greek, db_ilocano, db_japanese, db_nrsvue, db_waray }) {
  const DEFAULT_SESSION_ID = 'GLOBAL';
  const SESSION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const SESSION_CODE_LENGTH = 6;
  // Use the service config defined at module level; allow env override for testing.
  const SESSION_GRACE_MS          = Number(process.env.SESSION_GRACE_MS          || SERVICE_CONFIG.SESSION_GRACE_MS);
  const SESSION_NO_VIEWER_GRACE_MS = Number(process.env.SESSION_NO_VIEWER_GRACE_MS || SERVICE_CONFIG.SESSION_NO_VIEWER_GRACE_MS);
  const PRESENTER_LEFT_DEBOUNCE_MS = Number(process.env.PRESENTER_LEFT_DEBOUNCE_MS || SERVICE_CONFIG.PRESENTER_LEFT_DEBOUNCE_MS);
  const sessionState = new Map();
  const cleanupTimers = new Map();
  // Track viewer counts per session so the Presenter can see "N displays connected"
  const sessionViewerCounts = new Map();

  function normalizeSessionId(value) {
    if (!value) return '';
    return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  }

  function getSessionState(sessionId) {
    if (!sessionState.has(sessionId)) {
      sessionState.set(sessionId, {
        theme: null,
        liveVerse: null,
        highlightedText: '',
        presenterSocketId: null,
        // Stable hex token issued when a presenter first claims the slot.
        // Persists across socket reconnects so the same browser tab can always
        // reclaim its own session even after a network blip.
        presenterToken: null,
        // Unix timestamp of the last presenter action (go-live, update-verse, etc.).
        presenterLastActivityAt: null,
        // Unix timestamp of when the presenter's socket last disconnected.
        // The presenter slot is held indefinitely until voluntary leave — this
        // timestamp is tracked for informational purposes only.
        presenterDisconnectedAt: null,
        // Set of presenterTokens that were evicted from this session.  Barred
        // from re-entering until the current presenter voluntarily leaves.
        lockedOutTokens: new Set(),
        // Token + socketId for the "main" TV/projector that created the session.
        // Additional viewers join as secondary mirrors and get the same content.
        mainClientToken: null,
        mainClientSocketId: null,
        pinHash: null,
        updatedAt: Date.now(),
        // true once a TV/viewer socket has joined — used to pick the right grace period
        hadViewer: false,
        // pending setTimeout handle: emitting presenter-left is deferred so brief
        // WiFi drops can be cancelled before the TV ever sees the event
        _presenterLeftTimer: null,
      });
    }
    return sessionState.get(sessionId);
  }

  // ── Electron standalone: pre-seed the LOCAL session ───────────────────────────
  // When the app runs inside Electron both the Presenter window (?session=LOCAL)
  // and the Client window (create-client-session{preferredSessionId:'LOCAL'}) must
  // land in the SAME socket.io room.  If the Client socket fires first it would
  // normally generate a random session ID instead of honouring 'LOCAL', because
  // sessionExists('LOCAL') would be false.  Seeding the state map here guarantees
  // sessionExists returns true from the very first connection, so both windows
  // always converge on the same 'LOCAL' room without any race condition.
  const IS_ELECTRON = !!process.versions?.electron;
  if (IS_ELECTRON) {
    getSessionState('LOCAL');   // creates the map entry; no token is set yet
    fastify.log.info('Electron mode: LOCAL session pre-seeded');
  }

  function generateSessionId() {
    // Guard against unbounded session accumulation (e.g. server left running for weeks)
    if (sessionState.size >= SERVICE_CONFIG.MAX_SESSIONS) {
      fastify.log.warn(`MAX_SESSIONS (${SERVICE_CONFIG.MAX_SESSIONS}) reached — refusing new session`);
      return null;
    }
    for (let i = 0; i < 16; i += 1) {
      let generated = '';
      for (let j = 0; j < SESSION_CODE_LENGTH; j += 1) {
        const idx = Math.floor(Math.random() * SESSION_CODE_CHARS.length);
        generated += SESSION_CODE_CHARS[idx];
      }
      if (!sessionState.has(generated) && generated !== DEFAULT_SESSION_ID) {
        return generated;
      }
    }
    return `${SESSION_CODE_CHARS[Math.floor(Math.random() * SESSION_CODE_CHARS.length)]}${Date.now().toString(36).toUpperCase().slice(-5)}`;
  }

  // Generate a 32-character cryptographically random hex token.
  // Used to give each presenter (and main TV) a stable identity that survives
  // socket reconnects.  Node's built-in `crypto` module — no extra deps.
  function generateToken() {
    return require('crypto').randomBytes(16).toString('hex');
  }

  // ── Viewer count tracking ────────────────────────────────────────────────
  function incrementViewerCount(sessionId) {
    const n = (sessionViewerCounts.get(sessionId) || 0) + 1;
    sessionViewerCounts.set(sessionId, n);
    broadcastViewerCount(sessionId, n);
  }

  function decrementViewerCount(sessionId) {
    const n = Math.max(0, (sessionViewerCounts.get(sessionId) || 1) - 1);
    sessionViewerCounts.set(sessionId, n);
    broadcastViewerCount(sessionId, n);
  }

  function broadcastViewerCount(sessionId, count) {
    if (!sessionId || sessionId === DEFAULT_SESSION_ID) return;
    io.to(sessionId).emit('viewer-count', { sessionId, count });
  }

  function emitToSession(sessionId, event, payload) {
    io.to(sessionId).emit(event, payload);
  }

  function getRoomSize(sessionId) {
    const rooms = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms;
    if (!rooms || typeof rooms.get !== 'function') return null;
    const room = rooms.get(sessionId);
    return room ? room.size : 0;
  }

  function cancelCleanup(sessionId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) return;
    const timer = cleanupTimers.get(normalized);
    if (timer) {
      clearTimeout(timer);
      cleanupTimers.delete(normalized);
    }
  }

  function cleanupSessionIfUnused(sessionId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || normalized === DEFAULT_SESSION_ID) return;
    const roomSize = getRoomSize(normalized);
    if (roomSize !== 0) return;
    cancelCleanup(normalized);
    if (sessionState.has(normalized)) {
      sessionState.delete(normalized);
      fastify.log.info(`Session ${normalized} terminated (no active sockets)`);
    }
  }

  function scheduleCleanup(sessionId, { disconnecting = false } = {}) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || normalized === DEFAULT_SESSION_ID) return;
    const roomSize = getRoomSize(normalized);
    if (roomSize === null || (!disconnecting && roomSize > 0) || (disconnecting && roomSize > 1)) {
      cancelCleanup(normalized);
      return;
    }
    cancelCleanup(normalized);
    // Sessions that have hosted a TV screen get the full 30-min grace so they can
    // come back to the same QR code after a power-save cycle.  Sessions that only
    // ever had a presenter (e.g. someone opened the app but never connected a TV)
    // are cleaned up quickly — nobody is scanning that QR code.
    const state = sessionState.get(normalized);
    const graceMs = (state && state.hadViewer) ? SESSION_GRACE_MS : SESSION_NO_VIEWER_GRACE_MS;
    const timer = setTimeout(() => {
      cleanupSessionIfUnused(normalized);
    }, graceMs);
    cleanupTimers.set(normalized, timer);
  }

  function sessionExists(sessionId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) return false;
    if (sessionState.has(normalized)) return true;
    const roomSize = getRoomSize(normalized);
    return typeof roomSize === 'number' && roomSize > 0;
  }

  // voluntary=true  → presenter explicitly left (leave-session, end-live).
  //                   Clear the token + lockout list so the room is fully open.
  // voluntary=false → socket dropped (network blip, page refresh).
  //                   Keep presenterToken so the same browser tab can reconnect.
  function releasePresenterLock(sessionId, socketId, voluntary = false) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || normalized === DEFAULT_SESSION_ID) return;
    const state = sessionState.get(normalized);
    if (state && state.presenterSocketId === socketId) {
      state.presenterSocketId = null;
      if (voluntary) {
        // Room is now completely open — any presenter can walk in.
        state.presenterToken            = null;
        state.presenterLastActivityAt   = null;
        state.presenterDisconnectedAt   = null;
        state.lockedOutTokens           = new Set();
      }
      state.updatedAt = Date.now();
    }
  }

  function hasConnectedSocket(socketId) {
    if (!socketId) return false;
    const socketMap = io && io.sockets && io.sockets.sockets;
    if (!socketMap) return false;
    if (typeof socketMap.has === 'function') return socketMap.has(socketId);
    if (typeof socketMap.get === 'function') return Boolean(socketMap.get(socketId));
    return false;
  }

  function clearStalePresenterLock(state) {
    if (!state || !state.presenterSocketId) return;
    if (!hasConnectedSocket(state.presenterSocketId)) {
      state.presenterSocketId = null;
      state.updatedAt = Date.now();
    }
  }

  function ensurePresenterAccess(sessionId, socket) {
    const state = getSessionState(sessionId);
    clearStalePresenterLock(state);
    // Track last-activity timestamp so idle-eviction logic stays current.
    if (state.presenterSocketId === socket.id) {
      state.presenterLastActivityAt = Date.now();
    }
    // Hard block: only the socket that won the presenter slot is allowed.
    // NO silent grant — a socket must call join-session as presenter first.
    if (!state.presenterSocketId || state.presenterSocketId !== socket.id) {
      socket.emit('session-error', { message: 'Presenter access required — join as presenter first' });
      return false;
    }
    return true;
  }

  // ── Idle session sweep ────────────────────────────────────────────────────────
  // Safety-net garbage collector: every 5 minutes, delete any session whose room
  // is empty AND whose cleanup timer has already fired or was never scheduled.
  // This catches sessions that slipped through the normal cleanup path (e.g. the
  // cleanup timer ran and deleted the Map entry but a new one was recreated by
  // an errant getSessionState call, or a very old presenter-left debounce timer
  // left a ghost entry).  Sessions that still have an active TV socket in their
  // room are left alone — getRoomSize() > 0 for them.
  const _idleSweep = setInterval(() => {
    for (const [sessionId] of sessionState) {
      if (sessionId === DEFAULT_SESSION_ID) continue;
      if (getRoomSize(sessionId) === 0 && !cleanupTimers.has(sessionId)) {
        sessionState.delete(sessionId);
        fastify.log.info(`[idle-sweep] Removed ghost session ${sessionId}`);
      }
    }
  }, 5 * 60 * 1000);

  io.on('connection', (socket) => {
    console.log('a user connected');
    let activeSessionId = DEFAULT_SESSION_ID;
    let activeRole = 'viewer';
    socket.join(activeSessionId);
    getSessionState(activeSessionId);

    const joinSession = (candidateSessionId, role = 'viewer', pin = '', presenterToken = '') => {
      const normalized = normalizeSessionId(candidateSessionId);
      if (!normalized) return null;
      const previousSessionId = activeSessionId;
      if (role === 'presenter') {
        const state = getSessionState(normalized);
        clearStalePresenterLock(state);   // clear dead-socket reference first

        const incomingToken = String(presenterToken || '').trim();

        // ── Step 1: Lockout check ─────────────────────────────────────────────
        // A token that was evicted stays barred until the current presenter
        // voluntarily leaves.
        if (incomingToken && state.lockedOutTokens.has(incomingToken)) {
          return { error: 'presenter-locked-out' };
        }

        // ── Step 2: Same presenter reconnecting ───────────────────────────────
        // The token matches — this is the original device/tab returning after
        // a network blip or page refresh.  Clear the disconnect timer now that
        // they're back, then fall through to the grant section.
        if (incomingToken && state.presenterToken === incomingToken) {
          state.presenterDisconnectedAt = null; // they're back — stop the eviction clock
        }

        // ── Step 3: No current presenter ─────────────────────────────────────
        else if (!state.presenterToken) {
          // Slot is vacant.  Assign the incoming token (or generate a fresh one
          // if the client didn't supply one, as is the case on first join).
          state.presenterToken = incomingToken || generateToken();
        }

        // ── Steps 4 & 5: Different token — check connected vs disconnected ────
        else {
          if (hasConnectedSocket(state.presenterSocketId)) {
            // ── Step 4: current holder's socket is still alive ─────────────
            // The preacher's device is online — protect them unconditionally.
            // Being "idle" (not touching the screen) is normal during a sermon.
            io.to(state.presenterSocketId).emit('presenter-takeover-attempt', {
              message: 'Another device attempted to join your session as presenter',
            });
            return { error: 'Another presenter is active in this session' };
          } else {
            // ── Step 5: holder's socket is gone (disconnected) ─────────────
            // Presenter lock is permanent until they explicitly hit "Leave Session".
            // A disconnected device (sleeping phone, WiFi blip, mid-sermon) does
            // not open the slot — the preacher's place is always held for them.
            return { error: 'presenter-session-in-progress' };
          }
        }

        // ── PIN gate (runs after token checks so locked-out is caught first) ──
        if (state.pinHash) {
          const provided = String(pin || '').trim();
          if (!provided) return { requiresPin: true };
          if (hashPin(provided) !== state.pinHash) return { pinIncorrect: true };
        }
      }
      if (activeSessionId && activeSessionId !== normalized) {
        socket.leave(activeSessionId);
        if (activeRole === 'presenter') {
          releasePresenterLock(previousSessionId, socket.id, true /* voluntary — switching sessions */);
        } else {
          // Viewer leaving previous session
          decrementViewerCount(previousSessionId);
        }
        scheduleCleanup(previousSessionId);
      }
      activeSessionId = normalized;
      activeRole = role;
      socket.join(activeSessionId);
      cancelCleanup(activeSessionId);
      const state = getSessionState(activeSessionId);
      if (role === 'presenter') {
        // Cancel any pending presenter-left debounce — this can happen when the
        // presenter reconnects within PRESENTER_LEFT_DEBOUNCE_MS of a socket drop.
        // In that case the TV never receives presenter-left and the display stays
        // completely stable.
        if (state._presenterLeftTimer) {
          clearTimeout(state._presenterLeftTimer);
          state._presenterLeftTimer = null;
        }
        state.presenterSocketId = socket.id;
      } else {
        // Mark that a TV/viewer has joined this session at least once.
        // This triggers the longer SESSION_GRACE_MS on cleanup instead of
        // the quick SESSION_NO_VIEWER_GRACE_MS, preserving the QR code for
        // power-save reconnects.
        state.hadViewer = true;
        incrementViewerCount(activeSessionId);
      }
      // Tell the joining socket it's in the session (include pinSet so the
      // presenter UI can show the correct lock state on reconnect)
      socket.emit('session-joined', { sessionId: activeSessionId, pinSet: !!state.pinHash });
      if (state.theme) socket.emit('update-theme', state.theme);
      if (state.liveVerse) socket.emit('update-verse', state.liveVerse);
      if (state.customMode) socket.emit('custom-text', { ...state.customMode, theme: state.theme });
      if (state.highlightedText) socket.emit('highlight-text', state.highlightedText);
      socket.emit('viewer-count', {
        sessionId: activeSessionId,
        count: sessionViewerCounts.get(activeSessionId) || 0,
      });
      if (role === 'presenter') {
        // Tell the TV (and any secondary screens) a presenter is now live.
        // Include the session's current live verse + theme so the TV can
        // restore the display immediately on reconnect without waiting for go-live.
        socket.to(activeSessionId).emit('presenter-joined', {
          sessionId: activeSessionId,
          verse: state.liveVerse || null,
          theme: state.theme     || null,
        });
      } else {
        // When a viewer (TV) joins and a presenter is already active, notify that
        // viewer immediately so it exits kiosk mode and shows the correct QR label
        if (state.presenterSocketId && io.sockets.sockets.get(state.presenterSocketId)) {
          socket.emit('presenter-joined', {
            sessionId: activeSessionId,
            verse: state.liveVerse || null,
            theme: state.theme     || null,
          });
        }
      }
      return { sessionId: activeSessionId, pinSet: !!state.pinHash, presenterToken: state.presenterToken };
    };

    const leaveActiveSession = () => {
      if (!activeSessionId || activeSessionId === DEFAULT_SESSION_ID) {
        return { sessionId: DEFAULT_SESSION_ID };
      }
      const previousSessionId = activeSessionId;
      if (activeRole === 'presenter') {
        // Tell the TV (and any secondary screens) the presenter has left so they
        // can reset state and switch the QR back to the presenter-join URL.
        socket.to(previousSessionId).emit('presenter-left', { sessionId: previousSessionId, voluntary: true });
        releasePresenterLock(previousSessionId, socket.id, true /* voluntary */);
      } else {
        decrementViewerCount(previousSessionId);
      }
      socket.leave(previousSessionId);
      activeSessionId = DEFAULT_SESSION_ID;
      activeRole = 'viewer';
      socket.join(DEFAULT_SESSION_ID);
      scheduleCleanup(previousSessionId);
      socket.emit('session-left', { sessionId: previousSessionId });
      return { sessionId: previousSessionId };
    };

    socket.on('create-session', (payload, callback) => {
      const sessionId = generateSessionId();
      if (!sessionId) {
        const error = { message: 'Server session limit reached — please try again later' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      // Pre-generate the presenter token so it can be returned to the client
      // immediately and stored in sessionStorage for reconnect identity.
      const presenterToken = generateToken();
      const joined = joinSession(sessionId, 'presenter', '', presenterToken);
      if (joined && joined.error) {
        const error = { message: joined.error };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      socket.emit('session-created', { sessionId: joined.sessionId, presenterToken: joined.presenterToken });
      if (typeof callback === 'function') callback({ ok: true, sessionId: joined.sessionId, presenterToken: joined.presenterToken });
    });

    // ── TV/Client-initiated sessions ──────────────────────────────────────────
    // The Client display (e.g. a TV) calls this to create a named session that
    // the Presenter then joins by scanning the QR code or typing the short code.
    //
    // Phase 2 addition: accepts an optional `preferredSessionId` so a TV that
    // has reloaded (browser crash, power-save) can request its previous code
    // back.  If that session still exists in state, the TV silently rejoins it
    // without changing the QR code — the Presenter never notices the hiccup.
    socket.on('create-client-session', (payload, callback) => {
      const preferred      = normalizeSessionId(payload && payload.preferredSessionId);
      const incomingToken  = payload && payload.mainClientToken ? String(payload.mainClientToken).trim() : '';
      let sessionId;
      let isMainClient = false;

      if (preferred && sessionExists(preferred)) {
        // The TV's previous session is still alive — try to rejoin it.
        sessionId = preferred;
        const state = getSessionState(sessionId);

        if (!state.mainClientToken) {
          // Session exists but has no main-client yet (edge case) — claim it.
          isMainClient = true;
        } else if (incomingToken && incomingToken === state.mainClientToken) {
          // Same TV reconnecting (browser crash / power-save) — restore slot.
          isMainClient = true;
          fastify.log.info(`Main TV reconnecting to client session ${sessionId}`);
        } else {
          // Different device — join as secondary viewer (mirrors exactly).
          isMainClient = false;
          fastify.log.info(`Secondary viewer joining client session ${sessionId}`);
        }
      } else {
        // Create a fresh session room.
        sessionId = generateSessionId();
        if (!sessionId) {
          const error = { message: 'Server session limit reached' };
          socket.emit('session-error', error);
          if (typeof callback === 'function') callback({ ok: false, ...error });
          return;
        }
        isMainClient = true;
      }

      // Leave any previous session cleanly.
      if (activeSessionId && activeSessionId !== DEFAULT_SESSION_ID && activeSessionId !== sessionId) {
        socket.leave(activeSessionId);
        decrementViewerCount(activeSessionId);
        scheduleCleanup(activeSessionId);
      }

      activeSessionId = sessionId;
      activeRole = 'viewer';
      socket.join(sessionId);
      cancelCleanup(sessionId);

      const state = getSessionState(sessionId); // ensure state map entry exists
      state.hadViewer = true;                   // FIX: was never set on this path
      incrementViewerCount(sessionId);

      let mainClientToken = state.mainClientToken || null;
      if (isMainClient) {
        if (!state.mainClientToken) {
          // Freshly generated or unclaimed — mint a new token.
          mainClientToken = generateToken();
          state.mainClientToken = mainClientToken;
        }
        state.mainClientSocketId = socket.id;
      }

      socket.emit('client-session-created', {
        sessionId,
        mainClientToken: isMainClient ? mainClientToken : undefined,
        isMainClient,
      });
      if (typeof callback === 'function') callback({
        ok: true,
        sessionId,
        mainClientToken: isMainClient ? mainClientToken : undefined,
        isMainClient,
      });
    });

    socket.on('join-session', (payload, callback) => {
      const requested      = normalizeSessionId(payload && payload.sessionId);
      const role           = payload && payload.role === 'presenter' ? 'presenter' : 'viewer';
      const pin            = payload && payload.pin ? String(payload.pin).trim() : '';
      // Presenter token — stable identity persisted in the client's sessionStorage.
      // An empty string is fine for viewers (token logic only runs for presenter role).
      const presenterToken = payload && payload.presenterToken ? String(payload.presenterToken).trim() : '';
      if (!sessionExists(requested)) {
        const error = { message: 'Session not found' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      const joined = joinSession(requested, role, pin, presenterToken);
      // PIN-related rejections — do NOT emit session-error (they're expected flows)
      if (joined && joined.requiresPin) {
        if (typeof callback === 'function') callback({ ok: false, requiresPin: true });
        return;
      }
      if (joined && joined.pinIncorrect) {
        if (typeof callback === 'function') callback({ ok: false, pinIncorrect: true, message: 'Incorrect PIN — try again' });
        return;
      }
      if (!joined || joined.error) {
        const errCode = joined && joined.error;
        const message = errCode === 'presenter-locked-out'
          ? 'This session already has an active presenter. You can join once they end the service.'
          : (errCode || 'Valid session code is required');
        socket.emit('session-error', { message });
        if (typeof callback === 'function') callback({ ok: false, error: errCode, message });
        return;
      }
      if (!joined.sessionId) {
        const error = { message: 'Valid session code is required' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      if (typeof callback === 'function') callback({
        ok: true,
        sessionId: joined.sessionId,
        pinSet: joined.pinSet,
        presenterToken: joined.presenterToken || null,
      });
    });

    socket.on('leave-session', (payload, callback) => {
      const left = leaveActiveSession();
      if (typeof callback === 'function') callback({ ok: true, sessionId: left.sessionId });
    });

    // ── Session PIN management (presenter-only) ────────────────────────────────
    socket.on('set-session-pin', (payload, callback) => {
      if (!ensurePresenterAccess(activeSessionId, socket)) {
        if (typeof callback === 'function') callback({ ok: false, message: 'Not authorized' });
        return;
      }
      const pin = payload && payload.pin ? String(payload.pin).trim() : '';
      if (!/^\d{4,8}$/.test(pin)) {
        if (typeof callback === 'function') callback({ ok: false, message: 'PIN must be 4–8 digits' });
        return;
      }
      const state = getSessionState(activeSessionId);
      state.pinHash = hashPin(pin);
      if (typeof callback === 'function') callback({ ok: true });
    });

    socket.on('clear-session-pin', (_payload, callback) => {
      if (!ensurePresenterAccess(activeSessionId, socket)) {
        if (typeof callback === 'function') callback({ ok: false, message: 'Not authorized' });
        return;
      }
      const state = getSessionState(activeSessionId);
      state.pinHash = null;
      if (typeof callback === 'function') callback({ ok: true });
    });

    socket.on('search', (payload) => {
      try {
        const query    = typeof payload === 'string' ? payload : payload?.query;
        const page     = Number(payload?.page)     || 0;
        const pageSize = Number(payload?.pageSize) || 10;
        const language = payload?.language ? String(payload.language).toLowerCase().trim() : 'en';

        if (!query || !String(query).trim()) {
          socket.emit('search-results', { results: [], total: 0, page: 0, pageSize });
          return;
        }

        fastify.log.info(`search: "${query}" page=${page} pageSize=${pageSize} lang=${language}`);

        // Route search to the correct database adapter for the active language.
        let searchResults;
        if (language === 'en') {
          searchResults = searchScripture(query, page, pageSize, dba, fastify.log);
        } else {
          searchResults = searchScriptureInDb(query, page, pageSize, resolveDbAdapter(language), fastify.log);
        }

        const { results, total } = searchResults;
        socket.emit('search-results', { results, total, page, pageSize, query, language });
      } catch (err) {
        fastify.log.error({ err }, 'search handler failed');
        socket.emit('search-results', { results: [], total: 0, page: 0, pageSize: 10 });
        socket.emit('session-error', 'Search failed for the selected language');
      }
    });

    socket.on('update-verse', (payload) => {
      const verse = payload && payload.verse ? payload.verse : payload;
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('updating verse:', verse);
      const state = getSessionState(sessionId);
      state.liveVerse = verse;
      state.updatedAt = Date.now();
      emitToSession(sessionId, 'update-verse', verse);
    });

    socket.on('update-theme', (payload) => {
      const theme = payload && payload.theme ? payload.theme : payload;
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('updating theme:', theme);
      const state = getSessionState(sessionId);
      state.theme = theme;
      state.updatedAt = Date.now();
      emitToSession(sessionId, 'update-theme', theme);
    });

    socket.on('highlight-text', (payload) => {
      const text = payload && Object.prototype.hasOwnProperty.call(payload, 'text') ? payload.text : payload;
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('highlighting text:', text);
      const state = getSessionState(sessionId);
      state.highlightedText = text ? String(text).trim() : '';
      state.updatedAt = Date.now();
      emitToSession(sessionId, 'highlight-text', state.highlightedText);
    });

    // ── clear-screen ─────────────────────────────────────────────────────────
    // Presenter hits "End Live" → blank the TV, return Client to QR idle state.
    // Session stays alive — QR code is unchanged — presenter can go live again.
    socket.on('clear-screen', (payload, callback) => {
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      const state = getSessionState(sessionId);
      state.liveVerse      = null;
      state.highlightedText = '';
      state.customMode     = null;
      state.updatedAt      = Date.now();
      emitToSession(sessionId, 'clear-screen', {});
      fastify.log.info(`clear-screen broadcast to session ${sessionId}`);
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── go-custom (F2/F12) — send arbitrary announcement text to the TV ───────
    socket.on('go-custom', (payload) => {
      const { text, subtext, theme } = payload || {};
      const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      if (!text) return;
      const state = getSessionState(sessionId);
      state.customMode = { text: String(text), subtext: String(subtext || '') };
      state.theme      = theme || state.theme;
      state.liveVerse  = null;
      state.updatedAt  = Date.now();
      emitToSession(sessionId, 'custom-text', { text: String(text), subtext: String(subtext || ''), theme });
      if (theme) emitToSession(sessionId, 'update-theme', theme);
      fastify.log.info(`go-custom broadcast to session ${sessionId}`);
    });

    // ── preload-background (F11) — pre-warm browser cache before go-live ──────
    socket.on('preload-background', (payload) => {
      if (!payload?.background_url) return;
      const sessionId = activeSessionId || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      emitToSession(sessionId, 'preload-background', { background_url: payload.background_url });
    });

    // ── update-language ──────────────────────────────────────────────────────
    // Presenter switches language while a verse is already live.
    // Fetch the same verse from the correct database and re-broadcast it
    // so the TV updates immediately without requiring a new go-live.
    socket.on('update-language', (payload) => {
      const lang      = payload?.language ? String(payload.language).toLowerCase().trim() : 'en';
      const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;

      const state = getSessionState(sessionId);
      state.language  = lang;
      state.updatedAt = Date.now();

      // If there's a live verse, re-fetch it in the new language and re-broadcast
      if (state.liveVerse) {
        const targetDb = resolveDbAdapter(lang);
        try {
          const row = fetchVerseByCoords(
            targetDb,
            state.liveVerse,
            'scripture_text, verse_title, book_title, volume_title, volume_short_title'
          );
          if (row) {
            const updated = {
              ...state.liveVerse,
              scripture_text:    row.scripture_text || state.liveVerse.scripture_text,
              book_title:        row.book_title     || state.liveVerse.book_title,
              verse_title:       row.verse_title    || state.liveVerse.verse_title,
              volume_title:      row.volume_title   || state.liveVerse.volume_title   || '',
              volume_short_title: row.volume_short_title || state.liveVerse.volume_short_title || '',
              segments:          segmentVerseText(row.scripture_text || state.liveVerse.scripture_text),
              currentSegment:    0,
            };
            updated.totalSegments = updated.segments.length;
            state.liveVerse = updated;
            emitToSession(sessionId, 'update-verse', updated);
          }
        } catch (err) {
          fastify.log.warn(`update-language: failed to fetch verse in ${lang}:`, err?.message);
        }
      }

      fastify.log.info(`update-language: session ${sessionId} → ${lang}`);
    });

    socket.on('go-live', ({verse, theme, language, sessionId: rawSessionId, secondaryLanguage}) => {
      const sessionId = activeSessionId || normalizeSessionId(rawSessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('go-live triggered', verse, theme, language, sessionId);

      let scriptureText = verse.scripture_text;
      let verseTitle = verse.book_title + ' ' + verse.chapter_number + ':' + verse.verse_number;
      let bookTitle = verse.book_title;

      // Normalize language input
      const normalizedLanguage = language ? language.toLowerCase().trim() : null;

      // Determine target database with streamlined mapping
      let targetDb = dba;
      const isTranslation = normalizedLanguage && ['ceb', 'tl', 'es', 'el', 'ilo', 'ja', 'nrsvue', 'war'].includes(normalizedLanguage);
      if (isTranslation) {
        targetDb = resolveDbAdapter(normalizedLanguage);
      }

      if (targetDb) {
        try {
          const result = fetchVerseByCoords(
            targetDb,
            verse,
            'scripture_text, verse_title, book_title, volume_title, volume_short_title'
          );

          if (result) {
            // Apply field validation only for translations per specification
            if (isTranslation) {
              if (result.scripture_text) scriptureText = result.scripture_text;
              if (result.verse_title) verseTitle = result.verse_title;
              if (result.book_title) bookTitle = result.book_title;
            } else {
              scriptureText = result.scripture_text;
              verseTitle = result.verse_title;
              bookTitle = result.book_title;
            }
            verse = { ...verse,
              volume_title:       result.volume_title       || verse.volume_title       || '',
              volume_short_title: result.volume_short_title || verse.volume_short_title || '',
            };
          }
        } catch (err) {
          fastify.log.error(
            isTranslation
              ? `Failed to fetch ${normalizedLanguage} translation`
              : 'Failed to fetch English text',
            err
          );
        }
      }

      // Segment the verse for readability
      const segments = segmentVerseText(scriptureText);
      const verseWithSegments = {
        ...verse,
        scripture_text: scriptureText,
        verse_title: verseTitle,
        book_title: bookTitle,
        segments,
        totalSegments: segments.length,
        currentSegment: 0,
        // Always clear secondary fields so stale values from ...verse don't
        // bleed through when the presenter switches Off. The block below
        // re-populates them only when a secondary language is active.
        secondary_text:        null,
        secondary_book_title:  null,
        secondary_segments:    null,
        secondaryLanguage:     null,
        language:             normalizedLanguage || 'en',
        version_citation:     getVersionCitation(normalizedLanguage || 'en', verse.volume_id),
      };

      // F8 — dual language display: fetch secondary language text
      const normSecLang = secondaryLanguage ? String(secondaryLanguage).toLowerCase().trim() : null;
      if (normSecLang && ['tl', 'ceb', 'en', 'es', 'el', 'ilo', 'ja', 'nrsvue', 'war'].includes(normSecLang) && normSecLang !== normalizedLanguage) {
        const secDb = resolveDbAdapter(normSecLang);
        try {
          const secRow = fetchVerseByCoords(secDb, verse, 'scripture_text, book_title');
          if (secRow) {
            verseWithSegments.secondary_text       = secRow.scripture_text;
            verseWithSegments.secondary_book_title = secRow.book_title;
            verseWithSegments.secondaryLanguage    = normSecLang;
          }
        } catch (err) {
          fastify.log.warn('dual-lang fetch failed:', err?.message);
        }
      }

      // Recompute citation now that secondaryLanguage is known
      if (verseWithSegments.secondaryLanguage) {
        verseWithSegments.version_citation = getVersionCitation(
          normalizedLanguage || 'en',
          verse.volume_id,
          verseWithSegments.secondaryLanguage
        );
      }

      // Dual-language segmentation: re-segment both texts at a tighter word
      // limit and pair them so every slide shows one matched chunk of each.
      if (verseWithSegments.secondaryLanguage && verseWithSegments.secondary_text) {
        const { primarySegments, secondarySegments } = segmentVerseTextDual(
          scriptureText,
          verseWithSegments.secondary_text
        );
        verseWithSegments.segments           = primarySegments;
        verseWithSegments.totalSegments      = primarySegments.length;
        verseWithSegments.secondary_segments = secondarySegments;
      }

      const state = getSessionState(sessionId);
      state.liveVerse = verseWithSegments;
      state.theme = theme;
      state.highlightedText = '';
      state.updatedAt = Date.now();

      // Send only to clients in the same session
      emitToSession(sessionId, 'update-verse', verseWithSegments);
      emitToSession(sessionId, 'update-theme', theme);
    });

    socket.on('disconnecting', () => {
      if (socket.rooms && typeof socket.rooms.forEach === 'function') {
        socket.rooms.forEach((roomId) => {
          if (roomId !== socket.id) {
            // During `disconnecting` the socket is still in its rooms, so
            // socket.to() can still reach the TV/viewers before the lock is released.
            if (activeRole === 'presenter') {
              // Debounce presenter-left so brief WiFi blips (< PRESENTER_LEFT_DEBOUNCE_MS)
              // are invisible to the TV.  If the presenter reconnects and calls join-session
              // within that window the timer is cancelled and the TV display is never disturbed.
              const state = getSessionState(roomId);
              if (state) {
                // Track disconnect time — slot stays held until voluntary leave.
                if (state.presenterSocketId === socket.id) {
                  state.presenterDisconnectedAt = Date.now();
                }
                if (state._presenterLeftTimer) clearTimeout(state._presenterLeftTimer);
                const capturedRoomId = roomId;
                state._presenterLeftTimer = setTimeout(() => {
                  state._presenterLeftTimer = null;
                  io.to(capturedRoomId).emit('presenter-left', { sessionId: capturedRoomId, locked: true });
                }, PRESENTER_LEFT_DEBOUNCE_MS);
              }
            }
            releasePresenterLock(roomId, socket.id);
            if (activeRole !== 'presenter') decrementViewerCount(roomId);
            scheduleCleanup(roomId, { disconnecting: true });
          }
        });
      } else {
        if (activeRole === 'presenter') {
          const state = getSessionState(activeSessionId);
          if (state) {
            if (state.presenterSocketId === socket.id) {
              state.presenterDisconnectedAt = Date.now();
            }
            if (state._presenterLeftTimer) clearTimeout(state._presenterLeftTimer);
            const capturedSessionId = activeSessionId;
            state._presenterLeftTimer = setTimeout(() => {
              state._presenterLeftTimer = null;
              io.to(capturedSessionId).emit('presenter-left', { sessionId: capturedSessionId, locked: true });
            }, PRESENTER_LEFT_DEBOUNCE_MS);
          }
        }
        releasePresenterLock(activeSessionId, socket.id);
        if (activeRole !== 'presenter') decrementViewerCount(activeSessionId);
        scheduleCleanup(activeSessionId, { disconnecting: true });
      }
    });

    socket.on('disconnect', () => {
      releasePresenterLock(activeSessionId, socket.id);
      scheduleCleanup(activeSessionId);
      console.log('user disconnected');
    });
  });
}

// Only register handlers in production runtime
if (require.main === module) {
  registerSocketHandlers(io, { segmentVerseText, db, db_cebuano, db_tagalog, db_spanish, db_greek, db_ilocano, db_japanese, db_nrsvue, db_waray });
}

const start = async () => {
  try {
    const port = process.env.PORT || 3000 // default to 3095 if PORT is not set;
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`Server running on ${port}`)
    // Initialize FTS in background so health checks can pass immediately.
    // Skip in Electron — DBs are read-only (ASAR) and FTS tables are pre-built.
    if (!IS_ELECTRON_PKG) {
    setImmediate(() => {
      const forceRebuild = String(process.env.REBUILD_FTS_ON_START || 'false').toLowerCase() === 'true';
      const ftsOpts = { forceRebuild, log: fastify.log };
      initializeFts(dba, 'English', ftsOpts);
      initializeFts(dba_tagalog, 'Tagalog', ftsOpts);
      initializeFts(dba_cebuano, 'Cebuano', ftsOpts);
      initializeFts(dba_spanish, 'Spanish', ftsOpts);
      initializeFts(dba_greek,   'Greek', ftsOpts);
      initializeFts(dba_ilocano, 'Ilocano', ftsOpts);
      if (dba_japanese) initializeFts(dba_japanese, 'Japanese', ftsOpts);
      if (dba_nrsvue)   initializeFts(dba_nrsvue,   'NRSVUE', ftsOpts);
      if (dba_waray)    initializeFts(dba_waray,    'Waray', ftsOpts);
    });
    // Initialize semantic embeddings in background (resume-safe: skips already-stored rows)
    setImmediate(() => initEmbeddings());
    } // end !IS_ELECTRON_PKG
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}


// only start the server if the file is run directly; this makes the module importable for tests
if (require.main === module) {
  start();
}

// Entry point for Electron: registers socket handlers and starts the Fastify server.
// Call this AFTER setting process.env.DB_DIR / FRONTEND_DIST_DIR if needed.
async function startElectron() {
  registerSocketHandlers(io, { segmentVerseText, segmentVerseTextDual, db, db_cebuano, db_tagalog, db_spanish, db_greek, db_ilocano, db_japanese, db_nrsvue, db_waray });
  return start();
}

// ── Backward-compatible wrappers (bind default English DB for tests/exports) ─
const searchScriptureDefault = (input, page, pageSize) => searchScripture(input, page, pageSize, dba, fastify.log);
const searchScriptureInDbDefault = (input, page, pageSize, targetDb) => searchScriptureInDb(input, page, pageSize, targetDb, fastify.log);

module.exports = { parseScriptureReference, searchScripture: searchScriptureDefault, segmentVerseText, segmentVerseTextDual, fastify, registerSocketHandlers, startElectron };
