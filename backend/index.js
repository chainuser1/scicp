const fastify = require('fastify')({ logger: true });
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { BetterSqliteAdapter } = require('../shared/db-adapter');
const engine = require('../shared/scripture-engine');

const DB_DIR = process.env.DB_DIR || path.resolve(__dirname, '../resources/db');
const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST_DIR || path.resolve(__dirname, '../frontend/dist');
const USER_DATA_DIR = process.env.USER_DATA_DIR || DB_DIR;
// Inside Electron the DBs live in the read-only extraResources — open them
// as readonly so SQLite never attempts filesystem mutations.
const IS_ELECTRON_PKG = !!process.versions?.electron;
const DB_OPTS = { fileMustExist: true };
// In production and Electron, all FTS/embedding data is pre-built — skip any recomputation
const SKIP_RECOMPUTE = IS_ELECTRON_PKG || process.env.NODE_ENV === 'production';
const db = require('better-sqlite3')(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), DB_OPTS);
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

// Verse Embeddings DB — separate file so scripture DBs stay read-only.
// Pre-computed locally and committed via git-lfs; Railway just loads, never recomputes.
let db_embed = null;
try {
  if (SKIP_RECOMPUTE) {
    // Production/Electron: open read-only (pre-built, never write)
    db_embed = require('better-sqlite3')(path.join(DB_DIR, 'verse-embeddings.db'), { readonly: true, fileMustExist: true });
  } else {
    // Development: writable so local re-bake script can store results
    db_embed = require('better-sqlite3')(path.join(DB_DIR, 'verse-embeddings.db'));
    db_embed.exec(`
      CREATE TABLE IF NOT EXISTS verse_embeddings (
        verse_id INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL
      );
    `);
  }
} catch (err) {
  fastify.log.warn('[Embeddings] Could not open verse-embeddings.db:', err.message);
}

// Verse Tags DB — entity, POV, and doctrine tags (pre-baked)
let db_tags = null;
let db_chsummary = null;
let db_vsummary = null;   // verse-summaries.db (summary text)
let db_vxref = null;      // verse-cross-refs.db (cross references)
let db_graph = null;      // verse-graph.db (kNN, RWR, clusters)
let db_footnotes = null;  // footnotes-lds-summaries.db (NABRE + NET scholarly footnotes)
try {
  db_tags = require('better-sqlite3')(path.join(DB_DIR, 'verse-tags.db'), { readonly: true, fileMustExist: true });
} catch (_) {}
try {
  db_chsummary = require('better-sqlite3')(path.join(DB_DIR, 'chapter-summaries-fts.db'), { readonly: true, fileMustExist: true });
} catch (_) {}
try {
  db_vsummary = require('better-sqlite3')(path.join(DB_DIR, 'verse-summaries.db'), { readonly: true, fileMustExist: true });
} catch (_) {}
try {
  db_vxref = require('better-sqlite3')(path.join(DB_DIR, 'verse-cross-refs.db'), { readonly: true, fileMustExist: true });
} catch (_) {}
try {
  db_graph = require('better-sqlite3')(path.join(DB_DIR, 'verse-graph.db'), { readonly: true, fileMustExist: true });
} catch (_) {}
try {
  db_footnotes = require('better-sqlite3')(path.join(DB_DIR, 'footnotes-lds-summaries.db'), { readonly: true, fileMustExist: true });
} catch (_) {}
// If not found (dev mode), create writable
if (!db_tags) {
  try {
    db_tags = require('better-sqlite3')(path.join(DB_DIR, 'verse-tags.db'));
    db_tags.exec(`
      CREATE TABLE IF NOT EXISTS chapter_entities (
        chapter_id  INTEGER PRIMARY KEY,
        people      TEXT,
        places      TEXT,
        entities_json TEXT
      );
      CREATE TABLE IF NOT EXISTS verse_doctrine_tags (
        verse_id    INTEGER PRIMARY KEY,
        chapter_id  INTEGER,
        chapter_num INTEGER,
        pov         TEXT,
        labels_json TEXT,
        speaker     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chapter_entities_people ON chapter_entities(people);
      CREATE INDEX IF NOT EXISTS idx_chapter_entities_places ON chapter_entities(places);
    `);
  } catch (err) {
    fastify.log.warn('[Tags] Could not open verse-tags.db:', err.message);
  }
}

const dba          = new BetterSqliteAdapter(db);
const dba_tagalog  = new BetterSqliteAdapter(db_tagalog);
const dba_cebuano  = new BetterSqliteAdapter(db_cebuano);
const dba_spanish  = new BetterSqliteAdapter(db_spanish);
const dba_greek    = new BetterSqliteAdapter(db_greek);
const dba_ilocano  = new BetterSqliteAdapter(db_ilocano);
let dba_japanese   = db_japanese ? new BetterSqliteAdapter(db_japanese) : null;
let dba_nrsvue     = db_nrsvue   ? new BetterSqliteAdapter(db_nrsvue)   : null;
let dba_waray      = db_waray    ? new BetterSqliteAdapter(db_waray)    : null;

// ── Scripture synonym dictionary (offline, pre-baked) ──
let scriptureSynonyms = {};
try { scriptureSynonyms = require('../shared/scripture-synonyms.json'); } catch (_) {}

// ── Concept embeddings DB (pre-baked by scripts/build-concept-index.js) ──
let db_concepts = null;
const conceptCache = []; // { phrase, source, vec: Float32Array(384) }
try {
  db_concepts = require('better-sqlite3')(path.join(DB_DIR, 'concept-embeddings.db'), { readonly: true, fileMustExist: true });
  const rows = db_concepts.prepare('SELECT phrase, source, embedding FROM concepts').all();
  for (const r of rows) {
    conceptCache.push({
      phrase: r.phrase,
      source: r.source,
      vec: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
    });
  }
  db_concepts.close();
  db_concepts = null;
  fastify.log.info(`[Concepts] Loaded ${conceptCache.length} concept embeddings`);
} catch (_) {
  // concept-embeddings.db not yet built — concept expansion disabled
}

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

const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');

fastify.register(require('@fastify/cors'), {
  origin: "*",
});

fastify.register(fastifyStatic, {
  root: FRONTEND_DIST_DIR,
  prefix: '/',
});

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
  const proto = request.headers['x-forwarded-proto'] || request.protocol;
  const publicOrigin =
    process.env.PUBLIC_ORIGIN ||
    `${proto}://${request.hostname}`;
  return { publicOrigin };
});

// ── /db/:filename — serve scripture DB files for on-demand language downloads.
//    Only allows known .db files from the DB_DIR; prevents path traversal.
const DOWNLOADABLE_DBS = new Set([
  'tagalog-scriptures-sqlite.db',
  'cebuano-scriptures-sqlite.db',
  'spanish-scriptures-sqlite.db',
  'greek-scriptures-sqlite.db',
  'ilocano-scriptures-sqlite.db',
  'japanese-scriptures-sqlite.db',
  'nrsvue-scriptures-sqlite.db',
  'waray-scriptures-sqlite.db',
]);
fastify.get('/db/:filename', async (request, reply) => {
  const { filename } = request.params;
  if (!DOWNLOADABLE_DBS.has(filename)) {
    return reply.code(404).send({ error: 'Not found' });
  }
  const filePath = path.join(DB_DIR, filename);
  try {
    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', stat.size)
      .header('Cache-Control', 'public, max-age=86400')
      .send(stream);
  } catch {
    return reply.code(404).send({ error: 'Not found' });
  }
});

fastify.get('/setlists', async (request, reply) => {
  const rows = db_user.prepare('SELECT id, name, items, created_at FROM setlists ORDER BY created_at DESC').all();
  return rows.map(r => ({ id: r.id, name: r.name, items: JSON.parse(r.items), created_at: r.created_at }));
});

fastify.post('/setlists', async (request, reply) => {
  const { name, items } = request.body;
  if (!name) { reply.code(400); return { error: 'name is required' }; }
  try {
    const stmt = db_user.prepare('INSERT INTO setlists (name, items) VALUES (?, ?)');
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
    db_user.prepare('UPDATE setlists SET name = ?, items = ? WHERE id = ?')
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
    db_user.prepare('DELETE FROM setlists WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not delete setlist' };
  }
});

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

// HTTP search endpoint (used by mobile sub-searches in context modals)
fastify.get('/search', async (request, reply) => {
  const { q, language = 'en', page: pStr = '0', pageSize: psStr = '10', contextVerseId: cvidStr, cursor: cursorStr } = request.query;
  if (!q || !q.trim()) { reply.code(400); return { error: 'q is required' }; }
  const pageSize = Math.min(50, Math.max(1, parseInt(psStr, 10) || 10));
  const contextVerseId = cvidStr ? (Number(cvidStr) || null) : null;
  const lang = (language || 'en').toLowerCase().trim();
  try {
    let offset = 0;
    let pipelineResults, total, cacheKey;

    if (cursorStr) {
      const decoded = decodeCursor(cursorStr);
      if (decoded) {
        const cached = searchCacheGet(decoded.k);
        if (cached) {
          offset          = decoded.o;
          pipelineResults = cached.results;
          total           = cached.total;
          cacheKey        = decoded.k;
        }
      }
      if (!pipelineResults) {
        const fresh = await runSearchPipeline(q.trim(), lang, contextVerseId, fastify.log);
        pipelineResults = fresh.results; total = fresh.total; cacheKey = fresh.cacheKey; offset = 0;
      }
    } else {
      // Legacy page= support
      const page = Math.max(0, parseInt(pStr, 10) || 0);
      const fresh = await runSearchPipeline(q.trim(), lang, contextVerseId, fastify.log);
      pipelineResults = fresh.results; total = fresh.total; cacheKey = fresh.cacheKey;
      offset = page * pageSize;
    }

    const pageResults = pipelineResults.slice(offset, offset + pageSize);
    const nextOffset  = offset + pageResults.length;
    const hasMore     = nextOffset < total;
    const nextCursor  = hasMore ? encodeCursor(cacheKey, nextOffset, total) : null;
    const page        = Math.floor(offset / pageSize);

    return { results: pageResults, total, nextCursor, page, pageSize, query: q, language: lang };
  } catch (err) {
    fastify.log.error({ err }, '/search failed');
    reply.code(500);
    return { results: [], total: 0, nextCursor: null, page: 0, pageSize };
  }
});

// ── Search Suggestions (autocomplete) ────────────────────────────────────────
fastify.get('/suggest', async (request, reply) => {
  const { q, limit: lStr = '8' } = request.query;
  if (!q || q.trim().length < 2) return { suggestions: [] };
  const limit = Math.min(15, Math.max(1, parseInt(lStr, 10) || 8));
  const term  = q.trim().toLowerCase();
  try {
    // 1. FTS vocab prefix match
    const vocabRows = db.prepare(
      `SELECT DISTINCT term FROM scriptures_fts_vocab
       WHERE term LIKE ? AND length(term) > 2
       ORDER BY doc DESC LIMIT ?`
    ).all(`${term}%`, limit);

    // 2. Book title match
    const bookRows = db.prepare(
      `SELECT book_title AS term FROM books
       WHERE lower(book_title) LIKE ? LIMIT 5`
    ).all(`%${term}%`);

    // 3. Doctrine aliases (keys starting with the typed prefix)
    const DOCTRINE_ALIASES = {};
    const aliasMatches = Object.keys(DOCTRINE_ALIASES)
      .filter(k => k.startsWith(term))
      .slice(0, 3)
      .map(k => ({ term: k }));

    const seen = new Set();
    const suggestions = [...vocabRows, ...bookRows, ...aliasMatches]
      .map(r => r.term)
      .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; })
      .slice(0, limit);

    return { suggestions };
  } catch (err) {
    fastify.log.warn({ err }, '/suggest failed');
    return { suggestions: [] };
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

// Writable user-data DB for setlists (lives outside read-only resources)
const db_user = require('better-sqlite3')(path.join(USER_DATA_DIR, 'user-data.db'));
db_user.exec(`
  CREATE TABLE IF NOT EXISTS setlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    items      TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
`);

// Build the FTS table once (or when explicitly forced) instead of rebuilding every startup.
// Uses the shared engine's initializeFts via adapters.
const { initializeFts, segmentVerseText, segmentVerseTextDual, parseScriptureReference,
        searchScripture, searchScriptureInDb, getAdjacentVerse, fetchVerseByCoords,
        getVersionCitation, getVerseOfTheDay, VOTD_POOL, phraseSearch,
        BIBLE_CITATIONS, TRIPLE_CITATIONS, LANGUAGE_NAMES } = engine;

const REBUILD_EMBEDDINGS = process.env.REBUILD_EMBEDDINGS === 'true';
const EMBED_BATCH_SIZE   = 50;

let embeddingsReady     = false;
let embeddingPipe       = null;  // transformer pipeline (loaded in dev; null in production)
const embeddingCache    = new Map(); // verse_id → Float32Array(384)
const entityCentroidCache = new Map(); // entity_id → Float32Array(384)
const verseMetaCache    = new Map(); // verse_id → { chapter_id, scripture_text }

// Topical Guide caches (populated at startup if topical-guide.db is present)
const verseTopicCache  = new Map(); // verse_id → Set<topic_slug>
const topicVerseIndex  = new Map(); // topic_slug → Set<verse_id>  (reverse index)
const topicNameMap     = new Map(); // topic_slug → topic_name (display)
const pageRankCache    = new Map(); // verse_id → PageRank score
let topicalGuideReady = false;

function buildTopicalGuideCache() {
  if (!db_tg) return;
  try {
    // Try pre-baked topic indexes first
    const hasPreBaked = db_tg.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='topic_verse_index'").get()?.n > 0;
    if (hasPreBaked) {
      // Load topic names
      const topics = db_tg.prepare('SELECT id, slug, name FROM topics').all();
      for (const t of topics) topicNameMap.set(t.slug, t.name);

      // Load pre-baked verse → topics from verse_topics table
      const vtRows = db_tg.prepare('SELECT verse_id, topic_slugs FROM verse_topics').all();
      for (const r of vtRows) {
        const slugs = JSON.parse(r.topic_slugs);
        verseTopicCache.set(r.verse_id, new Set(slugs));
      }

      // Load pre-baked topic → verses from topic_verse_index
      const tiRows = db_tg.prepare('SELECT topic_slug, verse_id FROM topic_verse_index').all();
      for (const r of tiRows) {
        if (!topicVerseIndex.has(r.topic_slug)) topicVerseIndex.set(r.topic_slug, new Set());
        topicVerseIndex.get(r.topic_slug).add(r.verse_id);
      }

      // Load PageRank scores if available
      try {
        const prRows = db_tg.prepare('SELECT verse_id, pagerank FROM verse_pagerank').all();
        for (const r of prRows) pageRankCache.set(r.verse_id, r.pagerank);
        fastify.log.info(`[PageRank] Loaded ${pageRankCache.size} scores`);
      } catch {}

      topicalGuideReady = true;
      fastify.log.info(`[TG] Pre-baked: ${topicNameMap.size} topics, ${verseTopicCache.size} verses`);
      return;
    }
  } catch {}
  // Fallback: runtime build
  try {
    const tcount = db_tg.prepare('SELECT COUNT(*) AS c FROM topical_guide WHERE verse_id IS NOT NULL AND verse_id != -1').get().c;
    if (tcount === 0) return;
    const topics = db_tg.prepare('SELECT id, slug, name FROM topics').all();
    const topicSlugById = new Map();
    for (const t of topics) {
      topicNameMap.set(t.slug, t.name);
      topicSlugById.set(t.id, t.slug);
    }
    const rows = db_tg.prepare('SELECT topic_id, verse_id FROM topical_guide WHERE verse_id IS NOT NULL AND verse_id != -1').all();
    for (const r of rows) {
      const slug = topicSlugById.get(r.topic_id);
      if (!slug) continue;
      let s = verseTopicCache.get(r.verse_id);
      if (!s) { s = new Set(); verseTopicCache.set(r.verse_id, s); }
      s.add(slug);
      let rv = topicVerseIndex.get(slug);
      if (!rv) { rv = new Set(); topicVerseIndex.set(slug, rv); }
      rv.add(r.verse_id);
    }
    topicalGuideReady = true;
    fastify.log.info(`Topical Guide loaded: ${topicNameMap.size} topics, ${verseTopicCache.size} verses mapped`);
  } catch (err) {
    fastify.log.warn('Topical Guide cache build failed (non-fatal):', err.message);
  }
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

// ── Entity Disambiguation Scorer ──────────────────────────────────────────
// Combines cosine similarity, Bayesian prior, and spatial proximity
// to rank candidate entities for a given context verse.
//
// score = α·cos(θ_ve) + β·log(1+N)/log(1+N_max) + γ·e^(-λ·|d|/D_max)
//
//   cos(θ_ve)  : cosine similarity between verse embedding and entity centroid
//   N / N_max  : entity verse count normalised by largest entity
//   d / D_max  : verse distance normalised by chapter span
//   α,β,γ,λ   : tunable weights
//
const ENTITY_SCORE_ALPHA  = 0.55;  // cosine similarity weight
const ENTITY_SCORE_BETA   = 0.15;  // Bayesian prior weight
const ENTITY_SCORE_GAMMA  = 0.30;  // proximity decay weight
const ENTITY_DECAY_LAMBDA = 3.0;   // exponential decay rate

function scoreEntityCandidates(candidates, verseId, verseEmbedding) {
  if (candidates.length <= 1) return candidates;

  // N_max for normalisation
  const nMax = Math.max(...candidates.map(c => c.verse_count), 1);

  // Get verse IDs in the chapter for proximity scoring
  let chapterVerseIds = null;
  try {
    const chRow = dba.prepare('SELECT chapter_id FROM scriptures WHERE verse_id = ?').get(verseId);
    if (chRow) {
      chapterVerseIds = dba.prepare('SELECT verse_id FROM scriptures WHERE chapter_id = ? ORDER BY verse_id')
        .all(chRow.chapter_id).map(r => r.verse_id);
    }
  } catch { /* ignore */ }

  for (const c of candidates) {
    let cosScore = 0, priorScore = 0, proxScore = 0;

    // ── Cosine similarity: cos(θ) between verse embedding and entity centroid ──
    if (verseEmbedding) {
      const centroid = entityCentroidCache.get(c.entity_id);
      if (centroid) {
        cosScore = cosineSimilarity(verseEmbedding, centroid);
        // Clamp to [0,1] (already normalised vectors, but just in case)
        cosScore = Math.max(0, Math.min(1, (cosScore + 1) / 2));
      }
    }

    // ── Bayesian prior: log-normalised verse frequency ──
    priorScore = Math.log(1 + c.verse_count) / Math.log(1 + nMax);

    // ── Spatial proximity: exponential decay by distance to nearest mapped verse ──
    if (chapterVerseIds && verseId) {
      const entityVids = db_tags
        ? db_tags.prepare('SELECT verse_id FROM ai_entity_verse_map WHERE entity_id = ? AND verse_id BETWEEN ? AND ?')
            .all(c.entity_id, chapterVerseIds[0], chapterVerseIds[chapterVerseIds.length - 1])
            .map(r => r.verse_id)
        : [];
      if (entityVids.length > 0) {
        const minDist = Math.min(...entityVids.map(v => Math.abs(v - verseId)));
        const dMax = Math.max(chapterVerseIds.length, 1);
        // e^(-λ · |d|/D_max) — decays smoothly from 1.0 (same verse) to ~0.05 (chapter edge)
        proxScore = Math.exp(-ENTITY_DECAY_LAMBDA * minDist / dMax);
      }
    }

    c._score = ENTITY_SCORE_ALPHA * cosScore
             + ENTITY_SCORE_BETA  * priorScore
             + ENTITY_SCORE_GAMMA * proxScore;
    c._cosine = cosScore;
    c._prior  = priorScore;
    c._prox   = proxScore;
  }

  candidates.sort((a, b) => b._score - a._score);
  return candidates;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MATHEMATICAL SEARCH ENGINE
//  Uses: RRF, Sigmoid confidence, IDF weighting, MMR diversity,
//        chapter aggregation, Bayesian topic scoring
// ═══════════════════════════════════════════════════════════════════════════

// ── IDF / LLR table (Statistics): term importance weights ──
const TOTAL_DOCS = 41995;     // total English verses
let idfStmt = null;
let llrStmt = null;
let pmiStmt = null;
let pprStmt = null;
let rwrStmt = null;
const IDF_DEFAULT = Math.log(TOTAL_DOCS / 100);

function initIdfLookup() {
  const rawDb = dba.raw || dba._db;
  // LLR table (preferred over IDF — statistically rigorous term importance)
  try {
    const llrCount = rawDb.prepare('SELECT COUNT(*) AS n FROM term_llr').get().n;
    llrStmt = rawDb.prepare('SELECT llr, idf, burstiness FROM term_llr WHERE term = ?');
    fastify.log.info(`[LLR] Pre-baked table ready: ${llrCount} terms`);
  } catch {
    fastify.log.info('[LLR] Table not found, will use IDF only');
  }
  // IDF table
  try {
    const count = rawDb.prepare('SELECT COUNT(*) AS n FROM term_idf').get().n;
    idfStmt = rawDb.prepare('SELECT idf FROM term_idf WHERE term = ?');
    fastify.log.info(`[IDF] Pre-baked table ready: ${count} terms`);
  } catch (err) {
    fastify.log.warn('[IDF] Pre-baked table not found, falling back to runtime:', err.message);
    const idfFallback = new Map();
    try {
      const rows = rawDb.prepare('SELECT term, doc FROM scriptures_fts_vocab').all();
      for (const r of rows) idfFallback.set(r.term, Math.log((TOTAL_DOCS + 1) / (r.doc + 1)) + 1);
      idfStmt = { get: (term) => ({ idf: idfFallback.get(term) }) };
      fastify.log.info(`[IDF] Fallback table built: ${idfFallback.size} terms`);
    } catch {}
  }
  // PMI query expansion table
  try {
    const pmiCount = rawDb.prepare('SELECT COUNT(*) AS n FROM term_pmi').get().n;
    pmiStmt = rawDb.prepare('SELECT assoc, pmi, cooccur FROM term_pmi WHERE term = ? ORDER BY pmi DESC LIMIT 5');
    fastify.log.info(`[PMI] Pre-baked table ready: ${pmiCount} associations`);
  } catch {
    fastify.log.info('[PMI] Table not found, using synonym-only expansion');
  }
}

function initPprLookup() {
  // Topic-Personalized PageRank
  if (!db_tg) return;
  try {
    const pprCount = db_tg.prepare('SELECT COUNT(*) AS n FROM topic_ppr').get().n;
    pprStmt = db_tg.prepare('SELECT verse_id, ppr FROM topic_ppr WHERE topic_slug = ? ORDER BY ppr DESC LIMIT 200');
    fastify.log.info(`[PPR] Pre-baked table ready: ${pprCount} rows`);
  } catch {
    fastify.log.info('[PPR] Table not found, using global PageRank only');
  }
}

function initRwrLookup() {
  // Random Walk with Restart related verses (from verse-graph.db)
  if (!db_graph) return;
  try {
    const rwrCount = db_graph.prepare('SELECT COUNT(*) AS n FROM verse_rwr').get().n;
    rwrStmt = db_graph.prepare('SELECT neighbor_id, rwr_score FROM verse_rwr WHERE verse_id = ? ORDER BY rank');
    fastify.log.info(`[RWR] Pre-baked table ready: ${rwrCount} rows`);
  } catch {
    fastify.log.info('[RWR] Table not found, using kNN only');
  }
}

function getIdf(term) {
  if (!idfStmt) return IDF_DEFAULT;
  const row = idfStmt.get(term.toLowerCase());
  return row?.idf ?? IDF_DEFAULT;
}

// LLR-weighted term importance: combines LLR surprise + burstiness
// Returns composite weight that's better than IDF alone
function getTermWeight(term) {
  const t = term.toLowerCase();
  if (llrStmt) {
    const row = llrStmt.get(t);
    if (row) {
      // Combine: log(LLR+1) for surprise, burstiness for topical concentration
      // Normalize LLR to roughly same scale as IDF (IDF ∈ [1, 11])
      const llrNorm = Math.log(row.llr + 1) / 2;  // ~0-6 range
      const burstBonus = Math.min(row.burstiness, 5) * 0.3; // topical terms get extra
      return llrNorm + burstBonus + row.idf * 0.5;
    }
  }
  return getIdf(t);
}

// LLR-weighted query importance: returns Map<term, weight> normalized to sum=1
function queryTermWeights(query) {
  const terms = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
  const weights = new Map();
  let total = 0;
  for (const t of terms) {
    const w = getTermWeight(t);
    weights.set(t, w);
    total += w;
  }
  if (total > 0) {
    for (const [t, w] of weights) weights.set(t, w / total);
  }
  return weights;
}

// Detect significant phrases in query using pre-baked bigram LLR scores.
// Chains overlapping significant bigrams into longer phrases (trigrams, 4-grams, etc.)
// e.g., "thou art" + "art my" + "my son" → "thou art my son"
// Also includes the full query as a candidate if 3+ words.
function detectSignificantPhrases(query) {
  if (!llrStmt) return [];
  const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
  if (words.length < 2) return [];

  // Step 1: find which adjacent bigrams are significant
  const sigBigrams = []; // array of booleans: sigBigrams[i] = true if words[i]+words[i+1] is significant
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + ' ' + words[i + 1];
    let sig = false;
    try {
      const row = llrStmt.get(bigram);
      if (row && row.llr > 10) sig = true;
    } catch {}
    sigBigrams.push(sig);
  }

  // Step 2: chain overlapping significant bigrams into longer phrases
  // If bigrams at positions [0,1,2] are all significant → words[0..3] form a 4-gram
  const phrases = [];
  let chainStart = -1;
  for (let i = 0; i <= sigBigrams.length; i++) {
    if (i < sigBigrams.length && sigBigrams[i]) {
      if (chainStart === -1) chainStart = i;
    } else {
      if (chainStart !== -1) {
        const chainEnd = i; // last significant bigram was at i-1, covering words[i-1..i]
        const phrase = words.slice(chainStart, chainEnd + 1).join(' ');
        // Also include sub-bigrams for shorter phrase matching
        if (chainEnd - chainStart >= 2) {
          // This is a 3+ word phrase — add it
          phrases.push({ phrase, llr: 0, len: chainEnd - chainStart + 1 });
        }
        // Add constituent bigrams too
        for (let j = chainStart; j < chainEnd; j++) {
          phrases.push({ phrase: words[j] + ' ' + words[j + 1], llr: 0, len: 2 });
        }
        chainStart = -1;
      }
    }
  }

  // Step 3: always try the full query as an exact phrase for 2+ word queries
  const fullPhrase = words.join(' ');
  if (!phrases.some(p => p.phrase === fullPhrase)) {
    phrases.push({ phrase: fullPhrase, llr: 0, len: words.length });
  }

  // Deduplicate and sort: longer phrases first (more specific)
  const seen = new Set();
  return phrases.filter(p => {
    if (seen.has(p.phrase)) return false;
    seen.add(p.phrase);
    return true;
  }).sort((a, b) => b.len - a.len);
}

// PMI-based query expansion: find statistically associated terms
// Now handles both unigrams AND bigrams (phrase-aware)
function expandWithPmi(query) {
  if (!pmiStmt) return [];
  const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
  const expansions = new Map(); // term → max PMI score

  // Expand individual words
  for (const w of words) {
    try {
      const rows = pmiStmt.all(w);
      for (const r of rows) {
        if (r.cooccur >= 5 && r.pmi > 0.15) {
          const existing = expansions.get(r.assoc) || 0;
          if (r.pmi > existing) expansions.set(r.assoc, r.pmi);
        }
      }
    } catch {}
  }

  // Expand detected bigrams (phrase-aware expansion)
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + ' ' + words[i + 1];
    try {
      const rows = pmiStmt.all(bigram);
      for (const r of rows) {
        if (r.cooccur >= 3 && r.pmi > 0.10) {
          // Bigram associations are higher quality — slightly lower threshold
          const existing = expansions.get(r.assoc) || 0;
          if (r.pmi > existing) expansions.set(r.assoc, r.pmi);
        }
      }
    } catch {}
  }

  // Return sorted by PMI, excluding original query terms
  const querySet = new Set(words);
  return [...expansions.entries()]
    .filter(([t]) => !querySet.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, pmi]) => ({ term: t, pmi }));
}

// ── Sigmoid / Softmax confidence gate (Calculus) ──
// σ(x) = 1 / (1 + e^(-α(x - θ)))
// Returns [0,1]: how confident we are that FTS results are sufficient
function sigmoidConfidence(topBm25Score, resultCount) {
  // BM25 scores are negative in SQLite (lower = better); normalize to positive
  const normalizedScore = topBm25Score ? Math.abs(topBm25Score) : 0;
  // Score component: high absolute BM25 → high confidence
  const scoreConf = 1 / (1 + Math.exp(-2 * (normalizedScore - 5)));
  // Count component: many results → high confidence
  const countConf = 1 / (1 + Math.exp(-0.15 * (resultCount - 15)));
  // Combined: geometric mean
  return Math.sqrt(scoreConf * countConf);
}

// ── Reciprocal Rank Fusion (Algebra): merge ranked lists without weight tuning ──
// score(d) = Σ_source 1/(k + rank_in_source)   k=60 (Cormack et al. 2009)
const RRF_K = 60;
function reciprocalRankFusion(rankedLists, queryTopicSlugs = [], listWeights = null) {
  const scores = new Map(); // verse_id → { rrfScore, row, sources: Set }
  for (let li = 0; li < rankedLists.length; li++) {
    const list = rankedLists[li];
    const w = (listWeights && listWeights[li]) || 1;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const vid = item.verse_id;
      const rrf = w / (RRF_K + i + 1);
      if (scores.has(vid)) {
        const entry = scores.get(vid);
        entry.rrfScore += rrf;
        entry.sources.add(item._source || 'unknown');
      } else {
        scores.set(vid, {
          rrfScore: rrf,
          row: item,
          sources: new Set([item._source || 'unknown']),
        });
      }
    }
  }
  // Multi-source bonus: verses found in 2+ sources get a boost (cross-validation signal)
  for (const [vid, entry] of scores) {
    if (entry.sources.size >= 3) entry.rrfScore *= 1.4;
    else if (entry.sources.size >= 2) entry.rrfScore *= 1.2;

    // Topic-Personalized PageRank boost (query-aware authority)
    // PPR values ~0.001-0.04; RRF scores ~0.01-0.05; use as gentle re-rank signal
    if (pprStmt && queryTopicSlugs.length > 0) {
      let bestPpr = 0;
      for (const slug of queryTopicSlugs) {
        try {
          const row = db_tg.prepare('SELECT ppr FROM topic_ppr WHERE topic_slug = ? AND verse_id = ?').get(slug, vid);
          if (row && row.ppr > bestPpr) bestPpr = row.ppr;
        } catch {}
      }
      if (bestPpr > 0) entry.rrfScore += bestPpr * 0.5; // ~0.0005-0.02 boost
    }

    // Fallback: global PageRank bonus (smaller weight since PPR is more targeted)
    const pr = pageRankCache.get(vid);
    if (pr) entry.rrfScore += pr * 1000;
  }
  return scores;
}

// ── Maximal Marginal Relevance (Linear Algebra): diversity-aware reranking ──
// MMR(d) = λ·sim(d,q) − (1−λ)·max_j(sim(d, d_j_selected))
// λ=0.7 balances relevance (70%) vs diversity (30%)
function mmrRerank(candidates, qvec, lambda = 0.7, limit = 50) {
  if (!qvec || !embeddingsReady || candidates.length <= 1) return candidates;

  // Pre-limit to top candidates by RRF score for performance
  const topN = Math.min(candidates.length, Math.max(limit * 2, 100));
  const pool = candidates.slice(0, topN).map(c => {
    const vec = embeddingCache.get(c.verse_id);
    return {
      ...c,
      _vec: vec || null,
      simToQuery: vec ? cosineSimilarity(qvec, vec) : (c.similarity_score || 0),
    };
  });

  const selected = [];
  const selVecs = []; // cache selected vectors

  while (selected.length < limit && pool.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxSimToSelected = 0;
      // Only compare against recent selections (last 8) for speed
      if (cand._vec && selVecs.length > 0) {
        const checkLen = Math.min(selVecs.length, 8);
        for (let j = selVecs.length - checkLen; j < selVecs.length; j++) {
          if (selVecs[j]) {
            const sim = cosineSimilarity(cand._vec, selVecs[j]);
            if (sim > maxSimToSelected) maxSimToSelected = sim;
          }
        }
      }
      const mmr = lambda * cand.simToQuery - (1 - lambda) * maxSimToSelected;
      const combined = mmr + (cand._rrfScore || 0) * 2.0;
      if (combined > bestMmr) {
        bestMmr = combined;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const chosen = pool.splice(bestIdx, 1)[0];
      selVecs.push(chosen._vec);
      selected.push(chosen);
    } else break;
  }
  return selected;
}

// ── Chapter aggregation (Statistics): surface hidden gems via chapter-level scoring ──
// chapterScore = Σ verseScores / √n (Luhn normalization)
function chapterAggregate(verseScores) {
  const chapters = new Map(); // chapter_id → { verses: [], totalScore, bestVerse }
  for (const [vid, entry] of verseScores) {
    const meta = verseMetaCache.get(vid);
    if (!meta) continue;
    const chId = meta.chapter_id;
    if (!chapters.has(chId)) {
      chapters.set(chId, { verses: [], totalScore: 0, bestVerse: null, bestScore: 0 });
    }
    const ch = chapters.get(chId);
    ch.verses.push(vid);
    ch.totalScore += entry.rrfScore;
    if (entry.rrfScore > ch.bestScore) {
      ch.bestScore = entry.rrfScore;
      ch.bestVerse = vid;
    }
  }
  // Normalize by √n to avoid bias toward long chapters
  const chapterScores = [];
  for (const [chId, ch] of chapters) {
    const normalized = ch.totalScore / Math.sqrt(ch.verses.length);
    chapterScores.push({ chapterId: chId, score: normalized, bestVerse: ch.bestVerse, verseCount: ch.verses.length });
  }
  chapterScores.sort((a, b) => b.score - a.score);
  return chapterScores;
}

// ── Semantic search: embed query text → cosine similarity against all verses ──
async function semanticSearch(query, page = 0, pageSize = 10, excludeIds = new Set(), qvec = null) {
  if (!embeddingsReady || !embeddingPipe) return null;
  try {
    if (!qvec) {
      const out = await embeddingPipe(query, { pooling: 'mean', normalize: true });
      qvec = new Float32Array(out.data);
    }
    const scores = [];
    for (const [vid, vvec] of embeddingCache) {
      if (excludeIds.has(vid)) continue;
      scores.push({ verse_id: vid, score: cosineSimilarity(qvec, vvec) });
    }
    scores.sort((a, b) => b.score - a.score);
    const offset = page * pageSize;
    const paged = scores.slice(offset, offset + pageSize);
    const stmtVerse = dba.prepare(`
      SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id
      FROM scriptures WHERE verse_id = ?
    `);
    const results = paged.map(({ verse_id, score }) => {
      const row = stmtVerse.get(verse_id);
      return row ? { ...row, similarity_score: +score.toFixed(4) } : null;
    }).filter(Boolean);
    return { results, total: Math.min(scores.length, 200), page, pageSize, semantic: true };
  } catch (err) {
    fastify.log.warn('[SemanticSearch] failed:', err.message);
    return null;
  }
}

// ── #2 Synonym expansion: expand query terms using scripture-synonyms.json ──
function expandWithSynonyms(query) {
  const words = query.toLowerCase().split(/\s+/);
  const expanded = new Set(words);
  const lowerQuery = query.toLowerCase();
  for (const key of Object.keys(scriptureSynonyms)) {
    if (key.includes(' ') && lowerQuery.includes(key)) {
      for (const syn of scriptureSynonyms[key]) expanded.add(syn);
    }
  }
  for (const w of words) {
    const stems = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ed$/, ''),
                   w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/eth$/, ''),
                   w.replace(/eth$/, 'e'), w + 's'];
    for (const stem of stems) {
      if (scriptureSynonyms[stem]) {
        for (const syn of scriptureSynonyms[stem]) expanded.add(syn);
        break;
      }
    }
  }
  return [...expanded];
}

// ── #3 Concept expansion via MiniLM: find nearest pre-embedded concepts ──
async function expandWithConcepts(query, topN = 5, qvec = null) {
  if (!embeddingPipe || !conceptCache.length) return [];
  try {
    if (!qvec) {
      const out = await embeddingPipe(query, { pooling: 'mean', normalize: true });
      qvec = new Float32Array(out.data);
    }
    const scored = conceptCache.map(c => ({
      phrase: c.phrase,
      source: c.source,
      score: cosineSimilarity(qvec, c.vec),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN).filter(s => s.score > 0.4);
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MULTI-SOURCE FUSION with RRF + IDF + Chapter Aggregation
// ═══════════════════════════════════════════════════════════════════════════
function multiSourceFusion(query, expandedQuery, pageSize) {
  const stmtVerse = dba.prepare(`
    SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id
    FROM scriptures WHERE verse_id = ?
  `);
  const termWeights = queryTermWeights(query);

  // ── Detect significant phrases in query ──
  const detectedPhrases = detectSignificantPhrases(query);

  // ── PMI expansion: augment query with statistically associated terms ──
  const pmiTerms = expandWithPmi(query);
  let pmiExpandedQuery = expandedQuery;
  if (pmiTerms.length > 0) {
    const pmiWords = pmiTerms.map(t => t.term);
    pmiExpandedQuery = [...new Set([...expandedQuery.split(/\s+/), ...pmiWords])].join(' ');
  }

  // ── Source A: Scripture FTS (BM25) — primary keyword source ──
  const ftsResult = searchScripture(query, 0, 50, dba, fastify.log);
  const ftsRanked = ftsResult.results.map(r => ({
    ...r, _source: 'fts', _bm25: r._bm25_rank || 0,
  }));

  // BM25F: boost verses whose doctrine tags or speaker match the query
  if (db_tags && ftsRanked.length > 0) {
    const queryLower = query.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 2));
    if (queryWords.size > 0) {
      for (const row of ftsRanked) {
        let fieldBoost = 1.0;
        try {
          const tagRow = db_tags.prepare('SELECT labels_json, speaker FROM verse_doctrine_tags WHERE verse_id = ?').get(row.verse_id);
          if (tagRow) {
            const labels = JSON.parse(tagRow.labels_json || '[]');
            const labelText = labels.join(' ').toLowerCase();
            const speakerText = (tagRow.speaker || '').toLowerCase();
            for (const w of queryWords) {
              if (labelText.includes(w)) fieldBoost += 0.3;
              if (speakerText.includes(w)) fieldBoost += 0.2;
            }
          }
        } catch {}
        row._bm25_rank = (row._bm25_rank || 0) * fieldBoost;
        row._bm25 = row._bm25_rank;
      }
      ftsRanked.sort((a, b) => (b._bm25 || 0) - (a._bm25 || 0));
    }
  }

  // ── Source A2: Exact phrase FTS — separate RRF lane for phrase matches ──
  const phraseRanked = [];
  if (detectedPhrases.length > 0) {
    const seen = new Set();
    for (const { phrase } of detectedPhrases) {
      try {
        const phraseQuery = '"' + phrase + '"';
        const phraseResult = searchScripture(phraseQuery, 0, 30, dba, fastify.log);
        for (const r of phraseResult.results) {
          if (!seen.has(r.verse_id)) {
            phraseRanked.push({ ...r, _source: 'fts-phrase', _bm25: r._bm25_rank || 0 });
            seen.add(r.verse_id);
          }
        }
      } catch {}
    }
  }

  // Also search with expanded synonyms + PMI terms
  if (pmiExpandedQuery && pmiExpandedQuery !== query.toLowerCase()) {
    const expResult = searchScripture(pmiExpandedQuery, 0, 30, dba, fastify.log);
    const seen = new Set(ftsRanked.map(r => r.verse_id));
    for (const r of expResult.results) {
      if (!seen.has(r.verse_id)) {
        ftsRanked.push({ ...r, _source: 'fts', _bm25: r._bm25_rank || 0 });
        seen.add(r.verse_id);
      }
    }
  }

  // ── Source B: Chapter summaries FTS — finds chapters thematically about the topic ──
  const summaryRanked = [];
  if (db_chsummary) {
    try {
      const cleanQ = query.replace(/[^a-zA-Z0-9\-\s]/g, ' ').trim();
      const terms = cleanQ.split(/\s+/).filter(t => t.length > 1).map(t => `${t}*`).join(' OR ');
      if (terms) {
        const sumRows = db_chsummary.prepare(`
          SELECT cs.chapter_id, cs.book_id, cs.chapter_num, fts.rank
          FROM chapter_summaries_fts fts
          JOIN chapter_summaries cs ON cs.rowid = fts.rowid
          WHERE chapter_summaries_fts MATCH ?
          ORDER BY fts.rank LIMIT 15
        `).all(terms);
        for (const sr of sumRows) {
          // Get all verses from matching chapter (for chapter aggregation later)
          const verses = dba.prepare(`
            SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id
            FROM scriptures WHERE chapter_id = ? ORDER BY verse_number
          `).all(sr.chapter_id);
          for (const v of verses.slice(0, 5)) { // top 5 per chapter
            summaryRanked.push({ ...v, _source: 'summary' });
          }
        }
      }
    } catch {}
  }

  // ── Source C: Topical Guide — curated theological connections ──
  const tgRanked = [];
  if (topicalGuideReady) {
    const tg = topicSearch(query.trim(), 0, 30);
    if (tg && tg.results) {
      for (const r of tg.results) {
        tgRanked.push({ ...r, _source: 'topical-guide' });
      }
    }
  }

  // ── Source D: Entity index — people and places ──
  const entityRanked = [];
  const normQ = query.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (const [idx, label] of [[entityPersonIndex, 'entity-person'], [entityPlaceIndex, 'entity-place']]) {
    const verseIds = idx.get(normQ);
    if (verseIds) {
      for (const vid of [...verseIds].slice(0, 15)) {
        const row = stmtVerse.get(vid);
        if (row) entityRanked.push({ ...row, _source: label });
      }
    }
  }

  // ── Source E: Cross-reference graph — highest-weight theological signal ──
  const xrefRanked = [];
  if (db_vxref) {
    const seen = new Set(ftsRanked.map(r => r.verse_id));
    const topFts = ftsRanked.slice(0, 15);
    for (const ftsVerse of topFts) {
      try {
        const xrRow = db_vxref.prepare('SELECT cross_references FROM verse_cross_references WHERE verse_id = ?').get(ftsVerse.verse_id);
        if (!xrRow) continue;
        const refs = JSON.parse(xrRow.cross_references || '[]');
        for (const refId of refs.slice(0, 8)) {
          if (seen.has(refId)) continue;
          const row = stmtVerse.get(refId);
          if (row) {
            xrefRanked.push({ ...row, _source: 'cross-ref', _xref_from: ftsVerse.verse_id });
            seen.add(refId);
          }
        }
      } catch {}
    }
  }

  // ── Identify matched topic slugs for PPR boost ──
  // Phrase-aware: try full query and bigrams first, then fall back to single words
  const queryTopicSlugs = [];
  if (topicalGuideReady) {
    const normQuery = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').trim();
    const normWords = normQuery.split(/\s+/).filter(t => t.length > 1);

    // Phase 1: full query phrase match (e.g., "plan of salvation" → "plan-of-salvation")
    const querySlugified = normQuery.replace(/\s+/g, '-');
    for (const [slug, name] of topicNameMap) {
      const slugNorm = slug.replace(/-/g, ' ');
      if (slugNorm === normQuery || name.toLowerCase() === normQuery || slug === querySlugified) {
        queryTopicSlugs.push(slug);
      }
    }

    // Phase 2: bigram phrase match (e.g., "second coming" in a longer query)
    if (normWords.length >= 2) {
      for (let i = 0; i < normWords.length - 1; i++) {
        const bigram = normWords[i] + ' ' + normWords[i + 1];
        const bigramSlug = normWords[i] + '-' + normWords[i + 1];
        for (const [slug, name] of topicNameMap) {
          if (queryTopicSlugs.includes(slug)) continue;
          const slugNorm = slug.replace(/-/g, ' ');
          if (slugNorm.includes(bigram) || name.toLowerCase().includes(bigram) || slug.includes(bigramSlug)) {
            queryTopicSlugs.push(slug);
          }
        }
        if (queryTopicSlugs.length >= 10) break;
      }
    }

    // Phase 3: single word fallback (only if no phrase matches found)
    if (queryTopicSlugs.length === 0) {
      for (const [slug, name] of topicNameMap) {
        const slugNorm = slug.replace(/-/g, ' ');
        for (const w of normWords) {
          if (slugNorm.includes(w) || name.toLowerCase().includes(w)) {
            queryTopicSlugs.push(slug);
            break;
          }
        }
        if (queryTopicSlugs.length >= 10) break;
      }
    }
  }

  // ── RRF: merge all sources with reciprocal rank fusion + PPR ──
  const rrfScores = reciprocalRankFusion(
    [ftsRanked, phraseRanked, summaryRanked, tgRanked, entityRanked, xrefRanked],
    queryTopicSlugs,
    [1, 3, 1, 1, 1, 5]  // xrefRanked gets 5x weight — explicit citation is strongest signal
  );

  // ── Chapter aggregation: boost chapters with many verse hits ──
  const chapterScores = chapterAggregate(rrfScores);
  // Inject top chapter representative verses that might be missing
  for (const ch of chapterScores.slice(0, 10)) {
    if (ch.verseCount >= 3 && ch.bestVerse && !rrfScores.has(ch.bestVerse)) {
      // Chapter has 3+ hits but best verse isn't in results — add it
      const row = stmtVerse.get(ch.bestVerse);
      if (row) {
        rrfScores.set(ch.bestVerse, {
          rrfScore: ch.score * 0.8,
          row: { ...row, _source: 'chapter-agg' },
          sources: new Set(['chapter-agg']),
        });
      }
    }
    // Boost existing entries from high-scoring chapters
    for (const [vid, entry] of rrfScores) {
      const meta = verseMetaCache.get(vid);
      if (meta && meta.chapter_id === ch.chapterId) {
        entry.rrfScore += ch.score * 0.3 / Math.sqrt(ch.verseCount);
      }
    }
  }

  // Build final sorted list
  const sorted = [...rrfScores.entries()]
    .map(([vid, entry]) => ({
      ...entry.row,
      verse_id: vid,
      _rrfScore: entry.rrfScore,
      _sourceCount: entry.sources.size,
    }))
    .sort((a, b) => b._rrfScore - a._rrfScore);

  return { results: sorted, total: sorted.length };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RELATED VERSES ENGINE (Bayesian + MMR + Topic Graph)
// ═══════════════════════════════════════════════════════════════════════════

// Jaccard similarity for topic sets: |A∩B| / |A∪B|
function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

// Bayesian topic relevance: P(related | shared_topics, embedding_sim)
// Prior: embedding similarity. Likelihood: topic overlap. Posterior ∝ prior × likelihood
function bayesianRelevance(embeddingSim, topicJaccard, sharedTopicCount) {
  const prior = embeddingSim;  // P(related) from embeddings
  // Likelihood: each shared topic increases probability multiplicatively
  const likelihood = 1 + sharedTopicCount * 0.3 + topicJaccard * 2.0;
  // Posterior (unnormalized): Bayes' theorem
  return prior * likelihood;
}

// ── Context-aware boosting with exponential distance decay ──
function contextBoost(results, contextVerseId) {
  if (!contextVerseId) return results;
  const meta = verseMetaCache.get(contextVerseId);
  if (!meta) return results;

  const contextTopics = verseTopicCache.get(contextVerseId);
  const contextBookId = db.prepare('SELECT book_id FROM chapters WHERE id = ?').get(meta.chapter_id)?.book_id;
  const contextVolId  = contextBookId ? db.prepare('SELECT volume_id FROM books WHERE id = ?').get(contextBookId)?.volume_id : null;

  return results.map(r => {
    let boost = 0;
    if (contextVolId && r.book_id) {
      const rVol = db.prepare('SELECT volume_id FROM books WHERE id = ?').get(r.book_id)?.volume_id;
      if (rVol === contextVolId) boost += 0.05;
    }
    if (contextTopics && r.verse_id) {
      const rTopics = verseTopicCache.get(r.verse_id);
      if (rTopics) {
        let shared = 0;
        for (const t of contextTopics) if (rTopics.has(t)) shared++;
        boost += shared * 0.08; // proportional to shared topics
      }
    }
    return { ...r, similarity_score: +((r.similarity_score || 0) + boost).toFixed(4) };
  });
}

// ── Search Result Cache (LRU, TTL 5 min) ─────────────────────────────────────
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_CACHE_MAX    = 300;            // max cached queries
const searchResultsCache  = new Map();      // key → { results, total, ts }

function searchCacheGet(key) {
  const entry = searchResultsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SEARCH_CACHE_TTL_MS) {
    searchResultsCache.delete(key);
    return null;
  }
  return entry;
}

function searchCacheSet(key, results, total) {
  if (searchResultsCache.size >= SEARCH_CACHE_MAX) {
    const oldestKey = searchResultsCache.keys().next().value;
    searchResultsCache.delete(oldestKey);
  }
  searchResultsCache.set(key, { results, total, ts: Date.now() });
}

function makeCacheKey(query, language, contextVerseId) {
  return `${String(query).toLowerCase().trim()}|${language}|${contextVerseId || ''}`;
}

function encodeCursor(cacheKey, nextOffset, total) {
  return Buffer.from(JSON.stringify({ k: cacheKey, o: nextOffset, t: total })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function runSearchPipeline(query, language, contextVerseId, log) {
  const lang = String(language || 'en').toLowerCase().trim();
  const cacheKey = makeCacheKey(query, lang, contextVerseId);

  const cached = searchCacheGet(cacheKey);
  if (cached) return { ...cached, fromCache: true, cacheKey };

  let results = [];
  let total = 0;

  if (lang !== 'en') {
    const r = searchScriptureInDb(query, 0, 200, resolveDbAdapter(lang), log);
    results = r.results || [];
    total   = r.total   || results.length;
  } else {
    // Step 1: Exact scripture reference
    const ref = engine.parseScriptureReference(query);
    if (ref) {
      const refResult = searchScripture(query, 0, 200, dba, log);
      if (refResult.total > 0) {
        searchCacheSet(cacheKey, refResult.results, refResult.total);
        return { results: refResult.results, total: refResult.total, fromCache: false, cacheKey };
      }
    }

    // Step 2: Embed query once
    let qvec = null;
    if (embeddingsReady && embeddingPipe) {
      try {
        const out = await embeddingPipe(query.trim(), { pooling: 'mean', normalize: true });
        qvec = new Float32Array(out.data);
      } catch {}
    }

    // Steps 3-4: Synonym expansion + multi-source RRF fusion
    const expanded = expandWithSynonyms(query.trim());
    let fusionResult = multiSourceFusion(query.trim(), expanded.join(' '), 200);

    // Step 5: Sigmoid confidence gate → concept expansion
    const topBm25 = fusionResult.results[0]?._bm25 || fusionResult.results[0]?._bm25_rank || 0;
    const confidence = sigmoidConfidence(topBm25, fusionResult.total);
    if (confidence < 0.6 && qvec && conceptCache.length) {
      const topN = confidence < 0.3 ? 5 : 3;
      const concepts = await expandWithConcepts(query.trim(), topN, qvec);
      for (const c of concepts) {
        const cFusion = multiSourceFusion(c.phrase, c.phrase, 5);
        for (const r of cFusion.results) {
          if (!fusionResult.results.find(e => e.verse_id === r.verse_id)) {
            r._rrfScore = (r._rrfScore || 0) * c.score;
            fusionResult.results.push(r);
          }
        }
      }
      fusionResult.total = fusionResult.results.length;
    }

    results = fusionResult.results;
    total   = fusionResult.total;

    // Step 6: MMR diversity reranking
    if (results.length > 1 && qvec) {
      results = mmrRerank(results, qvec, 0.7, Math.min(200, results.length));
      results = results.map(r => ({ ...r, similarity_score: +(r.simToQuery ?? 0).toFixed(4) }));
    }

    // Step 7: Semantic fallback
    if (total < 5 && qvec) {
      const excludeIds = new Set(results.map(r => r.verse_id));
      const sem = await semanticSearch(query.trim(), 0, 30, excludeIds, qvec);
      if (sem && sem.results.length > 0) {
        results = [...results, ...sem.results];
        total = results.length;
      }
    }

    // Step 8: Context-aware boosting
    if (contextVerseId) {
      results = contextBoost(results, contextVerseId);
      results.sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
    }

    // Clean internal fields before caching
    results = results.map(r => {
      const { _rrfScore, _bm25, _bm25_rank, _source, _sourceCount, simToQuery, idx, ...clean } = r;
      return clean;
    });
    total = results.length;
  }

  searchCacheSet(cacheKey, results, total);
  return { results, total, fromCache: false, cacheKey };
}

function buildVerseMetaCache() {
  const rows = db.prepare('SELECT id AS verse_id, chapter_id, scripture_text FROM verses').all();
  for (const r of rows) {
    verseMetaCache.set(r.verse_id, { chapter_id: r.chapter_id, scripture_text: r.scripture_text });
  }
}

function buildEmbeddingCache() {
  if (!db_embed) return;
  const rows = db_embed.prepare('SELECT verse_id, embedding FROM verse_embeddings').all();
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
  const ins = db_embed.prepare('INSERT OR REPLACE INTO verse_embeddings (verse_id, embedding) VALUES (?, ?)');
  db_embed.transaction(items => { for (const { verse_id, buf } of items) ins.run(verse_id, buf); })(rows);
  const done = offset + batch.length;
  if (done % 1000 < EMBED_BATCH_SIZE || done >= verses.length)
    fastify.log.info(`[Embeddings] ${done}/${verses.length}`);
  setImmediate(() => processBatchAsync(pipe, verses, done));
}

async function initEmbeddings() {
  if (!db_embed) return; // no embeddings DB available
  try {
    const total    = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
    const existing = db_embed.prepare('SELECT COUNT(*) AS n FROM verse_embeddings').get().n;

    // Fast path: all embeddings pre-stored (production / post-local-bake)
    if (!REBUILD_EMBEDDINGS && existing >= total) {
      fastify.log.info(`[Embeddings] ${existing}/${total} pre-stored — loading cache.`);
      buildEmbeddingCache();
      // Load pipeline for semantic search queries (lightweight — model is ~23MB, loads in ~3-5s)
      try {
        fastify.log.info('[Embeddings] Loading pipeline for semantic search…');
        const { pipeline } = await import('@xenova/transformers');
        embeddingPipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        fastify.log.info('[Embeddings] Pipeline ready — semantic search enabled.');
      } catch (pipeErr) {
        fastify.log.warn('[Embeddings] Pipeline load failed (semantic search disabled):', pipeErr.message);
      }
      return;
    }

    // Only reach here in development when embeddings are missing or REBUILD_EMBEDDINGS=true
    if (SKIP_RECOMPUTE) {
      fastify.log.warn('[Embeddings] Production/Electron mode — cannot compute missing embeddings. Run scripts/compute-embeddings.js locally.');
      if (existing > 0) {
        buildEmbeddingCache();
        try {
          const { pipeline } = await import('@xenova/transformers');
          embeddingPipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
          fastify.log.info('[Embeddings] Pipeline ready — semantic search enabled.');
        } catch (pipeErr) {
          fastify.log.warn('[Embeddings] Pipeline load failed (semantic search disabled):', pipeErr.message);
        }
      }
      return;
    }

    fastify.log.info('[Embeddings] Loading pipeline…');
    const { pipeline } = await import('@xenova/transformers');
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    embeddingPipe = pipe;
    fastify.log.info('[Embeddings] Pipeline loaded.');
    if (REBUILD_EMBEDDINGS) {
      db_embed.prepare('DELETE FROM verse_embeddings').run();
      fastify.log.info('[Embeddings] Cleared for rebuild.');
    }
    const embeddedIds = new Set(
      db_embed.prepare('SELECT verse_id FROM verse_embeddings').all().map(r => r.verse_id)
    );
    const missing = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all()
      .filter(v => !embeddedIds.has(v.verse_id));
    fastify.log.info(`[Embeddings] Computing ${missing.length} embeddings in background…`);
    setImmediate(() => processBatchAsync(pipe, missing, 0));
  } catch (err) {
    fastify.log.error('[Embeddings] Init failed: ' + err.message);
  }
}

const entityPersonIndex = new Map(); // normalized-name → Set<verse_id>
const entityPlaceIndex  = new Map(); // normalized-name → Set<verse_id>
const verseEntityCache  = new Map(); // verse_id → { people: string[], places: string[] }
let entitiesReady = false;

function normalizeEntityName(name) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function buildEntityCache() {
  if (!db_tags) return;
  try {
    // Try pre-baked entity indexes first
    const personCount = db_tags.prepare('SELECT COUNT(*) AS n FROM entity_person_index').get()?.n;
    if (personCount > 0) {
      // Pre-baked: load from indexed tables (much faster, no JSON parsing)
      const personStmt = db_tags.prepare('SELECT DISTINCT name_normalized FROM entity_person_index');
      for (const r of personStmt.all()) {
        const verses = db_tags.prepare('SELECT verse_id FROM entity_person_index WHERE name_normalized = ?').all(r.name_normalized);
        entityPersonIndex.set(r.name_normalized, new Set(verses.map(v => v.verse_id)));
      }
      const placeStmt = db_tags.prepare('SELECT DISTINCT name_normalized FROM entity_place_index');
      for (const r of placeStmt.all()) {
        const verses = db_tags.prepare('SELECT verse_id FROM entity_place_index WHERE name_normalized = ?').all(r.name_normalized);
        entityPlaceIndex.set(r.name_normalized, new Set(verses.map(v => v.verse_id)));
      }
      // Load verse entity cache
      const vecRows = db_tags.prepare('SELECT verse_id, people, places FROM verse_entity_cache').all();
      for (const r of vecRows) {
        verseEntityCache.set(r.verse_id, {
          people: JSON.parse(r.people || '[]'),
          places: JSON.parse(r.places || '[]'),
        });
      }
      entitiesReady = true;
      fastify.log.info(`[Entities] Pre-baked: ${entityPersonIndex.size} people, ${entityPlaceIndex.size} places, ${verseEntityCache.size} verses`);

      // ── Load entity centroid embeddings for mathematical disambiguation ──
      try {
        const centroidRows = db_tags.prepare('SELECT entity_id, centroid FROM ai_entity_centroids').all();
        for (const r of centroidRows) {
          entityCentroidCache.set(
            r.entity_id,
            new Float32Array(r.centroid.buffer, r.centroid.byteOffset, r.centroid.byteLength / 4)
          );
        }
        fastify.log.info(`[Entity Centroids] ${entityCentroidCache.size} centroid vectors loaded`);
      } catch { /* ai_entity_centroids table may not exist yet */ }

      return;
    }
  } catch {}
  // Fallback: runtime build from chapter_entities
  try {
    const chapterRows = db_tags.prepare('SELECT chapter_id, entities_json FROM chapter_entities').all();
    const chapterEntityCache = new Map();
    for (const r of chapterRows) {
      let people = [], places = [];
      if (r.entities_json) {
        try {
          const j = JSON.parse(r.entities_json);
          people = j.people || [];
          places = j.places || [];
        } catch { /* skip malformed */ }
      }
      chapterEntityCache.set(r.chapter_id, { people, places });
    }
    const verseChapterRows = db_tags.prepare('SELECT verse_id, chapter_id FROM verse_doctrine_tags').all();
    for (const vc of verseChapterRows) {
      const ent = chapterEntityCache.get(vc.chapter_id);
      if (!ent) continue;
      verseEntityCache.set(vc.verse_id, ent);
      for (const p of ent.people) {
        const key = normalizeEntityName(p);
        if (!entityPersonIndex.has(key)) entityPersonIndex.set(key, new Set());
        entityPersonIndex.get(key).add(vc.verse_id);
      }
      for (const p of ent.places) {
        const key = normalizeEntityName(p);
        if (!entityPlaceIndex.has(key)) entityPlaceIndex.set(key, new Set());
        entityPlaceIndex.get(key).add(vc.verse_id);
      }
    }
    entitiesReady = chapterRows.length > 0;
    fastify.log.info(`[Entities] Runtime cache: ${entityPersonIndex.size} people, ${entityPlaceIndex.size} places`);
  } catch (err) {
    fastify.log.warn('[Entities] Cache build failed:', err.message);
  }
}

// Build verse meta + concept cache synchronously before any requests are served
buildVerseMetaCache();
buildTopicalGuideCache();
buildEntityCache();
initIdfLookup();
initPprLookup();
initRwrLookup();

// Finds a topic by name/slug match, returns all verses in that topic cluster
// ranked by how many topics they share with the query topic.
function topicSearch(query, page = 0, pageSize = 10) {
  if (!topicalGuideReady || !db_tg) return { results: [], total: 0 };
  const lower = query.toLowerCase().trim();
  // Match topic slug or name (exact first, then prefix, then substring)
  const allTopics = [...topicNameMap.entries()]; // [slug, name]
  let matched =
    allTopics.find(([s, n]) => s === lower || n.toLowerCase() === lower) ??
    allTopics.find(([s, n]) => s.startsWith(lower) || n.toLowerCase().startsWith(lower)) ??
    allTopics.find(([s, n]) => s.includes(lower) || n.toLowerCase().includes(lower));
  if (!matched) return null; // signal: no TG match, fall through to FTS

  const [topicSlug, topicName] = matched;
  const queryTopics = new Set([topicSlug]);

  const topicVerseIds = db_tg.prepare(`
    SELECT g.verse_id FROM topical_guide g
    JOIN topics t ON t.id = g.topic_id
    WHERE t.slug = ? AND g.verse_id IS NOT NULL AND g.verse_id != -1
  `).all(topicSlug).map(r => r.verse_id);

  if (!topicVerseIds.length) return { results: [], total: 0, matchedTopic: topicName };

  const scored = topicVerseIds.map(vid => {
    const vTopics = verseTopicCache.get(vid) ?? new Set();
    let overlap = 0;
    for (const s of queryTopics) if (vTopics.has(s)) overlap++;
    return { verse_id: vid, overlap };
  });
  scored.sort((a, b) => b.overlap - a.overlap);

  const total  = scored.length;
  const paged  = scored.slice(page * pageSize, page * pageSize + pageSize);
  const stmt   = dba.prepare(
    'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, volume_id FROM scriptures WHERE verse_id = ?'
  );
  const results = paged.map(({ verse_id }) => ({ ...stmt.get(verse_id), matched_concept: topicName }));
  return { results, total, matchedTopic: topicName };
}

fastify.get('/topic-search', async (request, reply) => {
  const { q, language = 'en' } = request.query;
  const page     = Math.max(0, parseInt(request.query.page     ?? 0,  10) || 0);
  const pageSize = Math.min(20, Math.max(1, parseInt(request.query.pageSize ?? 10, 10) || 10));

  if (!q || !q.trim()) { reply.code(400); return { error: 'q is required' }; }

  const lang = language.toLowerCase();
  const targetDb = lang !== 'en' ? resolveDbAdapter(lang) : null;

  const stmtCoords = targetDb
    ? dba.prepare('SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1')
    : null;
  const stmtTransText = targetDb
    ? targetDb.prepare('SELECT scripture_text FROM scriptures WHERE book_id = ? AND chapter_number = ? AND verse_number = ? LIMIT 1')
    : null;

  const translateResults = (results) => {
    if (!stmtCoords || !stmtTransText) return results;
    return results.map(r => {
      const coords = stmtCoords.get(r.verse_id);
      if (!coords) return r;
      const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number);
      return t?.scripture_text ? { ...r, scripture_text: t.scripture_text } : r;
    });
  };

  const tgResult = topicSearch(q.trim(), page, pageSize);
  if (tgResult && tgResult.total > 0) {
    return {
      results:      translateResults(tgResult.results),
      total:        tgResult.total,
      matchedTopic: tgResult.matchedTopic ?? null,
      page,
      pageSize,
      fallback:     false,
    };
  }

  const db = lang !== 'en' && targetDb ? targetDb : dba;
  const { results: ftsResults, total: ftsTotal } =
    phraseSearch(q.trim(), page, pageSize, dba, fastify.log);
  return {
    results:      translateResults(ftsResults),
    total:        ftsTotal ?? ftsResults.length,
    matchedTopic: null,
    page,
    pageSize,
    fallback:     true,
  };
});

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

fastify.get('/verse/:verse_id/related', async (request, reply) => {
  const verseId  = parseInt(request.params.verse_id, 10);
  if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; }

  const language = (request.query.language || 'en').toLowerCase();
  const page     = Math.max(0, parseInt(request.query.page     ?? 0,  10) || 0);
  const pageSize = Math.min(20, Math.max(1, parseInt(request.query.pageSize ?? 10, 10) || 10));
  const offset   = page * pageSize;
  const targetDb = resolveDbAdapter(language);

  const meta = verseMetaCache.get(verseId);
  if (!meta) { reply.code(404); return { error: 'Verse not found' }; }

  const liveTopics  = topicalGuideReady ? (verseTopicCache.get(verseId) ?? new Set()) : new Set();
  const liveChapter = meta.chapter_id;

  // Fetch canonical metadata (coords, title) always from English DB;
  // swap scripture_text from the requested language DB when not English.
  const stmtMeta = dba.prepare(`
    SELECT verse_id, verse_title, scripture_text, book_title,
           chapter_number, verse_number, chapter_id, volume_id
    FROM scriptures WHERE verse_id = ?
  `);
  // For non-English: resolve coords from English, then fetch text from target DB
  const stmtCoords = language !== 'en'
    ? dba.prepare('SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1')
    : null;
  const stmtTransText = language !== 'en'
    ? targetDb.prepare(`
        SELECT scripture_text FROM scriptures
        WHERE book_id = ? AND chapter_number = ? AND verse_number = ?
        LIMIT 1
      `)
    : null;

  const resolveRow = (verse_id) => {
    const row = stmtMeta.get(verse_id);
    if (!row) return null;
    if (stmtCoords && stmtTransText) {
      const coords = stmtCoords.get(verse_id);
      if (coords) {
        const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number);
        if (t?.scripture_text) row.scripture_text = t.scripture_text;
      }
    }
    return row;
  };

  // Build overlap map: verse_id → count of shared topics
  const tgScores = new Map(); // verse_id → overlap count
  if (liveTopics.size > 0) {
    for (const slug of liveTopics) {
      const peers = topicVerseIndex.get(slug);
      if (!peers) continue;
      for (const vid of peers) {
        if (vid === verseId) continue;
        const vmeta = verseMetaCache.get(vid);
        if (vmeta && vmeta.chapter_id === liveChapter) continue;
        tgScores.set(vid, (tgScores.get(vid) ?? 0) + 1);
      }
    }
  }

  // ── Strategy: Use kNN + RWR fusion for related verses ──
  let knnAvailable = false;
  try {
    if (db_graph) {
      const knnRow = db_graph.prepare('SELECT COUNT(*) AS n FROM verse_knn WHERE verse_id = ?').get(verseId);
      knnAvailable = knnRow && knnRow.n > 0;
    }
  } catch {}

  if (knnAvailable) {
    // Pre-baked kNN: embedding similarity neighbors
    const knnRows = db_graph.prepare(
      'SELECT neighbor_id, similarity FROM verse_knn WHERE verse_id = ? ORDER BY rank'
    ).all(verseId);

    // Pre-baked RWR: topic-graph walk neighbors (multi-hop structural)
    let rwrMap = new Map(); // neighbor_id → rwr_score
    if (rwrStmt) {
      try {
        const rwrRows = rwrStmt.all(verseId);
        for (const r of rwrRows) rwrMap.set(r.neighbor_id, r.rwr_score);
      } catch {}
    }

    // Fuse kNN (embedding) + RWR (structural) + topic overlap + PPR
    const allCandidates = new Map(); // verse_id → combined score
    // Add kNN candidates
    for (const r of knnRows) {
      const overlap = tgScores.get(r.neighbor_id) ?? 0;
      const pr = pageRankCache.get(r.neighbor_id) ?? 0;
      const cTopics = verseTopicCache.get(r.neighbor_id) ?? new Set();
      const jaccard = jaccardSimilarity(liveTopics, cTopics);
      const rwrScore = rwrMap.get(r.neighbor_id) ?? 0;
      // PPR boost: use topic-specific authority if available
      let pprBoost = 0;
      if (pprStmt && liveTopics.size > 0) {
        for (const slug of [...liveTopics].slice(0, 5)) {
          try {
            const row = db_tg.prepare('SELECT ppr FROM topic_ppr WHERE topic_slug = ? AND verse_id = ?').get(slug, r.neighbor_id);
            if (row && row.ppr > pprBoost) pprBoost = row.ppr;
          } catch {}
        }
      }
      const score = r.similarity * 1.0      // embedding similarity (primary, ~0.3-0.9)
                  + rwrScore * 2.0           // structural proximity (multi-hop, ~0-0.3)
                  + overlap * 0.15           // raw topic overlap
                  + jaccard * 0.5            // normalized topic similarity
                  + pprBoost * 0.5           // topic-specific authority (~0-0.02)
                  + pr * 2000;               // global authority (~0-0.1)
      allCandidates.set(r.neighbor_id, { verse_id: r.neighbor_id, embSim: r.similarity, score, overlap });
    }
    // Add RWR-only candidates (multi-hop connections kNN may miss)
    for (const [nid, rwrScore] of rwrMap) {
      if (allCandidates.has(nid)) continue; // already in kNN results
      const overlap = tgScores.get(nid) ?? 0;
      const pr = pageRankCache.get(nid) ?? 0;
      const cTopics = verseTopicCache.get(nid) ?? new Set();
      const jaccard = jaccardSimilarity(liveTopics, cTopics);
      const score = rwrScore * 3.0 + overlap * 0.15 + jaccard * 0.5 + pr * 2000;
      allCandidates.set(nid, { verse_id: nid, embSim: 0, score, overlap });
    }

    const enhanced = [...allCandidates.values()]
      .filter(r => {
        // Exclude same-chapter results
        const m = verseMetaCache.get(r.verse_id);
        return !m || m.chapter_id !== liveChapter;
      });
    enhanced.sort((a, b) => b.score - a.score);

    // ── Source: Cluster neighbors (cross-book discovery) ──
    let clusterLabel = null;
    if (db_graph) {
      try {
        const clusterRow = db_graph.prepare('SELECT cluster_id FROM verse_clusters WHERE verse_id = ?').get(verseId);
        if (clusterRow) {
          clusterLabel = clusterRow.cluster_id;
          const sourceBook = dba.prepare('SELECT book_id FROM scriptures WHERE verse_id = ? LIMIT 1').get(verseId);
          const verseBook = sourceBook ? sourceBook.book_id : null;
          const existingIds = new Set(enhanced.map(r => r.verse_id));
          existingIds.add(verseId);
          const clusterMembers = db_graph.prepare(`
            SELECT vc.verse_id, vc.centroid_distance
            FROM verse_clusters vc
            WHERE vc.cluster_id = ? AND vc.verse_id != ?
            ORDER BY vc.centroid_distance ASC
            LIMIT 60
          `).all(clusterRow.cluster_id, verseId);
          const clusterNeighbors = [];
          for (const m of clusterMembers) {
            if (existingIds.has(m.verse_id)) continue;
            const row = dba.prepare(`
              SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id
              FROM scriptures WHERE verse_id = ?
            `).get(m.verse_id);
            if (!row) continue;
            const sameBook = row.book_id === verseBook;
            const clusterScore = (1 - m.centroid_distance) * (sameBook ? 0.4 : 1.0);
            clusterNeighbors.push({ verse_id: m.verse_id, embSim: 0, score: clusterScore * 0.7, overlap: 0 });
            existingIds.add(m.verse_id);
            if (clusterNeighbors.length >= 12) break;
          }
          if (clusterNeighbors.length > 0) {
            enhanced.push(...clusterNeighbors);
            enhanced.sort((a, b) => b.score - a.score);
          }
        }
      } catch {}
    }

    // kNN results are already curated (top-20 most similar) — use light diversity only
    // Skip cluster-based filtering since kNN neighbors are inherently relevant
    const diverseResults = enhanced.slice(0, offset + pageSize);

    const paged = diverseResults.slice(offset, offset + pageSize);
    const results = paged.map(({ verse_id, embSim }) => {
      const row = resolveRow(verse_id);
      const cTopics = verseTopicCache.get(verse_id);
      const sharedSlug = cTopics ? ([...liveTopics].find(s => cTopics.has(s)) ?? null) : null;
      const matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? sharedSlug) : null;
      return { ...row, similarity_score: +(embSim ?? 0).toFixed(4), matched_concept: matchedConcept };
    });
    const matchedConcept = liveTopics.size ? (topicNameMap.get([...liveTopics][0]) ?? null) : null;
    return { results, total: enhanced.length, matchedConcept, page, pageSize, cluster_id: clusterLabel };
  }
  if (embeddingsReady) {
    const liveVec = embeddingCache.get(verseId);
    if (!liveVec) { reply.code(404); return { error: 'Embedding not found' }; }

    // Bayesian scoring: P(related | embedding_sim, topic_overlap)
    const candidates = [];
    for (const [cid, cvec] of embeddingCache) {
      const cmeta = verseMetaCache.get(cid);
      if (cmeta && cmeta.chapter_id === liveChapter) continue;
      const embSim = cosineSimilarity(liveVec, cvec);
      if (embSim < 0.15) continue; // early pruning: skip very dissimilar
      const overlap = tgScores.get(cid) ?? 0;
      const cTopics = verseTopicCache.get(cid) ?? new Set();
      const jaccard = jaccardSimilarity(liveTopics, cTopics);
      const bayesScore = bayesianRelevance(embSim, jaccard, overlap);
      candidates.push({ verse_id: cid, score: bayesScore, embSim, overlap });
    }
    candidates.sort((a, b) => b.score - a.score);

    // MMR diversity: prevent same-book/same-theme dominance in related verses
    const topCandidates = candidates.slice(0, 200); // pre-filter for performance
    const mmrResults = [];
    const selectedVecs = [];
    for (let pick = 0; pick < offset + pageSize && topCandidates.length > 0; pick++) {
      let bestIdx = -1;
      let bestMmr = -Infinity;
      const LAMBDA = 0.65; // slightly more relevance-focused for related verses
      for (let i = 0; i < topCandidates.length; i++) {
        const c = topCandidates[i];
        const cVec = embeddingCache.get(c.verse_id);
        let maxSimToSelected = 0;
        if (cVec && selectedVecs.length > 0) {
          for (const sv of selectedVecs) {
            const sim = cosineSimilarity(cVec, sv);
            if (sim > maxSimToSelected) maxSimToSelected = sim;
          }
        }
        const mmr = LAMBDA * (c.score / (candidates[0]?.score || 1)) - (1 - LAMBDA) * maxSimToSelected;
        if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        const chosen = topCandidates.splice(bestIdx, 1)[0];
        const cVec = embeddingCache.get(chosen.verse_id);
        if (cVec) selectedVecs.push(cVec);
        mmrResults.push(chosen);
      } else break;
    }

    const paged = mmrResults.slice(offset, offset + pageSize);
    const results = paged.map(({ verse_id, score, embSim }) => {
      const row = resolveRow(verse_id);
      const cTopics = verseTopicCache.get(verse_id);
      const sharedSlug = cTopics ? ([...liveTopics].find(s => cTopics.has(s)) ?? null) : null;
      const matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? sharedSlug) : null;
      return { ...row, similarity_score: +embSim.toFixed(4), matched_concept: matchedConcept };
    });
    const matchedConcept = liveTopics.size ? (topicNameMap.get([...liveTopics][0]) ?? null) : null;
    return { results, total: candidates.length, matchedConcept, page, pageSize };
  }

  if (tgScores.size > 0) {
    const allSorted = [...tgScores.entries()].sort((a, b) => b[1] - a[1]);
    const paged = allSorted.slice(offset, offset + pageSize);
    const results = paged.map(([vid, overlap]) => {
      const row = resolveRow(vid);
      const cTopics = verseTopicCache.get(vid);
      const sharedSlug = cTopics ? ([...liveTopics].find(s => cTopics.has(s)) ?? null) : null;
      const matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? null) : null;
      return { ...row, similarity_score: +(overlap / liveTopics.size).toFixed(4), matched_concept: matchedConcept };
    });
    const matchedConcept = liveTopics.size ? (topicNameMap.get([...liveTopics][0]) ?? null) : null;
    return { results, total: allSorted.length, matchedConcept, page, pageSize, fallback: true };
  }

  const phrase = meta.scripture_text.split(/\s+/).slice(0, 8).join(' ');
  const { results: ftsResults, total: ftsTotal } = phraseSearch(phrase, page, pageSize, dba, fastify.log);
  const filtered = ftsResults.filter(r => r.verse_id !== verseId);
  if (stmtCoords && stmtTransText) {
    for (const r of filtered) {
      const coords = stmtCoords.get(r.verse_id);
      if (coords) {
        const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number);
        if (t?.scripture_text) r.scripture_text = t.scripture_text;
      }
    }
  }
  return { results: filtered, total: ftsTotal ?? filtered.length, page, pageSize, fallback: true };
});

fastify.get('/verse/:verse_id/translation', async (request, reply) => {
  const { verse_id } = request.params;
  const { language } = request.query;
  if (!language || !['en', 'tl', 'ceb', 'es', 'el', 'ilo', 'ja', 'nrsvue', 'war'].includes(language.toLowerCase())) {
    reply.code(400);
    return { error: 'language must be en, tl, ceb, es, el, ilo, ja, nrsvue or war' };
  }
  const targetDb = language.toLowerCase() === 'en' ? dba : resolveDbAdapter(language);
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
        label: '',
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

        // A token that was evicted stays barred until the current presenter
        // voluntarily leaves.
        if (incomingToken && state.lockedOutTokens.has(incomingToken)) {
          return { error: 'presenter-locked-out' };
        }

        // PIN gate — runs BEFORE token assignment so a failed/incomplete PIN
        // attempt doesn't pollute the presenter slot with a half-assigned token.
        if (state.pinHash) {
          const provided = String(pin || '').trim();
          if (!provided) return { requiresPin: true };
          if (hashPin(provided) !== state.pinHash) return { pinIncorrect: true };
        }

        // The token matches — this is the original device/tab returning after
        // a network blip or page refresh.  Clear the disconnect timer now that
        // they're back, then fall through to the grant section.
        if (incomingToken && state.presenterToken === incomingToken) {
          state.presenterDisconnectedAt = null; // they're back — stop the eviction clock
        }

        else if (!state.presenterToken) {
          // Slot is vacant.  Assign the incoming token (or generate a fresh one
          // if the client didn't supply one, as is the case on first join).
          state.presenterToken = incomingToken || generateToken();
        }

        else {
          if (hasConnectedSocket(state.presenterSocketId)) {
            // The preacher's device is online — protect them unconditionally.
            // Being "idle" (not touching the screen) is normal during a sermon.
            io.to(state.presenterSocketId).emit('presenter-takeover-attempt', {
              message: 'Another device attempted to join your session as presenter',
            });
            return { error: 'Another presenter is active in this session' };
          } else {
            // Presenter lock is permanent until they explicitly hit "Leave Session".
            // A disconnected device (sleeping phone, WiFi blip, mid-sermon) does
            // not open the slot — the preacher's place is always held for them.
            return { error: 'presenter-session-in-progress' };
          }
        }
      }
      if (activeSessionId && activeSessionId !== normalized) {
        socket.leave(activeSessionId);
        if (activeRole === 'presenter') {
          releasePresenterLock(previousSessionId, socket.id, true /* voluntary — switching sessions */);
        } else {
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
      socket.emit('session-joined', { sessionId: activeSessionId, pinSet: !!state.pinHash, label: state.label || '' });
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
      return { sessionId: activeSessionId, pinSet: !!state.pinHash, presenterToken: state.presenterToken, label: state.label || '' };
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
      // Store label if provided
      const label = String((payload && payload.label) || '').trim().slice(0, 40);
      if (label) getSessionState(joined.sessionId).label = label;
      socket.emit('session-created', { sessionId: joined.sessionId, presenterToken: joined.presenterToken, label });
      if (typeof callback === 'function') callback({ ok: true, sessionId: joined.sessionId, presenterToken: joined.presenterToken, label });
    });

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
        sessionId = generateSessionId();
        if (!sessionId) {
          const error = { message: 'Server session limit reached' };
          socket.emit('session-error', error);
          if (typeof callback === 'function') callback({ ok: false, ...error });
          return;
        }
        isMainClient = true;
      }

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
      // Persist label if presenter supplies one and the session has none yet
      if (role === 'presenter' && payload && payload.label) {
        const state = getSessionState(joined.sessionId);
        if (!state.label) state.label = String(payload.label).trim().slice(0, 40);
        joined.label = state.label;
      }
      if (typeof callback === 'function') callback({
        ok: true,
        sessionId: joined.sessionId,
        pinSet: joined.pinSet,
        presenterToken: joined.presenterToken || null,
        label: joined.label || '',
      });
    });

    socket.on('leave-session', (payload, callback) => {
      const left = leaveActiveSession();
      if (typeof callback === 'function') callback({ ok: true, sessionId: left.sessionId });
    });

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

    socket.on('search', async (payload) => {
      try {
        const query         = typeof payload === 'string' ? payload : payload?.query;
        const pageSize      = Math.min(50, Math.max(1, Number(payload?.pageSize) || 10));
        const language      = payload?.language ? String(payload.language).toLowerCase().trim() : 'en';
        const contextVerseId = Number(payload?.contextVerseId) || null;
        const cursorStr     = payload?.cursor || null;

        if (!query || !String(query).trim()) {
          socket.emit('search-results', { results: [], total: 0, nextCursor: null });
          return;
        }

        fastify.log.info(`search: "${query}" pageSize=${pageSize} lang=${language} cursor=${cursorStr ? 'yes' : 'no'}`);

        let offset = 0;
        let pipelineResults, total, cacheKey;

        if (cursorStr) {
          // Cursor path: decode offset + cache key, no pipeline re-run
          const decoded = decodeCursor(cursorStr);
          if (decoded) {
            const cached = searchCacheGet(decoded.k);
            if (cached) {
              offset          = decoded.o;
              pipelineResults = cached.results;
              total           = cached.total;
              cacheKey        = decoded.k;
            }
          }
          // If cache expired since cursor was issued, fall through to fresh run
          if (!pipelineResults) {
            const fresh = await runSearchPipeline(query, language, contextVerseId, fastify.log);
            pipelineResults = fresh.results;
            total           = fresh.total;
            cacheKey        = fresh.cacheKey;
            offset          = 0;
          }
        } else {
          // Fresh search: run pipeline (cache hit = fast)
          const fresh = await runSearchPipeline(query, language, contextVerseId, fastify.log);
          pipelineResults = fresh.results;
          total           = fresh.total;
          cacheKey        = fresh.cacheKey;
          offset          = 0;
        }

        const pageResults = pipelineResults.slice(offset, offset + pageSize);
        const nextOffset  = offset + pageResults.length;
        const hasMore     = nextOffset < total;
        const nextCursor  = hasMore ? encodeCursor(cacheKey, nextOffset, total) : null;

        socket.emit('search-results', {
          results:    pageResults,
          total,
          nextCursor,
          // keep legacy page field for backward compat
          page:       Math.floor(offset / pageSize),
          pageSize,
          query,
          language,
        });
      } catch (err) {
        fastify.log.error({ err }, 'search handler failed');
        socket.emit('search-results', { results: [], total: 0, nextCursor: null });
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

    // ── now-reading ─────────────────────────────────────────────────────────
    // Presenter toggles the "Now Reading" label on TV/client screens.
    socket.on('now-reading', (payload) => {
      const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      emitToSession(sessionId, 'now-reading', { on: !!payload?.on, verse_id: payload?.verse_id || null });
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

// ── HTTP route: get entities for a verse ─────────────────────────────────────
fastify.get('/verse/:verse_id/entities', async (request, reply) => {
  const verseId = parseInt(request.params.verse_id, 10);
  if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; }
  const cached = verseEntityCache.get(verseId);
  if (cached) return { verse_id: verseId, ...cached, ready: true };
  return { verse_id: verseId, people: [], places: [], ready: entitiesReady };
});

// ── HTTP route: entity search — find all verses mentioning a person or place ──
fastify.get('/entity/search', async (request, reply) => {
  const { name, type = 'person', language = 'en', page: pg = '0', pageSize: ps = '10', entity_id, verse_id: vid } = request.query;
  if (!name || !name.trim()) { reply.code(400); return { error: 'name is required' }; }
  const page     = Math.max(0, parseInt(pg,  10) || 0);
  const pageSize = Math.min(30, Math.max(1, parseInt(ps, 10) || 10));
  const lang     = language.toLowerCase();
  const targetDb = lang !== 'en' ? resolveDbAdapter(lang) : dba;
  if (!targetDb) return { results: [], total: 0, name, type, page, pageSize, groups: [] };

  // ── Disambiguated entity search via AI entity index ──
  if (db_tags) {
    let resolvedEid = entity_id || null;
    const searchName = name.trim().replace(/\s*\([^)]*\)\s*/g, '').toLowerCase();

    // Normalize search term into entity_id token (e.g. "Jesus Christ" → "jesus_christ")
    const searchToken = searchName.replace(/\s+/g, '_');

    // If no entity_id but we have verse_id, resolve via ai_entity_verse_map
    if (!resolvedEid && vid) {
      const vInt = parseInt(vid, 10);
      // Try matching by profile name first
      const row = db_tags.prepare(`
        SELECT m.entity_id FROM ai_entity_verse_map m
        JOIN ai_entity_profiles p ON m.entity_id = p.entity_id
        WHERE m.verse_id = ? AND LOWER(p.name) = ? AND p.type = ?
        LIMIT 1
      `).get(vInt, searchName, type);
      if (row) {
        resolvedEid = row.entity_id;
      } else {
        // Fallback: match entity_id starting with search token after type prefix
        // (e.g. "jesus" matches person:jesus_christ but not person:bar_jesus)
        const eidRows = db_tags.prepare(`
          SELECT m.entity_id, p.verse_count FROM ai_entity_verse_map m
          JOIN ai_entity_profiles p ON m.entity_id = p.entity_id
          WHERE m.verse_id = ? AND p.entity_id LIKE ? AND p.type = ?
        `).all(vInt, `${type}:${searchToken}%`, type);
        if (eidRows.length === 1) {
          resolvedEid = eidRows[0].entity_id;
        } else if (eidRows.length > 1) {
          // Multiple matches on same verse — use mathematical scoring
          const verseEmb = embeddingCache.get(vInt) || null;
          const scored = scoreEntityCandidates(eidRows, vInt, verseEmb);
          resolvedEid = scored[0].entity_id;
        }
      }
    }

    // Fallback: find candidate profiles by name+type OR entity_id prefix
    if (!resolvedEid) {
      const profiles = db_tags.prepare(
        `SELECT entity_id, verse_count FROM ai_entity_profiles
         WHERE (LOWER(name) = ? OR entity_id LIKE ?) AND type = ?`
      ).all(searchName, `${type}:${searchToken}%`, type);
      // Deduplicate (a profile could match both conditions)
      const seen = new Set(); const uniq = [];
      for (const p of profiles) { if (!seen.has(p.entity_id)) { seen.add(p.entity_id); uniq.push(p); } }
      if (uniq.length === 1) {
        resolvedEid = uniq[0].entity_id;
      } else if (uniq.length > 1) {
        const vInt = vid ? parseInt(vid, 10) : null;
        const verseEmb = vInt ? (embeddingCache.get(vInt) || null) : null;
        // Use mathematical scoring: cosine similarity + Bayesian prior + proximity
        const scored = scoreEntityCandidates(uniq, vInt, verseEmb);
        resolvedEid = scored[0].entity_id;
      }
    }

    if (resolvedEid) {
      const profile = db_tags.prepare('SELECT * FROM ai_entity_profiles WHERE entity_id = ?').get(resolvedEid);
      const allVids = db_tags.prepare('SELECT verse_id FROM ai_entity_verse_map WHERE entity_id = ? ORDER BY verse_id').all(resolvedEid).map(r => r.verse_id);
      const total = allVids.length;
      const offset = page * pageSize;
      const pageVids = allVids.slice(offset, offset + pageSize);

      const results = pageVids.length > 0
        ? targetDb.prepare(`SELECT * FROM scriptures WHERE verse_id IN (${pageVids.map(() => '?').join(',')}) ORDER BY verse_id`).all(...pageVids)
        : [];

      const volumeMap = new Map();
      for (const r of results) {
        const volId = r.volume_id || 0;
        if (!volumeMap.has(volId)) volumeMap.set(volId, { volume_id: volId, volume_title: r.volume_title || r.book_title, results: [] });
        volumeMap.get(volId).results.push(r);
      }

      // Sibling profiles (same name or entity_id prefix, different identity)
      const siblings = profile ? db_tags.prepare(
        `SELECT entity_id, qualifier, verse_count FROM ai_entity_profiles
         WHERE (LOWER(name) = LOWER(?) OR entity_id LIKE ?) AND type = ? AND entity_id != ?`
      ).all(profile.name, `${type}:${searchToken}%`, profile.type, resolvedEid) : [];

      return {
        results, total, name, type, page, pageSize,
        groups: [...volumeMap.values()],
        entity_id: resolvedEid,
        qualifier: profile?.qualifier || null,
        description: profile?.description || null,
        siblings,
      };
    }
  }

  // Strip parenthetical annotations like "(Elohim)" from entity names before FTS
  const searchName = name.trim().replace(/\s*\([^)]*\)\s*/g, '').trim();
  const { results: ftsResults, total } = phraseSearch(searchName, page, pageSize, targetDb, fastify.log);

  // Fallback: if FTS found nothing, search chapter_entities table
  if (ftsResults.length === 0 && total === 0 && db_tags) {
    try {
      const col = type === 'place' ? 'places' : 'people';
      const altCol = col === 'people' ? 'places' : 'people';
      const key = searchName.toLowerCase();
      let chapterRows = db_tags.prepare(
        `SELECT chapter_id FROM chapter_entities WHERE lower(${col}) LIKE ?`
      ).all(`%${key}%`);
      if (chapterRows.length === 0) {
        chapterRows = db_tags.prepare(
          `SELECT chapter_id FROM chapter_entities WHERE lower(${altCol}) LIKE ?`
        ).all(`%${key}%`);
      }
      if (chapterRows.length > 0) {
        const allVerseIds = [];
        for (const { chapter_id } of chapterRows) {
          const vs = targetDb.prepare('SELECT verse_id FROM scriptures WHERE chapter_id = ? ORDER BY verse_number').all(chapter_id);
          vs.forEach(v => allVerseIds.push(v.verse_id));
        }
        const entTotal = allVerseIds.length;
        const offset = page * pageSize;
        const pageIds = allVerseIds.slice(offset, offset + pageSize);
        const entResults = pageIds.length > 0
          ? targetDb.prepare(`SELECT * FROM scriptures WHERE verse_id IN (${pageIds.map(() => '?').join(',')}) ORDER BY verse_id`).all(...pageIds)
          : [];
        const volumeMap = new Map();
        for (const r of entResults) {
          const vid = r.volume_id || 0;
          if (!volumeMap.has(vid)) volumeMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] });
          volumeMap.get(vid).results.push(r);
        }
        return { results: entResults, total: entTotal, name, type, page, pageSize, groups: [...volumeMap.values()] };
      }
    } catch { /* fall through */ }
  }

  // Group results by volume for organized display
  const volumeMap = new Map();
  for (const r of ftsResults) {
    const vid = r.volume_id || 0;
    if (!volumeMap.has(vid)) volumeMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] });
    volumeMap.get(vid).results.push(r);
  }
  const groups = [...volumeMap.values()];
  return { results: ftsResults, total, name, type, page, pageSize, groups };
});

// ── HTTP route: get doctrine tags for a verse ─────────────────────────────────
fastify.get('/verse/:verse_id/tags', async (request, reply) => {
  const verseId = parseInt(request.params.verse_id, 10);
  if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; }
  if (!db_tags) return { verse_id: verseId, pov: null, labels: [], ready: false };
  try {
    const row = db_tags.prepare('SELECT pov, labels_json, speaker FROM verse_doctrine_tags WHERE verse_id = ?').get(verseId);
    if (!row) return { verse_id: verseId, pov: null, labels: [], speaker: null, ready: false };
    return { verse_id: verseId, pov: row.pov, labels: JSON.parse(row.labels_json || '[]'), speaker: row.speaker || null, ready: true };
  } catch { return { verse_id: verseId, pov: null, labels: [], ready: false }; }
});

// ── HTTP route: get chapter summary + key verses + top topics ─────────────────
fastify.get('/chapter/:chapter_id/summary', async (request, reply) => {
  const chapterId = parseInt(request.params.chapter_id, 10);
  if (isNaN(chapterId)) { reply.code(400); return { error: 'Invalid chapter_id' }; }
  if (!db_chsummary) return { chapter_id: chapterId, summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false };
  try {
    const row = db_chsummary.prepare('SELECT summary_text, summary_method, key_verses_json, top_topics_json FROM chapter_summaries WHERE chapter_id = ?').get(chapterId);
    if (!row) return { chapter_id: chapterId, summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false };
    let nabre_footnotes = null;
    let net_footnotes = null;
    if (db_footnotes) {
      try {
        const fn = db_footnotes.prepare('SELECT bg_footnotes, net_notes FROM chapter_footnotes WHERE chapter_id = ?').get(chapterId);
        if (fn) { nabre_footnotes = fn.bg_footnotes || null; net_footnotes = fn.net_notes || null; }
      } catch (_) {}
    }
    return {
      chapter_id:      chapterId,
      summary_text:    row.summary_text,
      summary_method:  row.summary_method || 'extractive',
      key_verses:      JSON.parse(row.key_verses_json  || '[]'),
      top_topics:      JSON.parse(row.top_topics_json  || '[]'),
      nabre_footnotes,
      net_footnotes,
      ready: true
    };
  } catch { return { chapter_id: chapterId, summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false }; }
});

// ── HTTP route: get verse context summary ────────────────────────────────────
fastify.get('/verse/:verse_id/summary', async (request, reply) => {
  const verseId = parseInt(request.params.verse_id, 10);
  if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; }
  if (!db_vsummary) return { verse_id: verseId, summary: null, cross_references: [], ready: false };
  try {
    const row = db_vsummary.prepare('SELECT summary FROM verse_summaries WHERE verse_id = ?').get(verseId);
    if (!row || !row.summary) return { verse_id: verseId, summary: null, cross_references: [], ready: false };
    let xrefs = [];
    if (db_vxref) {
      try {
        const xr = db_vxref.prepare('SELECT cross_references FROM verse_cross_references WHERE verse_id = ?').get(verseId);
        if (xr) xrefs = JSON.parse(xr.cross_references || '[]');
      } catch {}
    }
    return {
      verse_id:         verseId,
      summary:          row.summary,
      cross_references: xrefs,
      ready:            true
    };
  } catch { return { verse_id: verseId, summary: null, cross_references: [], ready: false }; }
});

// ── HTTP route: get people & places for a chapter ──────────────────────────────
fastify.get('/chapter/:chapter_id/entities', async (request, reply) => {
  const chapterId = parseInt(request.params.chapter_id, 10);
  if (isNaN(chapterId)) { reply.code(400); return { error: 'Invalid chapter_id' }; }
  if (!db_tags) return { chapter_id: chapterId, people: [], places: [], ready: false };
  try {
    const row = db_tags.prepare('SELECT entities_json FROM chapter_entities WHERE chapter_id = ?').get(chapterId);
    if (!row || !row.entities_json) return { chapter_id: chapterId, people: [], places: [], ready: true };
    const j = JSON.parse(row.entities_json);
    return { chapter_id: chapterId, people: j.people || [], places: j.places || [], ready: true };
  } catch { return { chapter_id: chapterId, people: [], places: [], ready: false }; }
});

// ── HTTP route: sermon topic search (chapter-level) ──────────────────────────
fastify.get('/sermon-search', async (request, reply) => {
  const { q, limit: lim = '12' } = request.query;
  if (!q || !q.trim()) { reply.code(400); return { error: 'q is required' }; }
  if (!db_chsummary) return { results: [], total: 0, ready: false };
  const limit = Math.min(30, Math.max(1, parseInt(lim, 10) || 12));
  const term = q.trim().toLowerCase();
  try {
    const rows = db_chsummary.prepare(`
      SELECT cs.chapter_id, cs.book_id, cs.chapter_num, cs.summary_text, cs.top_topics_json
      FROM chapter_summaries_fts fts
      JOIN chapter_summaries cs ON cs.chapter_id = fts.rowid
      WHERE chapter_summaries_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(term, limit);
    const stmtTitle = dba.prepare('SELECT book_title FROM scriptures WHERE book_id = ? LIMIT 1');
    const results = rows.map(r => {
      const meta = stmtTitle.get(r.book_id);
      return {
        chapter_id:   r.chapter_id,
        book_id:      r.book_id,
        chapter_num:  r.chapter_num,
        book_title:   meta?.book_title || '',
        summary_text: r.summary_text || '',
        top_topics:   JSON.parse(r.top_topics_json || '[]').slice(0, 5),
      };
    });
    return { results, total: results.length, query: q };
  } catch (err) {
    fastify.log.error(err);
    return { results: [], total: 0, query: q };
  }
});

const start = async () => {
  try {
    const port = process.env.PORT || 3000 // default to 3095 if PORT is not set;
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`Server running on ${port}`)
    // Initialize FTS in background so health checks can pass immediately.
    // Skip in production/Electron — DBs are pre-built with FTS tables.
    if (!SKIP_RECOMPUTE) {
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
    } else {
      fastify.log.info('[FTS] Pre-built tables in use — skipping FTS init.');
    }
    // Load embedding cache (fast: just reads pre-stored data, never re-computes in production)
    setImmediate(() => initEmbeddings());
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

module.exports = { parseScriptureReference, searchScripture: searchScriptureDefault, segmentVerseText, segmentVerseTextDual, expandWithSynonyms, fastify, registerSocketHandlers, startElectron };
