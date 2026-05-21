const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: `scicp-backend@${require('./package.json').version}`,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.exception?.values?.[0]?.type === 'FastifyError') return null;
      return event;
    },
  });
}

const fastify = require('fastify')({ logger: true, bodyLimit: 1048576 });
const { Server } = require("socket.io");
// const { AutoTokenizer } = require('@xenova/transformers');
const ort = require('onnxruntime-node');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BetterSqliteAdapter } = require('../shared/db-adapter');
const engine = require('../shared/scripture-engine');
const { batchPhraseMatch } = require('./phrase-matcher');
const { replacements: kjvSpellingReplacements } = require('../shared/data/kjv-spellings.json');

const DB_DIR = process.env.DB_DIR || path.resolve(__dirname, '../resources/db');
const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST_DIR || path.resolve(__dirname, '../frontend/dist');

const SEO_ROUTES = {
  '/': {
    title: 'Scriptures in View | Real-Time Scripture Presentation',
    description: 'Free real-time scripture presentation for worship services, seminary, and family study. Search 41,000+ verses, project live to displays, and study with Reader Mode.',
  },
  '/about': {
    title: 'About | Scriptures in View',
    description: 'Learn what Scriptures in View can do for church worship, talks, lessons, and home scripture study. Free real-time scripture presentation for every ward and family.',
  },
  '/download': {
    title: 'Download | Scriptures in View',
    description: 'Download Scriptures in View for Windows, Mac, and Linux. Desktop apps work fully offline. Free scripture presentation for church and home.',
  },
  '/reader': {
    title: 'Read Scriptures | Scriptures in View',
    description: 'Read and study scriptures online with highlights, bookmarks, and five visual themes. Browse the Bible, Book of Mormon, Doctrine and Covenants, and Pearl of Great Price.',
  },
  '/contact': {
    title: 'Contact | Scriptures in View',
    description: 'Contact Dagami Ward Dev for support and feedback about Scriptures in View. Get help with scripture presentation for your ward or family.',
  },
  '/privacy': {
    title: 'Privacy Policy | Scriptures in View',
    description: 'Privacy policy for Scriptures in View. We collect minimal data and never sell your information.',
  },
  '/terms': {
    title: 'Terms of Service | Scriptures in View',
    description: 'Terms for using Scriptures in View for non-commercial church and home use. Free scripture presentation for worship services.',
  },
};

let _indexHtmlCache = null;
function getIndexHtml() {
  if (_indexHtmlCache) return _indexHtmlCache;
  try {
    _indexHtmlCache = fs.readFileSync(path.join(FRONTEND_DIST_DIR, 'index.html'), 'utf8');
  } catch { _indexHtmlCache = null; }
  return _indexHtmlCache;
}

function injectSeoMeta(html, routePath) {
  const seo = SEO_ROUTES[routePath];
  if (!seo) return html;
  const canon = `https://cap-teyyko.live${routePath === '/' ? '' : routePath}`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${seo.title}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${seo.description}"`);
  html = html.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${seo.title}"`);
  html = html.replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${seo.description}"`);
  html = html.replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${canon}/"`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${seo.title}"`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${seo.description}"`);
  if (!html.includes('rel="canonical"')) {
    html = html.replace('</head>', `  <link rel="canonical" href="${canon}/" />\n  </head>`);
  }
  return html;
}

const USER_DATA_DIR = process.env.USER_DATA_DIR || DB_DIR;
// In Electron packaged app, ONNX models are in app.asar.unpacked/resources/onnx
const ONNX_MODEL_DIR = process.env.ONNX_MODEL_DIR || path.resolve(__dirname, '../resources/onnx');
const SCRIPTURE_MODEL = 'scripture-bge';
const IS_ELECTRON_PKG = !!process.versions?.electron;
const DB_OPTS = { fileMustExist: true };
const SKIP_RECOMPUTE = IS_ELECTRON_PKG || process.env.NODE_ENV === 'production';

const db = require('better-sqlite3')(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), DB_OPTS);
const db_tagalog = require('better-sqlite3')(path.join(DB_DIR, 'tagalog-scriptures-sqlite.db'), DB_OPTS);
const db_cebuano = require('better-sqlite3')(path.join(DB_DIR, 'cebuano-scriptures-sqlite.db'), DB_OPTS);
const db_spanish = require('better-sqlite3')(path.join(DB_DIR, 'spanish-scriptures-sqlite.db'), DB_OPTS);
const db_greek = require('better-sqlite3')(path.join(DB_DIR, 'greek-scriptures-sqlite.db'), DB_OPTS);
const db_ilocano = require('better-sqlite3')(path.join(DB_DIR, 'ilocano-scriptures-sqlite.db'), DB_OPTS);


// Direct ONNX Runtime session (replaces Xenova pipeline)
let onnxSession = null;
let onnxTokenizer = null;

async function initOnnxSession() {
    try {
        const modelPath = path.join(ONNX_MODEL_DIR, SCRIPTURE_MODEL, 'onnx', 'model_quantized.onnx');
        if (!fs.existsSync(modelPath)) {
            fastify.log.warn(`[ONNX] Model not found at ${modelPath}, semantic search disabled`);
            return false;
        }
        fastify.log.info(`[ONNX] Loading model from ${modelPath}`);
        onnxSession = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
        });

        // ─── Load real vocabulary from tokenizer.json ─────────────────
        const tokenizerJsonPath = path.join(ONNX_MODEL_DIR, SCRIPTURE_MODEL, 'tokenizer.json');
        if (!fs.existsSync(tokenizerJsonPath)) {
            throw new Error(`Tokenizer file not found: ${tokenizerJsonPath}`);
        }
        const tokenizerData = JSON.parse(fs.readFileSync(tokenizerJsonPath, 'utf8'));
        // Extract vocab: usually tokenizer.json has "model" -> "vocab" object
        const vocab = tokenizerData.model?.vocab;
        if (!vocab) throw new Error('No vocab found in tokenizer.json');
        const wordToId = new Map();
        for (const [word, id] of Object.entries(vocab)) {
            wordToId.set(word, id);
        }
        fastify.log.info(`[ONNX] Loaded vocabulary with ${wordToId.size} entries`);

        // Create simple tokenizer using the real vocabulary
        onnxTokenizer = {
            encode: async (text) => {
                const tokens = [101]; // [CLS]
                const words = text.toLowerCase().split(/\s+/).slice(0, 63);
                for (const w of words) {
                    let tokenId = wordToId.get(w);
                    if (tokenId === undefined) {
                        // Fallback: hash (same as before, but now only for OOV)
                        let hash = 0;
                        for (let i = 0; i < w.length; i++) {
                            hash = ((hash << 5) - hash) + w.charCodeAt(i);
                            hash |= 0;
                        }
                        tokenId = Math.abs(hash) % 30000 + 1000;
                    }
                    tokens.push(tokenId);
                }
                tokens.push(102); // [SEP]
                while (tokens.length < 64) tokens.push(0);
                return {
                    input_ids: new ort.Tensor('int64', new BigInt64Array(tokens.map(BigInt)), [1, 64]),
                    attention_mask: new ort.Tensor('int64', new BigInt64Array(64).fill(1n), [1, 64])
                };
            }
        };

        fastify.log.info('[ONNX] Vocabulary-based tokenizer ready');
        return true;
    } catch (err) {
        fastify.log.error('[ONNX] Failed to initialize:', err.message);
        fastify.log.error(err.stack);
        onnxSession = null;
        onnxTokenizer = null;
        return false;
    }
}

async function embedWithOnnx(text) {
    if (!onnxSession || !onnxTokenizer) {
        throw new Error('ONNX session not ready');
    }
    
    const encoded = await onnxTokenizer(text);
    
    const feeds = {
        'input_ids': encoded.input_ids,
        'attention_mask': encoded.attention_mask
    };
    
    const results = await onnxSession.run(feeds);
    const tokenEmbeddings = results['last_hidden_state'].data;
    
    const batchSize = encoded.input_ids.dims[0];
    const seqLen = encoded.input_ids.dims[1];
    const dim = tokenEmbeddings.length / (batchSize * seqLen);
    const mask = encoded.attention_mask.data;
    const pooled = new Float32Array(batchSize * dim);
    
    for (let i = 0; i < batchSize; i++) {
        let validCount = 0;
        for (let j = 0; j < seqLen; j++) {
            if (mask[i * seqLen + j] > 0) {
                validCount++;
                for (let d = 0; d < dim; d++) {
                    pooled[i * dim + d] += tokenEmbeddings[(i * seqLen + j) * dim + d];
                }
            }
        }
        if (validCount > 0) {
            for (let d = 0; d < dim; d++) pooled[i * dim + d] /= validCount;
        }
    }
    
    let norm = 0;
    for (let i = 0; i < pooled.length; i++) norm += pooled[i] * pooled[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-9) {
        for (let i = 0; i < pooled.length; i++) pooled[i] /= norm;
    }
    
    return pooled;
}


let db_japanese = null;
try { db_japanese = require('better-sqlite3')(path.join(DB_DIR, 'japanese-scriptures-sqlite.db'), DB_OPTS); } catch (_) {}
let db_ylt = null;
try { db_ylt = require('better-sqlite3')(path.join(DB_DIR, 'ylt-scriptures-sqlite.db'), DB_OPTS); } catch (_) {}
let db_waray = null;
try { db_waray = require('better-sqlite3')(path.join(DB_DIR, 'waray-scriptures-sqlite.db'), DB_OPTS); } catch (_) {}

let db_tg = null;
try { db_tg = require('better-sqlite3')(path.join(DB_DIR, 'topical-guide.db'), { readonly: true, fileMustExist: true }); } catch (_) {}

let db_embed = null;
try {
  if (SKIP_RECOMPUTE) {
    db_embed = require('better-sqlite3')(path.join(DB_DIR, 'verse-embeddings.db'), { readonly: true, fileMustExist: true });
  } else {
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

let db_tags = null;
let db_chsummary = null;
let db_vsummary = null;
let db_vxref = null;
let db_graph = null;
let db_footnotes = null;

try { db_tags = require('better-sqlite3')(path.join(DB_DIR, 'verse-tags.db'), { readonly: true, fileMustExist: true }); } catch (_) {}
try { db_chsummary = require('better-sqlite3')(path.join(DB_DIR, 'chapter-summaries-fts.db'), { readonly: true, fileMustExist: true }); } catch (_) {}
try { db_vsummary = require('better-sqlite3')(path.join(DB_DIR, 'verse-summaries.db'), { readonly: true, fileMustExist: true }); } catch (_) {}
try { db_vxref = require('better-sqlite3')(path.join(DB_DIR, 'verse-cross-refs.db'), { readonly: true, fileMustExist: true }); } catch (_) {}
try { db_graph = require('better-sqlite3')(path.join(DB_DIR, 'verse-graph.db'), { readonly: true, fileMustExist: true }); } catch (_) {}
try { db_footnotes = require('better-sqlite3')(path.join(DB_DIR, 'footnotes-lds-summaries.db'), { readonly: true, fileMustExist: true }); } catch (_) {}

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

const dba = new BetterSqliteAdapter(db);
const dba_tagalog = new BetterSqliteAdapter(db_tagalog);
const dba_cebuano = new BetterSqliteAdapter(db_cebuano);
const dba_spanish = new BetterSqliteAdapter(db_spanish);
const dba_greek = new BetterSqliteAdapter(db_greek);
const dba_ilocano = new BetterSqliteAdapter(db_ilocano);
let dba_japanese = db_japanese ? new BetterSqliteAdapter(db_japanese) : null;
let dba_ylt = db_ylt ? new BetterSqliteAdapter(db_ylt) : null;
let dba_waray = db_waray ? new BetterSqliteAdapter(db_waray) : null;

const ENABLE_PMI = true;

let db_concepts = null;
const conceptCache = [];
const wordEmbeddingCache = new Map();

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
} catch (_) {}

if (conceptCache && conceptCache.length) {
  for (const concept of conceptCache) {
    if (!concept.phrase.includes(' ') && concept.phrase.length > 2 && concept.vec) {
      wordEmbeddingCache.set(concept.phrase.toLowerCase(), concept.vec);
    }
  }
  fastify.log.info(`[PhraseMatcher] Loaded ${wordEmbeddingCache.size} word embeddings from conceptCache`);
} else {
  fastify.log.warn('[PhraseMatcher] conceptCache not available, phrase matcher will be limited');
}

function resolveDbAdapter(language) {
  switch (language) {
    case 'ceb': return dba_cebuano;
    case 'tl': return dba_tagalog;
    case 'es': return dba_spanish;
    case 'el': return dba_greek;
    case 'ilo': return dba_ilocano;
    case 'ja': return dba_japanese || dba;
    case 'ylt': return dba_ylt || dba;
    case 'war': return dba_waray || dba;
    default: return dba;
  }
}

const fastifyStatic = require('@fastify/static');
const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');

fastify.register(require('@fastify/cors'), {
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.PUBLIC_ORIGIN || 'https://cap-teyyko.live']
    : true,
});

fastify.register(require('@fastify/helmet'), {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

fastify.register(require('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', '::1'],
});

fastify.register(fastifyStatic, {
  root: FRONTEND_DIST_DIR,
  prefix: '/',
});

fastify.setNotFoundHandler((request, reply) => {
  const html = getIndexHtml();
  if (html) {
    const routePath = request.url.split('?')[0].split('#')[0];
    const injected = injectSeoMeta(html, routePath);
    reply.type('text/html').send(injected);
  } else {
    reply.sendFile('index.html');
  }
});

fastify.get('/health', async () => {
  return {
    status: 'ok',
    version: require('./package.json').version,
    ready: !!(dba && db),
    hnswReady: !!hnswIndex,
    embeddingsReady,
    intentWeightsActive: intentWeights.size > 0,
    uptime: process.uptime(),
    timestamp: Date.now(),
  };
});

process.on('unhandledRejection', (reason) => {
  fastify.log.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  fastify.log.error(err, 'uncaughtException');
});

fastify.get('/config', async (request) => {
  const proto = request.headers['x-forwarded-proto'] || request.protocol;
  const publicOrigin = process.env.PUBLIC_ORIGIN || `${proto}://${request.hostname}`;
  return { publicOrigin };
});

const DOWNLOADABLE_DBS = new Set([
  'lds-scriptures-sqlite.db',
  'tagalog-scriptures-sqlite.db',
  'cebuano-scriptures-sqlite.db',
  'spanish-scriptures-sqlite.db',
  'greek-scriptures-sqlite.db',
  'ilocano-scriptures-sqlite.db',
  'japanese-scriptures-sqlite.db',
  'ylt-scriptures-sqlite.db',
  'waray-scriptures-sqlite.db',
  'topical-guide.db',
  'chapter-summaries-fts.db',
  'verse-tags.db',
  'verse-summaries.db',
  'verse-cross-refs.db',
  'search-graph.db',
  'footnotes-lds-summaries.db',
  'verse-embeddings.db',
]);

const DB_DOWNLOAD_TOKEN = process.env.DB_DOWNLOAD_TOKEN || 'scicp-v2-db-access';

fastify.get('/db/:filename', async (request, reply) => {
  const token = request.headers['x-scicp-token'];
  if (token !== DB_DOWNLOAD_TOKEN) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
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

fastify.get('/models/:model/*', async (request, reply) => {
  const { model } = request.params;
  if (model !== SCRIPTURE_MODEL) return reply.code(404).send({ error: 'Not found' });
  const relPath = request.params['*'];
  if (!relPath || relPath.includes('..')) return reply.code(400).send({ error: 'Bad path' });
  const filePath = path.join(ONNX_MODEL_DIR, model, relPath);
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ct = ext === '.onnx' ? 'application/octet-stream' : ext === '.json' ? 'application/json' : 'application/octet-stream';
    return reply
      .header('Content-Type', ct)
      .header('Content-Length', stat.size)
      .header('Cache-Control', 'public, max-age=604800')
      .send(fs.createReadStream(filePath));
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
    db_user.prepare('UPDATE setlists SET name = ?, items = ? WHERE id = ?').run(name, JSON.stringify(items || []), id);
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

fastify.post('/reading-event', async (request, reply) => {
  try {
    const { verse_id, book_id, chapter_id, book_title, chapter_number, verse_number,
            language = 'en', session_id, dwell_ms = 0, event_type = 'read' } = request.body || {};
    if (!verse_id) { reply.code(400); return { error: 'verse_id required' }; }

    db_user.prepare(`
      INSERT INTO reading_events (verse_id, book_id, chapter_id, book_title, chapter_number, verse_number, language, session_id, dwell_ms, event_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(verse_id, book_id || null, chapter_id || null, book_title || null,
           chapter_number || null, verse_number || null, language, session_id || null,
           Math.min(dwell_ms || 0, 300000), event_type);

    if (event_type === 'highlight' || event_type === 'bookmark' || (dwell_ms > 0 && dwell_ms >= 8000)) {
      const existing = db_user.prepare('SELECT * FROM spaced_reviews WHERE verse_id = ?').get(verse_id);
      const quality = dwell_ms >= 20000 ? 5 : dwell_ms >= 12000 ? 4 : 3;
      if (!existing) {
        const interval = quality >= 4 ? 4 : 1;
        const nextReview = Date.now() + interval * 86400000;
        db_user.prepare(`
          INSERT OR REPLACE INTO spaced_reviews (verse_id, easiness, interval_days, repetitions, next_review, last_review)
          VALUES (?, 2.5, ?, 1, ?, ?)
        `).run(verse_id, interval, nextReview, Date.now());
      } else {
        const newEase = Math.max(1.3, existing.easiness + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        const newReps = existing.repetitions + 1;
        const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(existing.interval_days * newEase);
        const nextReview = Date.now() + newInterval * 86400000;
        db_user.prepare(`
          UPDATE spaced_reviews SET easiness = ?, interval_days = ?, repetitions = ?, next_review = ?, last_review = ?
          WHERE verse_id = ?
        `).run(newEase, newInterval, newReps, nextReview, Date.now(), verse_id);
      }
    }

    return { ok: true };
  } catch (err) {
    fastify.log.warn({ err }, '/reading-event failed');
    reply.code(500);
    return { error: 'failed' };
  }
});

fastify.post('/search-feedback', async (request, reply) => {
  try {
    const { query, verse_id, rank_shown, source, intent } = request.body || {};
    if (!query || !verse_id) { reply.code(400); return { error: 'query and verse_id required' }; }
    db_user.prepare('INSERT INTO search_feedback (query, verse_id, rank_shown, source, intent) VALUES (?, ?, ?, ?, ?)')
      .run(String(query), Number(verse_id), Number(rank_shown) || 0, source || null, intent || null);

    if (request.body.tier != null && request.body.raw_score != null) {
      db_user.prepare('INSERT INTO search_calibration (ts, tier, raw_score, clicked) VALUES (?, ?, ?, ?)')
        .run(Date.now(), Number(request.body.tier), Number(request.body.raw_score), 1);
    }

    const count = db_user.prepare('SELECT COUNT(*) AS n FROM search_feedback WHERE ts > ?').get(Date.now() - 3600000).n;
    if (count % 20 === 0 && count > 0) updateLearnedWeights();
    if (count % 20 === 0 && count > 0) fitCalibrationCurves();

    return { ok: true };
  } catch (err) {
    fastify.log.warn({ err }, '/search-feedback failed');
    reply.code(500);
    return { error: 'failed' };
  }
});

fastify.get('/reading-coverage', async (request, reply) => {
  try {
    const rows = db_user.prepare(`
      SELECT chapter_id, book_id, book_title, chapter_number,
             COUNT(*) AS read_count,
             MAX(ts) AS last_read,
             SUM(dwell_ms) AS total_dwell_ms
      FROM reading_events
      WHERE event_type = 'read' AND chapter_id IS NOT NULL
      GROUP BY chapter_id
      ORDER BY last_read DESC
    `).all();
    return { coverage: rows };
  } catch (err) {
    fastify.log.warn({ err }, '/reading-coverage failed');
    return { coverage: [] };
  }
});

fastify.get('/spaced-review', async (request, reply) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(request.query.limit || '10', 10)));
    const now = Date.now();
    const due = db_user.prepare(`
      SELECT sr.verse_id, sr.easiness, sr.interval_days, sr.repetitions, sr.next_review, sr.last_review
      FROM spaced_reviews sr
      WHERE sr.next_review <= ?
      ORDER BY sr.next_review ASC
      LIMIT ?
    `).all(now + 86400000, limit);

    const results = [];
    for (const row of due) {
      try {
        const verse = dba.prepare(`
          SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id
          FROM scriptures WHERE verse_id = ?
        `).get(row.verse_id);
        if (verse) results.push({ ...verse, review: { easiness: row.easiness, interval_days: row.interval_days, repetitions: row.repetitions, next_review: row.next_review, overdue: row.next_review < now } });
      } catch {}
    }
    return { verses: results, total: results.length };
  } catch (err) {
    fastify.log.warn({ err }, '/spaced-review failed');
    return { verses: [], total: 0 };
  }
});

fastify.get('/reading-stats', async (request, reply) => {
  try {
    const recentSessions = db_user.prepare(`
      SELECT session_id, GROUP_CONCAT(verse_id) AS verse_sequence
      FROM reading_events
      WHERE event_type = 'read' AND session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY MAX(ts) DESC
      LIMIT 200
    `).all();

    const topDwell = db_user.prepare(`
      SELECT verse_id, COUNT(*) AS visits, AVG(dwell_ms) AS avg_dwell, SUM(dwell_ms) AS total_dwell
      FROM reading_events
      WHERE event_type = 'read' AND dwell_ms > 5000
      GROUP BY verse_id
      ORDER BY total_dwell DESC
      LIMIT 100
    `).all();

    return {
      sessions: recentSessions.map(s => ({ session_id: s.session_id, verses: s.verse_sequence?.split(',').map(Number).filter(Boolean) || [] })),
      top_dwell: topDwell
    };
  } catch (err) {
    fastify.log.warn({ err }, '/reading-stats failed');
    return { sessions: [], top_dwell: [] };
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
  const { chapter_id, language, limit: limitStr, offset: offsetStr } = request.query;
  if (!chapter_id) { reply.code(400); return { error: 'chapter_id is required' }; }
  const limit = Math.min(500, Math.max(1, parseInt(limitStr, 10) || 500));
  const offset = Math.max(0, parseInt(offsetStr, 10) || 0);
  const targetDb = resolveDbAdapter(language);
  try {
    return engine.browseVerses(targetDb, chapter_id, { limit, offset });
  } catch (err) {
    fastify.log.error('browse/verses failed', err);
    reply.code(500);
    return { error: 'fetch failed' };
  }
});

fastify.get('/search', async (request, reply) => {
  const { q, language = 'en', page: pStr = '0', pageSize: psStr = '10', contextVerseId: cvidStr, cursor: cursorStr } = request.query;
  if (!q || !q.trim()) { reply.code(400); return { error: 'q is required' }; }
  const pageSize = Math.min(50, Math.max(1, parseInt(psStr, 10) || 10));
  const contextVerseId = cvidStr ? (Number(cvidStr) || null) : null;
  const lang = (language || 'en').toLowerCase().trim();
  try {
    let offset = 0;
    let pipelineResults, total, cacheKey, pipelineMeta;

    if (cursorStr) {
      const decoded = decodeCursor(cursorStr);
      if (decoded) {
        const cached = searchCacheGet(decoded.k);
        if (cached) {
          offset = decoded.o;
          pipelineResults = cached.results;
          total = cached.total;
          pipelineMeta = cached.meta;
          cacheKey = decoded.k;
        }
      }
      if (!pipelineResults) {
        const fresh = await runSearchPipeline(q.trim(), lang, contextVerseId, fastify.log);
        pipelineResults = fresh.results; total = fresh.total; pipelineMeta = fresh.meta; cacheKey = fresh.cacheKey; offset = 0;
      }
    } else {
      const page = Math.max(0, parseInt(pStr, 10) || 0);
      const fresh = await runSearchPipeline(q.trim(), lang, contextVerseId, fastify.log);
      pipelineResults = fresh.results; total = fresh.total; pipelineMeta = fresh.meta; cacheKey = fresh.cacheKey;
      offset = page * pageSize;
    }

    const pageResults = pipelineResults.slice(offset, offset + pageSize);
    const nextOffset = offset + pageResults.length;
    const hasMore = nextOffset < total;
    const nextCursor = hasMore ? encodeCursor(cacheKey, nextOffset, total) : null;
    const page = Math.floor(offset / pageSize);

    return { results: pageResults, total, nextCursor, meta: pipelineMeta, page, pageSize, query: q, language: lang };
  } catch (err) {
    fastify.log.error({ err }, '/search failed');
    reply.code(500);
    return { results: [], total: 0, nextCursor: null, page: 0, pageSize };
  }
});

fastify.get('/suggest', async (request, reply) => {
  const { q, limit: lStr = '8' } = request.query;
  if (!q || q.trim().length < 2) return { suggestions: [] };
  const limit = Math.min(15, Math.max(1, parseInt(lStr, 10) || 8));
  const term = q.trim().toLowerCase();
  try {
    const vocabRows = db.prepare(`SELECT DISTINCT term FROM scriptures_fts_vocab WHERE term LIKE ? AND length(term) > 2 ORDER BY doc DESC LIMIT ?`).all(`${term}%`, limit);
    const bookRows = db.prepare(`SELECT book_title AS term FROM books WHERE lower(book_title) LIKE ? LIMIT 5`).all(`%${term}%`);
    const seen = new Set();
    const suggestions = [...vocabRows, ...bookRows].map(r => r.term).filter(t => { if (seen.has(t)) return false; seen.add(t); return true; }).slice(0, limit);
    return { suggestions };
  } catch (err) {
    fastify.log.warn({ err }, '/suggest failed');
    return { suggestions: [] };
  }
});

const SERVICE_CONFIG = {
  PING_INTERVAL_MS: 25000,
  PING_TIMEOUT_MS: 90000,
  SESSION_GRACE_MS: 4 * 60 * 60 * 1000,
  SESSION_NO_VIEWER_GRACE_MS: 2 * 60 * 1000,
  PRESENTER_LEFT_DEBOUNCE_MS: 5000,
  MAX_SESSIONS: 50,
};

const io = new Server(fastify.server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? [process.env.PUBLIC_ORIGIN || 'https://cap-teyyko.live'] : '*',
  },
  pingInterval: SERVICE_CONFIG.PING_INTERVAL_MS,
  pingTimeout: SERVICE_CONFIG.PING_TIMEOUT_MS,
  maxHttpBufferSize: 100 * 1024,
});

const db_user = require('better-sqlite3')(path.join(USER_DATA_DIR, 'user-data.db'));
db_user.exec(`
  CREATE TABLE IF NOT EXISTS setlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    items      TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE TABLE IF NOT EXISTS reading_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id    INTEGER NOT NULL,
    book_id     INTEGER,
    chapter_id  INTEGER,
    book_title  TEXT,
    chapter_number INTEGER,
    verse_number   INTEGER,
    language    TEXT NOT NULL DEFAULT 'en',
    session_id  TEXT,
    dwell_ms    INTEGER DEFAULT 0,
    event_type  TEXT NOT NULL DEFAULT 'read',
    ts          INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_re_verse  ON reading_events(verse_id);
  CREATE INDEX IF NOT EXISTS idx_re_ts     ON reading_events(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_re_session ON reading_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_re_chapter ON reading_events(chapter_id);
  CREATE TABLE IF NOT EXISTS spaced_reviews (
    verse_id      INTEGER PRIMARY KEY,
    easiness      REAL    NOT NULL DEFAULT 2.5,
    interval_days REAL    NOT NULL DEFAULT 1.0,
    repetitions   INTEGER NOT NULL DEFAULT 0,
    next_review   INTEGER NOT NULL DEFAULT 0,
    last_review   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS reading_sessions (
    id          TEXT PRIMARY KEY,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    verse_count INTEGER NOT NULL DEFAULT 0,
    language    TEXT NOT NULL DEFAULT 'en'
  );
  CREATE TABLE IF NOT EXISTS search_feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    query      TEXT NOT NULL,
    verse_id   INTEGER NOT NULL,
    rank_shown INTEGER NOT NULL,
    source     TEXT,
    intent     TEXT,
    ts         INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_sf_query ON search_feedback(query);
  CREATE INDEX IF NOT EXISTS idx_sf_ts    ON search_feedback(ts DESC);
`);
try { db_user.exec('ALTER TABLE search_feedback ADD COLUMN intent TEXT'); } catch {}

const DEFAULT_WEIGHTS = [1.0, 0.8, 0.3, 0.5, 0.3, 0.15];
let learnedWeights = [...DEFAULT_WEIGHTS];

try {
  db_user.exec(`
    CREATE TABLE IF NOT EXISTS learned_weights (
      key   TEXT PRIMARY KEY,
      value REAL NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    )
  `);
  const stored = db_user.prepare('SELECT key, value FROM learned_weights').all();
  for (const { key, value } of stored) {
    const idx = parseInt(key.replace('w', ''), 10);
    if (!isNaN(idx) && idx < learnedWeights.length) learnedWeights[idx] = value;
  }
} catch {}

const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;
const ADAM_LR = 0.01;
let adamM = new Float64Array(learnedWeights.length);
let adamV = new Float64Array(learnedWeights.length);
let adamT = 0;

try {
  const mRow = db_user.prepare("SELECT value FROM learned_weights WHERE key = 'adam_m'").get();
  const vRow = db_user.prepare("SELECT value FROM learned_weights WHERE key = 'adam_v'").get();
  const tRow = db_user.prepare("SELECT value FROM learned_weights WHERE key = 'adam_t'").get();
  if (mRow) adamM = new Float64Array(JSON.parse(mRow.value));
  if (vRow) adamV = new Float64Array(JSON.parse(vRow.value));
  if (tRow) adamT = parseInt(tRow.value, 10) || 0;
} catch {}

const INTENT_WEIGHT_SEEDS = {
  reference: [1.4, 0.1, 0.0, 0.1, 0.0, 0.05],
  entity: [0.8, 0.4, 0.9, 0.9, 0.1, 0.1],
  situational: [0.5, 1.3, 0.2, 0.7, 0.3, 0.3],
  conceptual: [0.3, 1.4, 0.3, 0.6, 0.2, 0.2],
  mixed: [0.9, 0.9, 0.3, 0.5, 0.2, 0.15],
  keyword: [1.0, 0.8, 0.3, 0.4, 0.2, 0.15],
};

const intentWeights = new Map();
const intentAdamM = new Map();
const intentAdamV = new Map();
const intentAdamT = new Map();

for (const [type, seed] of Object.entries(INTENT_WEIGHT_SEEDS)) {
  intentWeights.set(type, new Float64Array(seed));
  intentAdamM.set(type, new Float64Array(6));
  intentAdamV.set(type, new Float64Array(6));
  intentAdamT.set(type, 0);
}

try {
  db_user.exec(`
    CREATE TABLE IF NOT EXISTS intent_weights (
      intent_type TEXT PRIMARY KEY,
      weights     TEXT NOT NULL,
      adam_m      TEXT NOT NULL,
      adam_v      TEXT NOT NULL,
      adam_t      INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    )
  `);
  const rows = db_user.prepare('SELECT intent_type, weights, adam_m, adam_v, adam_t FROM intent_weights').all();
  for (const r of rows) {
    if (!intentWeights.has(r.intent_type)) continue;
    try {
      intentWeights.set(r.intent_type, new Float64Array(JSON.parse(r.weights)));
      intentAdamM.set(r.intent_type, new Float64Array(JSON.parse(r.adam_m)));
      intentAdamV.set(r.intent_type, new Float64Array(JSON.parse(r.adam_v)));
      intentAdamT.set(r.intent_type, r.adam_t || 0);
    } catch {}
  }
} catch {}

function getIntentWeights(intentType) {
  return intentWeights.get(intentType) || new Float64Array(learnedWeights);
}

const SRC_WEIGHT_IDX = {
  'fts': 0, 'fts-phrase': 0, 'semantic': 1, 'semantic-primary': 1, 'knn-expand': 1,
  'pagerank': 2, 'entity-person': 2, 'entity-place': 2,
  'cross-ref': 3, 'topical-guide': 3, 'summary': 3,
  'cluster': 4, 'chapter-agg': 4,
  'dwell': 5,
};

function updateLearnedWeights() {
  try {
    const cutoff = Date.now() - 7 * 86400000;
    const rawFeedback = db_user.prepare('SELECT query, verse_id, rank_shown, source, intent, ts FROM search_feedback WHERE ts > ? ORDER BY ts ASC LIMIT 1000').all(cutoff);
    if (rawFeedback.length < 10) return;

    const SPAM_WINDOW_MS = 90000;
    const SPAM_MAX_EVENTS = 12;
    const spamTs = new Set();
    for (let i = 0; i < rawFeedback.length; i++) {
      let count = 0;
      const t0 = rawFeedback[i].ts;
      for (let j = i; j < rawFeedback.length && rawFeedback[j].ts - t0 <= SPAM_WINDOW_MS; j++) count++;
      if (count > SPAM_MAX_EVENTS) {
        for (let j = i; j < rawFeedback.length && rawFeedback[j].ts - t0 <= SPAM_WINDOW_MS; j++) spamTs.add(rawFeedback[j].ts);
      }
    }

    const ipsWeighted = rawFeedback.filter(fb => fb.rank_shown >= 0 && fb.rank_shown < 50 && !spamTs.has(fb.ts)).map(fb => ({ ...fb, ipw: Math.sqrt(fb.rank_shown + 1) }));
    if (ipsWeighted.length < 5) return;

    const srcBuckets = new Map();
    for (const fb of ipsWeighted) {
      const src = fb.source || 'fts';
      if (!srcBuckets.has(src)) srcBuckets.set(src, []);
      srcBuckets.get(src).push(fb.ipw / Math.max(1, fb.rank_shown + 1));
    }
    const srcStats = new Map();
    for (const [src, vals] of srcBuckets) {
      const n = vals.length;
      const mu = vals.reduce((a, b) => a + b, 0) / n;
      const sig = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / n) || 1e-9;
      srcStats.set(src, { mu, sig });
    }
    const cleanFeedback = ipsWeighted.filter(fb => {
      const { mu, sig } = srcStats.get(fb.source || 'fts') || { mu: 0, sig: 1 };
      const rrk = fb.ipw / Math.max(1, fb.rank_shown + 1);
      return Math.abs(rrk - mu) <= 2.5 * sig;
    });
    if (cleanFeedback.length < 5) return;

    const deltas = new Float64Array(learnedWeights.length);
    const ipwSums = new Float64Array(learnedWeights.length);
    for (const fb of cleanFeedback) {
      const wIdx = SRC_WEIGHT_IDX[fb.source] ?? 0;
      const rrk = fb.ipw / Math.max(1, fb.rank_shown + 1);
      deltas[wIdx] += (rrk - 0.15) * 0.01 * fb.ipw;
      ipwSums[wIdx] += fb.ipw;
    }
    adamT++;
    for (let i = 0; i < learnedWeights.length; i++) {
      if (ipwSums[i] === 0) continue;
      const g = deltas[i] / ipwSums[i];
      adamM[i] = ADAM_BETA1 * adamM[i] + (1 - ADAM_BETA1) * g;
      adamV[i] = ADAM_BETA2 * adamV[i] + (1 - ADAM_BETA2) * g * g;
      const mHat = adamM[i] / (1 - Math.pow(ADAM_BETA1, adamT));
      const vHat = adamV[i] / (1 - Math.pow(ADAM_BETA2, adamT));
      const step = ADAM_LR * mHat / (Math.sqrt(vHat) + ADAM_EPS);
      const damp = Math.abs(step) > 0.2 * Math.abs(learnedWeights[i]) ? step * 0.5 : step;
      learnedWeights[i] = Math.max(0.05, Math.min(3.0, learnedWeights[i] + damp));
    }

    const intentBuckets = new Map();
    for (const fb of cleanFeedback) {
      if (!fb.intent) continue;
      if (!intentBuckets.has(fb.intent)) intentBuckets.set(fb.intent, []);
      intentBuckets.get(fb.intent).push(fb);
    }
    const intentStmt = db_user.prepare('INSERT OR REPLACE INTO intent_weights (intent_type, weights, adam_m, adam_v, adam_t, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [intentType, iFb] of intentBuckets) {
      if (iFb.length < 3 || !intentWeights.has(intentType)) continue;
      const W = intentWeights.get(intentType);
      const M = intentAdamM.get(intentType);
      const V = intentAdamV.get(intentType);
      const T = (intentAdamT.get(intentType) || 0) + 1;
      intentAdamT.set(intentType, T);
      const iDeltas = new Float64Array(6);
      const iIpwSums = new Float64Array(6);
      for (const fb of iFb) {
        const wIdx = SRC_WEIGHT_IDX[fb.source] ?? 0;
        const rrk = fb.ipw / Math.max(1, fb.rank_shown + 1);
        iDeltas[wIdx] += (rrk - 0.15) * 0.01 * fb.ipw;
        iIpwSums[wIdx] += fb.ipw;
      }
      for (let i = 0; i < 6; i++) {
        if (iIpwSums[i] === 0) continue;
        const g = iDeltas[i] / iIpwSums[i];
        M[i] = ADAM_BETA1 * M[i] + (1 - ADAM_BETA1) * g;
        V[i] = ADAM_BETA2 * V[i] + (1 - ADAM_BETA2) * g * g;
        const mH = M[i] / (1 - Math.pow(ADAM_BETA1, T));
        const vH = V[i] / (1 - Math.pow(ADAM_BETA2, T));
        const step = ADAM_LR * mH / (Math.sqrt(vH) + ADAM_EPS);
        const damp = Math.abs(step) > 0.2 * Math.abs(W[i]) ? step * 0.5 : step;
        W[i] = Math.max(0.02, Math.min(4.0, W[i] + damp));
      }
      intentStmt.run(intentType, JSON.stringify(Array.from(W)), JSON.stringify(Array.from(M)), JSON.stringify(Array.from(V)), T, Date.now());
    }

    const stmt = db_user.prepare('INSERT OR REPLACE INTO learned_weights (key, value) VALUES (?, ?)');
    db_user.transaction(() => {
      learnedWeights.forEach((w, i) => stmt.run(`w${i}`, w));
      stmt.run('adam_m', JSON.stringify(Array.from(adamM)));
      stmt.run('adam_v', JSON.stringify(Array.from(adamV)));
      stmt.run('adam_t', String(adamT));
    })();

    fastify.log.info(`[WeightLearning] t=${adamT} global=[${learnedWeights.map(w => w.toFixed(3)).join(',')}] intents=[${[...intentBuckets.keys()].join(',')}] clean=${cleanFeedback.length}/${rawFeedback.length}`);
  } catch (err) {
    fastify.log.warn({ err }, 'updateLearnedWeights failed');
  }
}

setImmediate(() => { try { updateLearnedWeights(); } catch {} });

let calibrationCurves = new Map();

function pavCalibrate(points) {
  if (points.length < 5) return null;
  points.sort((a, b) => a.x - b.x);
  const blocks = points.map(p => ({ sum: p.y, count: 1, minX: p.x, maxX: p.x }));
  let i = 0;
  while (i < blocks.length - 1) {
    const mean_i = blocks[i].sum / blocks[i].count;
    const mean_next = blocks[i + 1].sum / blocks[i + 1].count;
    if (mean_i > mean_next) {
      blocks[i].sum += blocks[i + 1].sum;
      blocks[i].count += blocks[i + 1].count;
      blocks[i].maxX = blocks[i + 1].maxX;
      blocks.splice(i + 1, 1);
      if (i > 0) i--;
    } else {
      i++;
    }
  }
  return blocks.map(b => ({ x: (b.minX + b.maxX) / 2, y: b.sum / b.count }));
}

function calibrateScore(tier, rawScore) {
  const curve = calibrationCurves.get(tier);
  if (!curve || curve.length < 2) return rawScore;
  const maxY = curve.reduce((m, p) => Math.max(m, p.y), 0);
  if (maxY < 0.01) return rawScore;
  if (rawScore <= curve[0].x) return curve[0].y;
  if (rawScore >= curve[curve.length - 1].x) return curve[curve.length - 1].y;
  for (let i = 0; i < curve.length - 1; i++) {
    if (rawScore >= curve[i].x && rawScore <= curve[i + 1].x) {
      const t = (rawScore - curve[i].x) / (curve[i + 1].x - curve[i].x);
      return curve[i].y + t * (curve[i + 1].y - curve[i].y);
    }
  }
  return rawScore;
}

function fitCalibrationCurves() {
  try {
    const cutoff = Date.now() - 14 * 86400000;
    const feedback = db_user.prepare(`SELECT tier, raw_score, clicked FROM search_calibration WHERE ts > ? ORDER BY tier, raw_score`).all(cutoff);
    if (feedback.length < 20) return;
    const byTier = new Map();
    for (const f of feedback) {
      if (!byTier.has(f.tier)) byTier.set(f.tier, []);
      byTier.get(f.tier).push({ x: f.raw_score, y: f.clicked });
    }
    for (const [tier, points] of byTier) {
      const curve = pavCalibrate(points);
      if (curve) calibrationCurves.set(tier, curve);
    }
    const curvesJson = {};
    for (const [tier, curve] of calibrationCurves) curvesJson[tier] = curve;
    db_user.prepare('INSERT OR REPLACE INTO learned_weights (key, value) VALUES (?, ?)').run('calibration_curves', JSON.stringify(curvesJson));
    fastify.log.info(`[Calibration] Fitted PAV curves for ${calibrationCurves.size} tiers (${feedback.length} data points)`);
  } catch (err) {
    fastify.log.warn({ err }, 'fitCalibrationCurves failed');
  }
}

try {
  db_user.exec(`
    CREATE TABLE IF NOT EXISTS search_calibration (
      ts INTEGER NOT NULL,
      tier INTEGER NOT NULL,
      raw_score REAL NOT NULL,
      clicked INTEGER NOT NULL DEFAULT 0
    )
  `);
  db_user.exec('CREATE INDEX IF NOT EXISTS idx_calibration_ts ON search_calibration(ts)');
} catch {}

try {
  const row = db_user.prepare("SELECT value FROM learned_weights WHERE key = 'calibration_curves'").get();
  if (row) {
    const parsed = JSON.parse(row.value);
    for (const [tier, curve] of Object.entries(parsed)) {
      calibrationCurves.set(Number(tier), curve);
    }
  }
} catch {}

const ITEM2VEC_DIM = 64;
let item2vecVectors = new Map();
let item2vecReady = false;

function item2vecDot(a, b) {
  let s = 0;
  for (let i = 0; i < ITEM2VEC_DIM; i++) s += a[i] * b[i];
  return s;
}

function item2vecNorm(v) {
  let s = 0;
  for (let i = 0; i < ITEM2VEC_DIM; i++) s += v[i] * v[i];
  return Math.sqrt(s) || 1;
}

function item2vecSimilarity(a, b) {
  return item2vecDot(a, b) / (item2vecNorm(a) * item2vecNorm(b));
}

function trainItem2Vec() {
  try {
    const sessionRows = db_user.prepare(`SELECT session_id, GROUP_CONCAT(verse_id) AS seq FROM reading_events WHERE event_type = 'read' AND session_id IS NOT NULL AND verse_id IS NOT NULL GROUP BY session_id HAVING COUNT(*) >= 3 ORDER BY MAX(ts) DESC LIMIT 500`).all();
    const pairs = [];
    for (const row of sessionRows) {
      const seq = row.seq.split(',').map(Number).filter(Boolean);
      for (let i = 0; i < seq.length; i++) {
        for (let j = Math.max(0, i - 2); j <= Math.min(seq.length - 1, i + 2); j++) {
          if (i !== j) pairs.push([seq[i], seq[j]]);
        }
      }
    }
    if (pairs.length < 50 && db_graph) {
      fastify.log.info('[Item2Vec] No session data yet — warm-starting from verse_knn');
      const knnSample = db_graph.prepare('SELECT verse_id, neighbor_id FROM verse_knn WHERE rank <= 3 ORDER BY RANDOM() LIMIT 5000').all();
      for (const r of knnSample) pairs.push([r.verse_id, r.neighbor_id]);
    }
    if (pairs.length === 0) return;
    const verseIds = [...new Set(pairs.flat())];
    const scale = 1 / Math.sqrt(ITEM2VEC_DIM);
    const newVectors = new Map();
    for (const vid of verseIds) {
      const v = new Float32Array(ITEM2VEC_DIM);
      for (let i = 0; i < ITEM2VEC_DIM; i++) v[i] = (Math.random() * 2 - 1) * scale;
      newVectors.set(vid, v);
    }
    const lr = 0.025;
    const k = 5;
    const verseArray = verseIds;
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    for (const [center, context] of pairs) {
      const vc = newVectors.get(center);
      const vctx = newVectors.get(context);
      if (!vc || !vctx) continue;
      const dot = item2vecDot(vc, vctx);
      const sigmoid = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, dot))));
      const err = (1 - sigmoid) * lr;
      for (let i = 0; i < ITEM2VEC_DIM; i++) {
        vc[i] += err * vctx[i];
        vctx[i] += err * vc[i];
      }
      for (let n = 0; n < k; n++) {
        const negId = verseArray[Math.floor(Math.random() * verseArray.length)];
        if (negId === center || negId === context) continue;
        const vneg = newVectors.get(negId);
        if (!vneg) continue;
        const ndot = item2vecDot(vc, vneg);
        const nsig = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, ndot))));
        const nerr = -nsig * lr;
        for (let i = 0; i < ITEM2VEC_DIM; i++) {
          vc[i] += nerr * vneg[i];
          vneg[i] += nerr * vc[i];
        }
      }
    }
    item2vecVectors = newVectors;
    item2vecReady = true;
    fastify.log.info(`[Item2Vec] Trained on ${pairs.length} pairs, ${verseIds.length} verses`);
  } catch (err) {
    fastify.log.warn({ err }, '[Item2Vec] Training failed');
  }
}

setImmediate(() => trainItem2Vec());
setInterval(() => trainItem2Vec(), 30 * 60 * 1000);

const { initializeFts, segmentVerseText, segmentVerseTextDual, parseScriptureReference,
        searchScripture, searchScriptureInDb, getAdjacentVerse, fetchVerseByCoords,
        getVersionCitation, getVerseOfTheDay, VOTD_POOL, phraseSearch,
        BIBLE_CITATIONS, TRIPLE_CITATIONS, LANGUAGE_NAMES } = engine;

const REBUILD_EMBEDDINGS = process.env.REBUILD_EMBEDDINGS === 'true';
const EMBED_BATCH_SIZE = 50;

let embeddingsReady = false;
let embeddingPipe = null;
const embeddingCache = new Map();
let searchWarmupPromise = null;

let whiteningW = null;
let whiteningMean = null;
const EMBED_DIM = 768;
const entityCentroidCache = new Map();
const verseMetaCache = new Map();

const spectralCache = new Map();
let spectralReady = false;
const SPECTRAL_DIM = 50;
const SPECTRAL_BLEND = 0.15;

const verseTopicCache = new Map();
const topicVerseIndex = new Map();
const topicNameMap = new Map();
const pageRankCache = new Map();
let pageRankP95 = 1;
let topicalGuideReady = false;

function buildTopicalGuideCache() {
  if (!db_tg) return;
  try {
    const hasPreBaked = db_tg.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='topic_verse_index'").get()?.n > 0;
    if (hasPreBaked) {
      const topics = db_tg.prepare('SELECT id, slug, name FROM topics').all();
      for (const t of topics) topicNameMap.set(t.slug, t.name);
      const vtRows = db_tg.prepare('SELECT verse_id, topic_slugs FROM verse_topics').all();
      for (const r of vtRows) {
        const slugs = JSON.parse(r.topic_slugs);
        verseTopicCache.set(r.verse_id, new Set(slugs));
      }
      const tiRows = db_tg.prepare('SELECT topic_slug, verse_id FROM topic_verse_index').all();
      for (const r of tiRows) {
        if (!topicVerseIndex.has(r.topic_slug)) topicVerseIndex.set(r.topic_slug, new Set());
        topicVerseIndex.get(r.topic_slug).add(r.verse_id);
      }
      try {
        const prRows = db_tg.prepare('SELECT verse_id, pagerank FROM verse_pagerank').all();
        const prValues = [];
        for (const r of prRows) {
          pageRankCache.set(r.verse_id, r.pagerank);
          if (r.pagerank > 0) prValues.push(r.pagerank);
        }
        if (prValues.length > 0) {
          prValues.sort((a, b) => a - b);
          pageRankP95 = prValues[Math.floor((prValues.length - 1) * 0.95)] || prValues[prValues.length - 1] || 1;
        }
        fastify.log.info(`[PageRank] Loaded ${pageRankCache.size} scores`);
      } catch {}
      topicalGuideReady = true;
      fastify.log.info(`[TG] Pre-baked: ${topicNameMap.size} topics, ${verseTopicCache.size} verses`);
      return;
    }
  } catch {}
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

function whitenVector(raw) {
  if (!whiteningW || !whiteningMean) return raw;
  const centered = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) centered[i] = raw[i] - whiteningMean[i];
  const w = new Float32Array(EMBED_DIM);
  for (let r = 0; r < EMBED_DIM; r++) {
    let dot = 0;
    const off = r * EMBED_DIM;
    for (let c = 0; c < EMBED_DIM; c++) dot += whiteningW[off + c] * centered[c];
    w[r] = dot;
  }
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += w[i] * w[i];
  norm = Math.sqrt(norm);
  if (norm > 1e-10) for (let i = 0; i < EMBED_DIM; i++) w[i] /= norm;
  return w;
}

const SINKHORN_ITER = 15;
const SINKHORN_EPS = 0.1;

function sinkhornWMD(queryTokens, verseTokens) {
  const m = queryTokens.length;
  const n = verseTokens.length;
  if (m === 0 || n === 0) return 1.0;
  const a = new Float64Array(m);
  const b = new Float64Array(n);
  let aSum = 0, bSum = 0;
  for (let i = 0; i < m; i++) { a[i] = queryTokens[i].weight; aSum += a[i]; }
  for (let j = 0; j < n; j++) { b[j] = verseTokens[j].weight; bSum += b[j]; }
  if (aSum <= 0 || bSum <= 0) return 1.0;
  for (let i = 0; i < m; i++) a[i] /= aSum;
  for (let j = 0; j < n; j++) b[j] /= bSum;
  const K = new Float64Array(m * n);
  for (let i = 0; i < m; i++) {
    const qv = queryTokens[i].vec;
    for (let j = 0; j < n; j++) {
      const vv = verseTokens[j].vec;
      let dot = 0;
      for (let d = 0; d < qv.length; d++) dot += qv[d] * vv[d];
      const cost = 1.0 - dot;
      K[i * n + j] = Math.exp(-cost / SINKHORN_EPS);
    }
  }
  const u = new Float64Array(m).fill(1.0 / m);
  const v = new Float64Array(n).fill(1.0 / n);
  for (let iter = 0; iter < SINKHORN_ITER; iter++) {
    for (let i = 0; i < m; i++) {
      let kv = 0;
      for (let j = 0; j < n; j++) kv += K[i * n + j] * v[j];
      u[i] = kv > 1e-30 ? a[i] / kv : a[i];
    }
    for (let j = 0; j < n; j++) {
      let ku = 0;
      for (let i = 0; i < m; i++) ku += K[i * n + j] * u[i];
      v[j] = ku > 1e-30 ? b[j] / ku : b[j];
    }
  }
  let wmd = 0;
  for (let i = 0; i < m; i++) {
    const qv = queryTokens[i].vec;
    for (let j = 0; j < n; j++) {
      const vv = verseTokens[j].vec;
      let dot = 0;
      for (let d = 0; d < qv.length; d++) dot += qv[d] * vv[d];
      const cost = 1.0 - dot;
      const transport = u[i] * K[i * n + j] * v[j];
      wmd += transport * cost;
    }
  }
  return Math.max(0, Math.min(1.0, wmd));
}

function tokenizeForWMD(text, idfLookup) {
  if (!text || !embeddingsReady) return [];
  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, '').split(/\s+/).filter(w => w.length > 1);
  const unique = [...new Set(words)];
  const tokens = [];
  for (const w of unique) {
    const idf = idfLookup ? (idfLookup.get(w) || 3.0) : 1.0;
    if (idf < 1.0) continue;
    tokens.push({ word: w, weight: idf });
  }
  return tokens;
}

const ENTITY_WEIGHTS = [0.40, 0.10, 0.20, 0.15, 0.05, 0.05, 0.05];
const ENTITY_DECAY_LAMBDA = 3.0;

function scoreEntityCandidates(candidates, verseId, verseEmbedding) {
  if (candidates.length <= 1) return candidates;
  const nMax = Math.max(...candidates.map(c => c.verse_count), 1);
  let chapterVerseIds = null;
  try {
    const chRow = dba.prepare('SELECT chapter_id FROM scriptures WHERE verse_id = ?').get(verseId);
    if (chRow) {
      chapterVerseIds = dba.prepare('SELECT verse_id FROM scriptures WHERE chapter_id = ? ORDER BY verse_id').all(chRow.chapter_id).map(r => r.verse_id);
    }
  } catch { }
  for (const c of candidates) {
    let cosScore = 0, priorScore = 0, proxScore = 0;
    if (verseEmbedding) {
      const centroid = entityCentroidCache.get(c.entity_id);
      if (centroid) {
        cosScore = cosineSimilarity(verseEmbedding, centroid);
        cosScore = Math.max(0, Math.min(1, (cosScore + 1) / 2));
      }
    }
    priorScore = Math.log(1 + c.verse_count) / Math.log(1 + nMax);
    if (chapterVerseIds && verseId) {
      const entityVids = db_tags
        ? db_tags.prepare('SELECT verse_id FROM ai_entity_verse_map WHERE entity_id = ? AND verse_id BETWEEN ? AND ?').all(c.entity_id, chapterVerseIds[0], chapterVerseIds[chapterVerseIds.length - 1]).map(r => r.verse_id)
        : [];
      if (entityVids.length > 0) {
        const minDist = Math.min(...entityVids.map(v => Math.abs(v - verseId)));
        const dMax = Math.max(chapterVerseIds.length, 1);
        proxScore = Math.exp(-ENTITY_DECAY_LAMBDA * minDist / dMax);
      }
    }
    const features = [
      cosScore,
      priorScore,
      proxScore,
      cosScore * proxScore,
      cosScore * priorScore,
      cosScore * cosScore,
      proxScore * proxScore,
    ];
    let score = 0;
    for (let f = 0; f < ENTITY_WEIGHTS.length; f++) score += ENTITY_WEIGHTS[f] * features[f];
    c._score = score;
    c._cosine = cosScore;
    c._prior = priorScore;
    c._prox = proxScore;
  }
  candidates.sort((a, b) => b._score - a._score);
  return candidates;
}

const TOTAL_DOCS = 41995;
let idfStmt = null;
let llrStmt = null;
let pmiStmt = null;
let pprStmt = null;
let rwrStmt = null;
const IDF_DEFAULT = Math.log(TOTAL_DOCS / 100);

function initIdfLookup() {
  const rawDb = dba.raw || dba._db;
  try {
    const llrCount = rawDb.prepare('SELECT COUNT(*) AS n FROM term_llr').get().n;
    llrStmt = rawDb.prepare('SELECT llr, idf, burstiness FROM term_llr WHERE term = ?');
    fastify.log.info(`[LLR] Pre-baked table ready: ${llrCount} terms`);
  } catch {
    fastify.log.info('[LLR] Table not found, will use IDF only');
  }
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
  try {
    const pmiCount = rawDb.prepare('SELECT COUNT(*) AS n FROM term_pmi').get().n;
    pmiStmt = rawDb.prepare('SELECT assoc, pmi, cooccur FROM term_pmi WHERE term = ? ORDER BY pmi DESC LIMIT 5');
    fastify.log.info(`[PMI] Pre-baked table ready: ${pmiCount} associations`);
  } catch {
    fastify.log.info('[PMI] Table not found, skipping PMI expansion');
  }
}

function initPprLookup() {
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
  if (!db_graph) return;
  try {
    const rwrCount = db_graph.prepare('SELECT COUNT(*) AS n FROM verse_rwr').get().n;
    rwrStmt = db_graph.prepare('SELECT neighbor_id, rwr_score FROM verse_rwr WHERE verse_id = ? ORDER BY rank');
    fastify.log.info(`[RWR] Pre-baked table ready: ${rwrCount} rows`);
  } catch {
    fastify.log.info('[RWR] Table not found, using kNN only');
  }
}

const clusterLabelCache = new Map();
let clusterCentroidIndex = [];

function initClusterLabels() {
  if (!db_graph) return;
  try {
    const count = db_graph.prepare('SELECT COUNT(*) AS n FROM cluster_labels').get()?.n;
    if (!count) return;
    const rows = db_graph.prepare('SELECT cluster_id, label_terms, rep_verse_id, member_count, centroid FROM cluster_labels').all();
    for (const row of rows) {
      const terms = JSON.parse(row.label_terms || '[]');
      const centroid = new Float32Array(row.centroid.buffer, row.centroid.byteOffset, row.centroid.byteLength / 4);
      clusterLabelCache.set(row.cluster_id, { terms, rep_verse_id: row.rep_verse_id, member_count: row.member_count, centroid });
      clusterCentroidIndex.push({ cluster_id: row.cluster_id, centroid });
    }
    fastify.log.info(`[Clusters] Loaded ${clusterLabelCache.size} cluster labels`);
  } catch (err) {
    fastify.log.warn('[Clusters] cluster_labels not found — run prebake-cluster-labels.js:', err.message);
  }
}

function nearestClusters(qvec, topN = 3) {
  if (!clusterCentroidIndex.length || !qvec) return [];
  const scored = clusterCentroidIndex.map(({ cluster_id, centroid }) => ({ cluster_id, similarity: cosineSimilarity(qvec, centroid) }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN).map(({ cluster_id, similarity }) => {
    const info = clusterLabelCache.get(cluster_id);
    if (!info) return null;
    return { cluster_id, terms: info.terms, rep_verse_id: info.rep_verse_id, member_count: info.member_count, similarity: +similarity.toFixed(4) };
  }).filter(Boolean);
}

function getIdf(term) {
  if (!idfStmt) return IDF_DEFAULT;
  const row = idfStmt.get(term.toLowerCase());
  return row?.idf ?? IDF_DEFAULT;
}
// Damp rare terms that don't belong with their query partners
function dampRareTerm(query, term) {
    if (!pmiStmt) return 1.0;
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length < 2) return 1.0;
    
    let totalPmi = 0;
    for (const other of words) {
        if (other === term) continue;
        try {
            const rows = pmiStmt.all(term);
            const match = rows.find(r => r.assoc === other);
            if (match && match.pmi > 0) totalPmi += match.pmi;
        } catch {}
    }
    const avgPmi = totalPmi / (words.length - 1);
    // Coherence = sigmoid(PMI - 2). PMI > 3 → no damping, PMI < 1 → heavy damping
    const coherence = 1 / (1 + Math.exp(-(avgPmi - 2)));
    return Math.max(0.15, coherence);
}

function getTermWeight(term, query = null) {
    const t = term.toLowerCase();
    let baseWeight = 0;
    
    if (llrStmt) {
        const row = llrStmt.get(t);
        if (row) {
            const llrNorm = Math.log(row.llr + 1) / 2;
            const burstBonus = Math.min(row.burstiness, 5) * 0.3;
            baseWeight = llrNorm + burstBonus + row.idf * 0.5;
        } else {
            baseWeight = getIdf(t);
        }
    } else {
        baseWeight = getIdf(t);
    }
    
    // Apply damping if query is provided
    if (query) {
        const damp = dampRareTerm(query, t);
        baseWeight = baseWeight * damp;
    }
    
    return baseWeight;
}

// Pure statistical co-occurrence penalty - no assumptions, just math
function getCooccurrenceWeight(verseText, queryTerms) {
    if (queryTerms.length < 2) return 1.0;
    
    let presentCount = 0;
    let totalCombinations = 0;
    let cooccurCount = 0;
    
    for (let i = 0; i < queryTerms.length; i++) {
        const term1 = queryTerms[i];
        const hasTerm1 = verseText.includes(term1);
        if (hasTerm1) presentCount++;
        
        for (let j = i + 1; j < queryTerms.length; j++) {
            totalCombinations++;
            const term2 = queryTerms[j];
            if (hasTerm1 && verseText.includes(term2)) {
                cooccurCount++;
            }
        }
    }
    
    if (totalCombinations === 0) return 1.0;
    
    const observedCooccur = cooccurCount / totalCombinations;
    return observedCooccur;
}

function queryTermWeights(query) {
    const terms = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    const weights = new Map();
    let total = 0;
    for (const t of terms) {
        const w = getTermWeight(t, query);  // Pass query for damping
        weights.set(t, w);
        total += w;
    }
    if (total > 0) {
        for (const [t, w] of weights) weights.set(t, w / total);
    }
    return weights;
}

function buildSalientAnchorPhrases(words, termWeights) {
  const phrases = [];
  const seen = new Set();
  const meanWeight = termWeights.size > 0 ? 1 / termWeights.size : 0;
  const salientThreshold = Math.max(0.11, meanWeight * 1.15);
  for (let start = 0; start < words.length; start++) {
    for (let len = 2; len <= 4 && start + len <= words.length; len++) {
      const slice = words.slice(start, start + len);
      const phrase = slice.join(' ');
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      let weightSum = 0;
      let maxWeight = 0;
      let hasDigits = false;
      let salientTermCount = 0;
      const salientWeights = [];
      for (const term of slice) {
        const weight = termWeights.get(term) || 0;
        weightSum += weight;
        if (weight > maxWeight) maxWeight = weight;
        if (/\d/.test(term)) hasDigits = true;
        if (weight >= salientThreshold) {
          salientTermCount += 1;
          salientWeights.push(weight);
        }
      }
      const avgWeight = weightSum / Math.max(1, slice.length);
      salientWeights.sort((a, b) => b - a);
      const coreWeight = salientWeights.slice(0, 2).reduce((sum, weight) => sum + weight, 0);
      const phraseScore = coreWeight + avgWeight * 0.35 + maxWeight * 0.25 + Math.max(0, len - 2) * 0.04;
      if (!hasDigits && salientTermCount < 2) continue;
      if (weightSum < 0.22 && avgWeight < 0.12 && !hasDigits) continue;
      phrases.push({ phrase, score: phraseScore, len, start, anchor: true, structural: hasDigits, salientTermCount, avgWeight, maxWeight });
    }
  }
  return phrases;
}

function extractAnchorPhrases(query, termWeights, maxPhrases = 8) {
  const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  if (words.length < 3) return [];
  const scored = buildSalientAnchorPhrases(words, termWeights);
  if (scored.length === 0) return [];
  const chosen = [];
  const seen = new Set();
  scored.sort((a, b) => b.score - a.score || b.len - a.len || a.start - b.start);
  const overlapRatio = (left, right) => {
    const leftEnd = left.start + left.len - 1;
    const rightEnd = right.start + right.len - 1;
    const overlap = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(left.start, right.start) + 1);
    if (overlap <= 0) return 0;
    return overlap / Math.min(left.len, right.len);
  };
  for (const item of scored) {
    if (seen.has(item.phrase)) continue;
    const overlapsStrongly = chosen.some(existing => overlapRatio(existing, item) > 0.55);
    if (overlapsStrongly && !item.structural) continue;
    seen.add(item.phrase);
    chosen.push(item);
    if (chosen.length >= maxPhrases) break;
  }
  if (chosen.length < maxPhrases) {
    for (const item of scored) {
      if (seen.has(item.phrase)) continue;
      seen.add(item.phrase);
      chosen.push(item);
      if (chosen.length >= maxPhrases) break;
    }
  }
  return chosen;
}

function buildFocusedAnchorQuery(candidate, termWeights) {
  if (!candidate || !candidate.phrase) return '';
  const tokens = String(candidate.phrase).toLowerCase().split(/\s+/).filter(t => t.length > 1).map((term, index) => ({ term, index, weight: termWeights.get(term) || 0 })).filter(({ term }, idx, arr) => arr.findIndex(item => item.term === term) === idx);
  if (tokens.length < 2) return '';
  const maxWeight = tokens.reduce((best, item) => Math.max(best, item.weight), 0);
  const selected = tokens.filter(item => item.weight >= maxWeight * 0.55).sort((a, b) => a.index - b.index).slice(0, 3);
  if (selected.length < 2) {
    return tokens.sort((a, b) => b.weight - a.weight || a.index - b.index).slice(0, 2).sort((a, b) => a.index - b.index).map(item => item.term).join(' ');
  }
  return selected.map(item => item.term).join(' ');
}

const STRONG_PHRASE_MATCH_TYPES = new Set(['phrase', 'near', 'and', 'prefix', 'content-and']);
const SHORT_QUERY_PHRASE_MATCH_TYPES = new Set(['phrase', 'near']);
const LONG_QUERY_PHRASE_MATCH_TYPES = new Set(['phrase', 'near', 'and']);
const PHRASE_MATCH_STRENGTH = { phrase: 1.0, near: 0.92, and: 0.84, prefix: 0.6 };

function weightedLexicalCoverage(query, row, termWeights) {
  if (!row || !row.scripture_text) return 0;
  const verseTerms = new Set(String(row.scripture_text).toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(t => t.length > 1));
  let matched = 0;
  let total = 0;
  for (const [term, weight] of termWeights) {
    total += weight;
    if (verseTerms.has(term)) matched += weight;
  }
  return total > 0 ? matched / total : 0;
}

function anchorWindowScore(text, anchorPhrases, termWeights) {
  if (!text || !anchorPhrases || anchorPhrases.length === 0) return 0;
  const textTerms = String(text).toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  if (textTerms.length === 0) return 0;
  let best = 0;
  for (const candidate of anchorPhrases) {
    const phraseTerms = String(candidate.phrase || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (phraseTerms.length < 2) continue;
    let first = -1;
    let prev = -1;
    let matched = 0;
    for (const term of phraseTerms) {
      const next = textTerms.indexOf(term, prev + 1);
      if (next === -1) {
        matched = 0;
        break;
      }
      if (first === -1) first = next;
      prev = next;
      matched += 1;
    }
    if (matched !== phraseTerms.length || first === -1 || prev === -1) continue;
    const span = Math.max(1, prev - first + 1);
    const compactness = matched / span;
    const weightSum = phraseTerms.reduce((sum, term) => sum + (termWeights.get(term) || 0), 0);
    const salience = Math.min(1, (candidate.score || 0) + weightSum * 0.5);
    const score = compactness * (0.55 + salience * 0.45);
    if (score > best) best = score;
  }
  return best;
}

function querySequenceScore(query, text, termWeights) {
  if (!query || !text) return 0;
  const queryTerms = String(query).toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  const textTerms = String(text).toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  if (queryTerms.length < 3 || textTerms.length === 0) return 0;
  let first = -1;
  let prev = -1;
  let matchedTerms = 0;
  let matchedWeight = 0;
  let totalWeight = 0;
  for (const term of queryTerms) {
    const weight = termWeights.get(term) || 0;
    totalWeight += weight;
    const next = textTerms.indexOf(term, prev + 1);
    if (next === -1) continue;
    if (first === -1) first = next;
    prev = next;
    matchedTerms += 1;
    matchedWeight += weight;
  }
  if (matchedTerms < 2 || matchedWeight <= 0 || first === -1 || prev === -1) return 0;
  const span = Math.max(1, prev - first + 1);
  const compactness = matchedTerms / span;
  const weightedCoverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  return compactness * weightedCoverage;
}

function lexicalSignalQuality(query, ftsRows, termWeights) {
  if (!ftsRows || ftsRows.length === 0) return 0;
  const topRows = ftsRows.slice(0, 5);
  const coverages = topRows.map((row, idx) => {
    const coverage = weightedLexicalCoverage(query, row, termWeights);
    const rankWeight = Math.exp(-idx * 0.45);
    return { coverage, rankWeight };
  });
  const weighted = coverages.reduce((sum, item) => sum + item.coverage * item.rankWeight, 0);
  const weightSum = coverages.reduce((sum, item) => sum + item.rankWeight, 0) || 1;
  return weighted / weightSum;
}

function isStructuredMultiWordQuery(query, anchorPhrases = []) {
  const words = String(query || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  return anchorPhrases.length > 0 || words.length >= 5;
}

function topicallyEligible(queryWordCount, longStructuredQuery, hasExactTopicMatch, queryTopicSlugs) {
  if (!queryTopicSlugs || queryTopicSlugs.length === 0) return false;
  if (hasExactTopicMatch) return true;
  if (queryWordCount <= 3) return true;
  return !longStructuredQuery;
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function interquartileRange(values) {
  if (!values || values.length < 4) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  return q3 - q1;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function computeRelevanceProbability(row, intentType = null, confidence = 0) {
  if (!row) return 0;
  const specificityScore = row._specificity_score || 0;
  const tier = row._tier ?? 5;
  const semantic = Math.max(0, row.similarity_score || 0);
  const lexical = Math.max(0, row._lexicalCoverage || 0);
  const anchor = Math.max(0, row._anchorWindowScore || 0);
  const sequence = Math.max(0, row._sequenceScore || 0);
  const phraseCoverage = Math.max(0, row._phraseCoverage || 0);
  const graphPropagation = Math.max(0, row._qpprScore || 0);
  const structurePrior = Math.max(0, row._structurePrior || 0);
  const sourceCount = Math.max(0, row._sourceCount || 0);
  const sourceBonus = Math.min(sourceCount, 4) * 0.12;
  const tierSignal = Math.max(0, 5 - tier);
  const phraseBoost = row._anchorPhraseMatch ? 0.28 : 0;
  const topicalBoost = String(row._source || '').includes('topical') ? 0.08 : 0;
  const confidenceBoost = Math.max(0, Math.min(1, confidence)) * 0.65;
  const lexicalDominanceBoost = lexical >= 0.72 ? (lexical - 0.72) * 1.9 : 0;
  const sequenceBoost = sequence >= 0.28 ? (sequence - 0.28) * 1.1 : 0;
  const specificityFloorBoost = specificityScore >= 1.55 ? (specificityScore - 1.55) * 0.9 : 0;
  let intentBias = 0;
  if (intentType === 'reference' || intentType === 'phrase') intentBias += 0.18;
  if (intentType === 'conceptual' || intentType === 'situational' || intentType === 'mixed') intentBias += 0.1;
  const logit = -4.7 + specificityScore * 1.18 + tierSignal * 0.38 + semantic * 2.05 + lexical * 2.0 + anchor * 1.0 + sequence * 1.15 + phraseCoverage * 0.55 + graphPropagation * 0.42 + structurePrior * 4.5 + sourceBonus + phraseBoost + topicalBoost + confidenceBoost + lexicalDominanceBoost + sequenceBoost + specificityFloorBoost + intentBias;
  return +sigmoid(logit).toFixed(4);
}

function resultMeaningWeight(row, intentType = null, confidence = 0) {
  if (row && typeof row._relevance_probability === 'number') return row._relevance_probability;
  const relevanceProbability = computeRelevanceProbability(row, intentType, confidence);
  const score = row?._specificity_score || 0;
  const tierSignal = 1 / (1 + Math.exp(-3.2 * (score - 3.0)));
  return 0.82 * relevanceProbability + 0.18 * tierSignal;
}

function computeAdaptiveResultCutoff(results, intentType = null, confidence = 0) {
  if (!results || results.length < 6) return null;
  const strongestTier = results[0]?._tier ?? 5;
  if (strongestTier > 3) return null;
  if (intentType === 'reference' || intentType === 'phrase') return null;
  const capped = results.slice(0, Math.min(results.length, 24));
  const scores = capped.map(r => r._specificity_score || 0);
  const gaps = [];
  for (let i = 0; i < scores.length - 1; i++) gaps.push(scores[i] - scores[i + 1]);
  if (gaps.length < 3) return null;
  const medianGap = median(gaps);
  const gapMad = median(gaps.map(g => Math.abs(g - medianGap)));
  const gapSigma = Math.max(gapMad * 1.4826, 0.02);
  const scoreIqr = interquartileRange(scores);
  const softmaxTemp = Math.max(scoreIqr / 1.349, 0.08);
  const maxScore = scores[0];
  const expScores = scores.map(score => Math.exp((score - maxScore) / softmaxTemp));
  const totalMass = expScores.reduce((sum, value) => sum + value, 0) || 1;
  let cumulativeMass = 0;
  let best = null;
  for (let i = 0; i < gaps.length; i++) {
    cumulativeMass += expScores[i] / totalMass;
    const keepCount = i + 1;
    const remaining = capped.length - keepCount;
    if (keepCount < 2 || remaining < 3) continue;
    const gap = gaps[i];
    const gapZ = (gap - medianGap) / gapSigma;
    const head = capped.slice(0, keepCount);
    const tail = capped.slice(keepCount, Math.min(capped.length, keepCount + 5));
    const headMeaning = head.reduce((sum, row) => sum + resultMeaningWeight(row, intentType, confidence), 0) / head.length;
    const tailMeaning = tail.reduce((sum, row) => sum + resultMeaningWeight(row, intentType, confidence), 0) / tail.length;
    const tailMass = Math.max(0, 1 - cumulativeMass);
    const semanticMargin = headMeaning - tailMeaning;
    const confidenceFactor = 0.8 + Math.min(0.2, Math.max(0, confidence) * 0.2);
    const support = gapZ * (1 - tailMass) * Math.max(semanticMargin, 0) * confidenceFactor;
    if (gapZ < 2.5 || tailMass > 0.35 || semanticMargin < 0.18) continue;
    if (!best || support > best.support) {
      best = { keepCount, gap, gapZ: +gapZ.toFixed(3), tailMass: +tailMass.toFixed(3), headMeaning: +headMeaning.toFixed(3), tailMeaning: +tailMeaning.toFixed(3), support: +support.toFixed(3) };
    }
  }
  if (!best || best.support < 0.9) return null;
  return best;
}

function detectSignificantPhrases(query) {
  if (!llrStmt) return [];
  const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
  if (words.length < 2) return [];
  const sigBigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + ' ' + words[i + 1];
    let sig = false;
    try {
      const row = llrStmt.get(bigram);
      if (row && row.llr > 10) sig = true;
    } catch {}
    sigBigrams.push(sig);
  }
  const phrases = [];
  let chainStart = -1;
  for (let i = 0; i <= sigBigrams.length; i++) {
    if (i < sigBigrams.length && sigBigrams[i]) {
      if (chainStart === -1) chainStart = i;
    } else {
      if (chainStart !== -1) {
        const chainEnd = i;
        const phrase = words.slice(chainStart, chainEnd + 1).join(' ');
        if (chainEnd - chainStart >= 2) phrases.push({ phrase, llr: 0, len: chainEnd - chainStart + 1 });
        for (let j = chainStart; j < chainEnd; j++) phrases.push({ phrase: words[j] + ' ' + words[j + 1], llr: 0, len: 2 });
        chainStart = -1;
      }
    }
  }
  const fullPhrase = words.join(' ');
  if (!phrases.some(p => p.phrase === fullPhrase)) phrases.push({ phrase: fullPhrase, llr: 0, len: words.length });
  const seen = new Set();
  return phrases.filter(p => { if (seen.has(p.phrase)) return false; seen.add(p.phrase); return true; }).sort((a, b) => b.len - a.len);
}

function normalizeQueryTokens(query) {
  if (query == null) return [''];
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return [''];
  return [normalized];
}

function expandWithPmi(query) {
  if (!pmiStmt) return [];
  const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
  const expansions = new Map();
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
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + ' ' + words[i + 1];
    try {
      const rows = pmiStmt.all(bigram);
      for (const r of rows) {
        if (r.cooccur >= 3 && r.pmi > 0.10) {
          const existing = expansions.get(r.assoc) || 0;
          if (r.pmi > existing) expansions.set(r.assoc, r.pmi);
        }
      }
    } catch {}
  }
  const querySet = new Set(words);
  return [...expansions.entries()].filter(([t]) => !querySet.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, pmi]) => ({ term: t, pmi }));
}

function sigmoidConfidence(topBm25Score, resultCount) {
  const normalizedScore = topBm25Score ? Math.abs(topBm25Score) : 0;
  const scoreConf = 1 / (1 + Math.exp(-2 * (normalizedScore - 5)));
  const countConf = 1 / (1 + Math.exp(-0.15 * (resultCount - 15)));
  return Math.sqrt(scoreConf * countConf);
}

function classifyQueryIntent(query, confidence, qvec) {
  const words = query.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  const wordCount = words.length;
  if (entitiesReady && wordCount <= 2) {
    for (const w of words) { if (entityPersonIndex.has(w)) return { type: 'entity', subtype: 'person', entityMatch: w, display: 'Person' }; }
    for (let i = 0; i < words.length - 1; i++) { const bigram = `${words[i]} ${words[i + 1]}`; if (entityPersonIndex.has(bigram)) return { type: 'entity', subtype: 'person', entityMatch: bigram, display: 'Person' }; }
    for (const w of words) { if (entityPlaceIndex.has(w)) return { type: 'entity', subtype: 'place', entityMatch: w, display: 'Place' }; }
  }
  if (qvec) {
    const topClusters = clusterCentroidIndex.length ? nearestClusters(qvec, 2) : [];
    const topClusterSim = topClusters[0]?.similarity ?? 0;
    const secondSim = topClusters[1]?.similarity ?? 0;
    const clusterGap = topClusterSim - secondSim;
    if (confidence >= 0.70) return { type: 'keyword', subtype: 'bm25', entityMatch: null, display: 'Keyword' };
    if (topClusterSim > 0.55 && clusterGap > 0.07 && confidence < 0.60) return { type: 'conceptual', subtype: 'cluster', entityMatch: null, display: 'Semantic' };
    if (topClusterSim > 0.38 && wordCount >= 2 && confidence < 0.55) return { type: 'situational', subtype: 'topical', entityMatch: null, display: 'Situational' };
    if (confidence >= 0.40) return { type: 'mixed', subtype: 'hybrid', entityMatch: null, display: 'Expanded' };
    if (topClusterSim > 0.28 || confidence < 0.30) return { type: 'conceptual', subtype: 'embedding', entityMatch: null, display: 'Semantic' };
  }
  if (confidence >= 0.60) return { type: 'keyword', subtype: 'bm25', entityMatch: null, display: 'Keyword' };
  if (confidence >= 0.30) return { type: 'mixed', subtype: 'hybrid', entityMatch: null, display: 'Expanded' };
  return { type: 'conceptual', subtype: 'embedding', entityMatch: null, display: 'Semantic' };
}

function refineIntentWithTopicSignals(intentClass, queryWordCount, lexicalQuality, topicGuideHitCount, hasExactTopicMatch) {
  if (!intentClass) return intentClass;
  if (hasExactTopicMatch && queryWordCount <= 2 && (intentClass.type === 'keyword' || intentClass.type === 'mixed')) {
    return { type: 'conceptual', subtype: 'topical-guide-exact', entityMatch: null, display: 'Semantic' };
  }
  if (topicGuideHitCount > 0 && queryWordCount <= 3 && lexicalQuality < 0.6 && (intentClass.type === 'keyword' || intentClass.type === 'mixed')) {
    return { type: 'situational', subtype: 'topical-guide-probe', entityMatch: null, display: 'Situational' };
  }
  return intentClass;
}

function normalizedPageRankScore(verseId) {
  const raw = pageRankCache.get(verseId) || 0;
  if (raw <= 0) return 0;
  return Math.max(0, Math.min(1, raw / Math.max(pageRankP95, 1e-9)));
}

function shouldUseWeakStructurePrior(intentType, queryWordCount, lexicalQuality) {
  if (intentType === 'reference' || intentType === 'phrase') return false;
  if (queryWordCount >= 4 && lexicalQuality >= 0.45) return false;
  return intentType === 'conceptual' || intentType === 'situational' || (intentType === 'mixed' && queryWordCount <= 2);
}

function computeWeakStructurePrior(row, intentType, queryWordCount, lexicalQuality) {
  if (!row || !shouldUseWeakStructurePrior(intentType, queryWordCount, lexicalQuality)) return 0;
  if (row._directQueryMatch || row._anchorPhraseMatch) return 0;
  const pagerank = normalizedPageRankScore(row.verse_id);
  const graphConsensus = Math.min(1, Math.max(0, (row._sourceCount || 1) - 1) / 3);
  const topical = Math.min(1, Math.max(0, row._topicSignal || 0));
  const qppr = Math.min(1, Math.max(0, row._qpprScore || 0));
  const spectral = Math.min(1, Math.max(0, row._spectralSim || 0));
  const blended = pagerank * 0.45 + graphConsensus * 0.2 + topical * 0.15 + qppr * 0.12 + spectral * 0.08;
  const maxPrior = intentType === 'conceptual' ? 0.07 : 0.05;
  return Math.min(maxPrior, blended * maxPrior);
}

const RRF_K = 60;

function reciprocalRankFusion(rankedLists, queryTopicSlugs = [], listWeights = null) {
  const scores = new Map();
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
        scores.set(vid, { rrfScore: rrf, row: item, sources: new Set([item._source || 'unknown']) });
      }
    }
  }
  for (const [vid, entry] of scores) {
    if (entry.sources.size >= 3) entry.rrfScore *= 1.4;
    else if (entry.sources.size >= 2) entry.rrfScore *= 1.2;
    if (pprStmt && queryTopicSlugs.length > 0) {
      let bestPpr = 0;
      for (const slug of queryTopicSlugs) {
        try {
          const row = db_tg.prepare('SELECT ppr FROM topic_ppr WHERE topic_slug = ? AND verse_id = ?').get(slug, vid);
          if (row && row.ppr > bestPpr) bestPpr = row.ppr;
        } catch {}
      }
      if (bestPpr > 0) entry.rrfScore += bestPpr * 0.5;
    }
  }
  return scores;
}

const MMR_H_MEDIAN = 3.0;

function mmrRerank(candidates, qvec, lambdaOverride = null, limit = 50) {
  if (!qvec || !embeddingsReady || candidates.length <= 1) return candidates;
  const topN = Math.min(candidates.length, Math.max(limit * 2, 100));
  const pool = candidates.slice(0, topN).map(c => {
    const vec = embeddingCache.get(c.verse_id);
    let sim = vec ? cosineSimilarity(qvec, vec) : (c.similarity_score || 0);
    if (spectralReady && c._spectralSim != null) sim = (1 - SPECTRAL_BLEND) * sim + SPECTRAL_BLEND * c._spectralSim;
    return { ...c, _vec: vec || null, simToQuery: sim };
  });
  let lambda;
  if (lambdaOverride !== null) {
    lambda = lambdaOverride;
  } else {
    const positiveSims = pool.map(c => Math.max(0, c.simToQuery)).filter(s => s > 0);
    if (positiveSims.length >= 2) {
      const simSum = positiveSims.reduce((a, b) => a + b, 0);
      let H = 0;
      for (const s of positiveSims) {
        const p = s / simSum;
        if (p > 1e-12) H -= p * Math.log(p);
      }
      lambda = 0.5 + 0.4 / (1.0 + Math.exp(2.0 * (H - MMR_H_MEDIAN)));
    } else {
      lambda = 0.9;
    }
  }
  const selected = [];
  const selVecs = [];
  while (selected.length < limit && pool.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxSimToSelected = 0;
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
      if (combined > bestMmr) { bestMmr = combined; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      const chosen = pool.splice(bestIdx, 1)[0];
      selVecs.push(chosen._vec);
      selected.push(chosen);
    } else break;
  }
  return selected;
}

function chapterAggregate(verseScores) {
  const chapters = new Map();
  for (const [vid, entry] of verseScores) {
    const meta = verseMetaCache.get(vid);
    if (!meta) continue;
    const chId = meta.chapter_id;
    if (!chapters.has(chId)) chapters.set(chId, { verses: [], totalScore: 0, bestVerse: null, bestScore: 0 });
    const ch = chapters.get(chId);
    ch.verses.push(vid);
    ch.totalScore += entry.rrfScore;
    if (entry.rrfScore > ch.bestScore) { ch.bestScore = entry.rrfScore; ch.bestVerse = vid; }
  }
  const chapterScores = [];
  for (const [chId, ch] of chapters) {
    const normalized = ch.totalScore / Math.sqrt(ch.verses.length);
    chapterScores.push({ chapterId: chId, score: normalized, bestVerse: ch.bestVerse, verseCount: ch.verses.length });
  }
  chapterScores.sort((a, b) => b.score - a.score);
  return chapterScores;
}

function queryPPR(seedRows, options = {}) {
  if (!db_graph || !seedRows || seedRows.length === 0) return new Map();
  try {
    const alpha = options.alpha ?? 0.85;
    const hops = options.hops ?? 2;
    const iters = options.iters ?? 4;
    const knnLimit = options.knnLimit ?? 10;
    const crossRefLimit = options.crossRefLimit ?? 6;
    const topicEdgeLimit = options.topicEdgeLimit ?? 4;
    const queryTopicSlugs = Array.isArray(options.queryTopicSlugs) ? options.queryTopicSlugs : [];
    const knnQ = db_graph.prepare(`SELECT neighbor_id, similarity FROM verse_knn WHERE verse_id = ? ORDER BY rank ASC LIMIT ${knnLimit}`);
    const xrefQ = db_vxref ? db_vxref.prepare('SELECT cross_references FROM verse_cross_references WHERE verse_id = ?') : null;
    const topicRowsBySlug = new Map();
    const seedEntries = seedRows.map((seed) => {
      if (typeof seed === 'number') return { verse_id: seed, weight: 1 };
      if (!seed || !seed.verse_id) return null;
      const lexical = Math.max(0, seed._lexicalCoverage || seed._phraseCoverage || 0);
      const semantic = Math.max(0, seed.similarity_score || 0);
      const phraseEvidence = seed._directQueryMatch || seed._anchorPhraseMatch ? 0.45 : 0;
      const anchorEvidence = Math.max(0, seed._anchorWindowScore || 0) * 0.18;
      const sequenceEvidence = Math.max(0, seed._sequenceScore || 0) * 0.16;
      const sourceTrust = { 'fts-phrase': 0.38, 'fts': 0.32, 'semantic': 0.28, 'semantic-primary': 0.3, 'topical-guide': 0.24, 'cross-ref': 0.24, 'knn-expand': 0.18, 'rwr': 0.18 }[seed._source] || 0.14;
      const weight = 0.12 + lexical * 0.34 + semantic * 0.24 + phraseEvidence + anchorEvidence + sequenceEvidence + sourceTrust;
      return { verse_id: seed.verse_id, weight };
    }).filter(Boolean).sort((a, b) => b.weight - a.weight).slice(0, options.seedLimit || 8);
    if (seedEntries.length === 0) return new Map();
    const seedWeightSum = seedEntries.reduce((sum, seed) => sum + seed.weight, 0) || 1;
    const seedWeights = new Map(seedEntries.map((seed) => [seed.verse_id, seed.weight / seedWeightSum]));
    const seedIds = seedEntries.map((seed) => seed.verse_id);
    const addEdge = (targetMap, neighborId, weight) => { if (!neighborId || weight <= 0) return; targetMap.set(neighborId, Math.max(targetMap.get(neighborId) || 0, weight)); };
    const collectNeighbors = (verseId) => {
      const merged = new Map();
      const knnRows = knnQ.all(verseId);
      for (let idx = 0; idx < knnRows.length; idx++) {
        const row = knnRows[idx];
        addEdge(merged, row.neighbor_id, Math.max(0, row.similarity) * Math.exp(-idx * 0.1));
      }
      if (xrefQ) {
        try {
          const xrRow = xrefQ.get(verseId);
          const refs = xrRow ? JSON.parse(xrRow.cross_references || '[]') : [];
          for (let idx = 0; idx < Math.min(refs.length, crossRefLimit); idx++) addEdge(merged, refs[idx], 0.74 * Math.exp(-idx * 0.12));
        } catch {}
      }
      if (queryTopicSlugs.length > 0 && pprStmt && verseTopicCache.has(verseId)) {
        const verseTopics = verseTopicCache.get(verseId);
        for (const slug of queryTopicSlugs) {
          if (!verseTopics.has(slug)) continue;
          let rows = topicRowsBySlug.get(slug);
          if (!rows) { rows = pprStmt.all(slug).slice(0, Math.max(topicEdgeLimit * 2, 8)); topicRowsBySlug.set(slug, rows); }
          let taken = 0;
          for (const row of rows) {
            if (row.verse_id === verseId) continue;
            addEdge(merged, row.verse_id, 0.55 * Math.sqrt(Math.max(0, row.ppr || 0)));
            taken += 1;
            if (taken >= topicEdgeLimit) break;
          }
        }
      }
      return [...merged.entries()].map(([neighborId, weight]) => ({ n: neighborId, w: weight }));
    };
    const adjOut = new Map();
    const visited = new Set(seedIds);
    let frontier = [...seedIds];
    for (let hop = 0; hop < hops; hop++) {
      const next = [];
      for (const vid of frontier) {
        if (adjOut.has(vid)) continue;
        const rows = collectNeighbors(vid);
        adjOut.set(vid, rows);
        for (const r of rows) { if (!visited.has(r.n)) { visited.add(r.n); next.push(r.n); } }
      }
      frontier = next;
    }
    const scores = new Map();
    for (const vid of visited) scores.set(vid, seedWeights.get(vid) || 0);
    for (let iter = 0; iter < iters; iter++) {
      const next = new Map();
      for (const vid of visited) next.set(vid, (1 - alpha) * (seedWeights.get(vid) || 0));
      for (const [vid, neighbors] of adjOut) {
        const r = scores.get(vid) || 0;
        if (r === 0) continue;
        const wSum = neighbors.reduce((s, nb) => s + nb.w, 0) || 1;
        for (const nb of neighbors) next.set(nb.n, (next.get(nb.n) || 0) + alpha * r * (nb.w / wSum));
      }
      for (const [k, v] of next) scores.set(k, v);
    }
    let maxScore = 0;
    for (const v of scores.values()) if (v > maxScore) maxScore = v;
    if (maxScore > 0) for (const [k, v] of scores) scores.set(k, v / maxScore);
    return scores;
  } catch { return new Map(); }
}

const EWMA_ALPHA = 0.4;

function sessionCentroid(liveHistory) {
  if (!embeddingsReady || !liveHistory || liveHistory.length === 0) return null;
  const dims = EMBED_DIM;
  const acc = new Float32Array(dims);
  let wSum = 0;
  for (let h = 0; h < liveHistory.length; h++) {
    const vec = embeddingCache.get(liveHistory[h]);
    if (!vec) continue;
    const w = EWMA_ALPHA * Math.pow(1 - EWMA_ALPHA, h);
    for (let i = 0; i < dims; i++) acc[i] += w * vec[i];
    wSum += w;
  }
  if (wSum === 0) return null;
  let mag = 0;
  for (let i = 0; i < dims; i++) { acc[i] /= wSum; mag += acc[i] * acc[i]; }
  mag = Math.sqrt(mag);
  if (mag > 0) for (let i = 0; i < dims; i++) acc[i] /= mag;
  return acc;
}

async function semanticSearch(query, page = 0, pageSize = 10, excludeIds = new Set(), qvec = null) {
  if (!embeddingsReady || !embeddingPipe) return null;
  try {
    if (!qvec) {
      const out = await embeddingPipe(query, { pooling: 'mean', normalize: true });
      qvec = new Float32Array(out.data);
    }
    let hits = [];
    if (hnswIndex) {
      const seen = new Set();
      const SEM_SEARCH_FLOOR = 0.05;
      hits = hnswIndex.query(qvec, 200, 150).filter((h) => {
        const cosSim = 1 - (1 - h.score) * (1 - h.score) / 2;
        h.score = cosSim;
        if (cosSim < SEM_SEARCH_FLOOR || excludeIds.has(h.verse_id) || seen.has(h.verse_id)) return false;
        seen.add(h.verse_id);
        return true;
      });
    } else {
      const scores = [];
      for (const [vid, vvec] of embeddingCache) {
        if (excludeIds.has(vid)) continue;
        const s = cosineSimilarity(qvec, vvec);
        if (s <= 0) continue;
        scores.push({ verse_id: vid, score: s });
      }
      scores.sort((a, b) => b.score - a.score);
      hits = scores.slice(0, 200);
    }
    const stmtVerse = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`);
    const results = hits.slice(page * pageSize, (page + 1) * pageSize).map(({ verse_id, score }) => { const row = stmtVerse.get(verse_id); return row ? { ...row, similarity_score: +score.toFixed(4), _source: 'semantic' } : null; }).filter(Boolean);
    return { results, total: Math.min(hits.length, 200), page, pageSize, semantic: true };
  } catch (err) {
    fastify.log.warn('[SemanticSearch] failed:', err.message);
    return null;
  }
}

let hnswIndex = null;

class HNSWIndex {
  constructor(dims, M = 16, ef = 200) {
    this.dims = dims;
    this.M = M;
    this.ef = ef;
    this.nodes = [];
    this.entryPoint = -1;
    this.maxLevel = -1;
    this.levelMultiplier = 1 / Math.log(1.0 * M);
  }
  _dist(a, b) { let sum = 0; for (let i = 0; i < this.dims; i++) { const d = a[i] - b[i]; sum += d * d; } return Math.sqrt(sum); }
  _searchLayer(qvec, entryDist, entryIdx, ef, level) {
    const visited = new Set();
    const results = [[entryDist, entryIdx]];
    let candidates = [[entryDist, entryIdx]];
    while (candidates.length > 0) {
      candidates.sort((a, b) => a[0] - b[0]);
      const [dist, idx] = candidates.shift();
      if (dist > results[results.length - 1][0]) break;
      const neighbors = this.nodes[idx].neighbors.get(level) || [];
      for (const nIdx of neighbors) {
        if (visited.has(nIdx)) continue;
        visited.add(nIdx);
        const nd = this._dist(qvec, this.nodes[nIdx].vec);
        if (results.length < ef || nd < results[results.length - 1][0]) {
          results.push([nd, nIdx]);
          results.sort((a, b) => a[0] - b[0]);
          if (results.length > ef) results.pop();
          candidates.push([nd, nIdx]);
        }
      }
    }
    return results;
  }
  insert(id, vec) {
    const node = { id, vec, neighbors: new Map() };
    this.nodes.push(node);
    const idx = this.nodes.length - 1;
    const level = Math.floor(-Math.log(Math.random()) * this.levelMultiplier);
    if (this.entryPoint === -1) { this.entryPoint = idx; this.maxLevel = level; return; }
    let ep = this.entryPoint;
    let epDist = this._dist(vec, this.nodes[ep].vec);
    for (let lc = this.maxLevel; lc > level; lc--) { const layerResult = this._searchLayer(vec, epDist, ep, 1, lc); if (layerResult.length > 0) { ep = layerResult[0][1]; epDist = layerResult[0][0]; } }
    for (let lc = Math.min(level, this.maxLevel); lc >= 0; lc--) {
      const neighbors = this._searchLayer(vec, epDist, ep, this.ef, lc).slice(0, this.M);
      const ev = neighbors.map(([d, i]) => [d, i]);
      this.nodes[idx].neighbors.set(lc, ev.map(([, i]) => i));
      for (const [, nIdx] of neighbors) {
        if (!this.nodes[nIdx].neighbors.has(lc)) this.nodes[nIdx].neighbors.set(lc, []);
        const nList = this.nodes[nIdx].neighbors.get(lc);
        nList.push(idx);
        if (nList.length > this.M) { nList.sort((a, b) => this._dist(this.nodes[nIdx].vec, this.nodes[a].vec) - this._dist(this.nodes[nIdx].vec, this.nodes[b].vec)); this.nodes[nIdx].neighbors.set(lc, nList.slice(0, this.M)); }
      }
      if (neighbors.length > 0) { ep = neighbors[0][1]; epDist = neighbors[0][0]; }
    }
    if (level > this.maxLevel) { this.maxLevel = level; this.entryPoint = idx; }
  }
  query(qvec, k = 30, ef = 100) {
    if (this.entryPoint === -1) return [];
    let ep = this.entryPoint;
    let epDist = this._dist(qvec, this.nodes[ep].vec);
    for (let lc = this.maxLevel; lc > 0; lc--) { const res = this._searchLayer(qvec, epDist, ep, 1, lc); if (res.length > 0) { ep = res[0][1]; epDist = res[0][0]; } }
    const finalRes = this._searchLayer(qvec, epDist, ep, ef, 0);
    finalRes.sort((a, b) => a[0] - b[0]);
    return finalRes.slice(0, k).map(([dist, idx]) => ({ verse_id: this.nodes[idx].id, score: 1 - dist }));
  }
  serialize() {
    const N = this.nodes.length;
    let neighborBytes = 0;
    for (const node of this.nodes) { for (const [, nbrs] of node.neighbors) neighborBytes += 2 + nbrs.length * 4; neighborBytes += 1; }
    const headerBytes = 24;
    const nodeIdBytes = N * 4;
    const vecBytes = N * this.dims * 4;
    const totalBytes = headerBytes + nodeIdBytes + neighborBytes + vecBytes;
    const buf = Buffer.allocUnsafe(totalBytes);
    let off = 0;
    buf.writeUInt32LE(1, off); off += 4;
    buf.writeUInt32LE(this.dims, off); off += 4;
    buf.writeUInt32LE(this.M, off); off += 4;
    buf.writeInt32LE(this.entryPoint, off); off += 4;
    buf.writeInt32LE(this.maxLevel, off); off += 4;
    buf.writeUInt32LE(N, off); off += 4;
    for (const node of this.nodes) {
      buf.writeInt32LE(node.id, off); off += 4;
      const levels = [...node.neighbors.entries()];
      buf.writeUInt8(levels.length, off); off += 1;
      for (const [lvl, nbrs] of levels) { buf.writeUInt8(lvl, off); off += 1; buf.writeUInt8(nbrs.length, off); off += 1; for (const nid of nbrs) { buf.writeInt32LE(nid, off); off += 4; } }
    }
    for (const node of this.nodes) { for (let d = 0; d < this.dims; d++) { buf.writeFloatLE(node.vec[d], off); off += 4; } }
    return buf;
  }
  static deserialize(buf) {
    let off = 0;
    const version = buf.readUInt32LE(off); off += 4;
    if (version !== 1) throw new Error(`[HNSW] Unknown serialization version: ${version}`);
    const dims = buf.readUInt32LE(off); off += 4;
    const M = buf.readUInt32LE(off); off += 4;
    const entryPoint = buf.readInt32LE(off); off += 4;
    const maxLevel = buf.readInt32LE(off); off += 4;
    const N = buf.readUInt32LE(off); off += 4;
    const idx = new HNSWIndex(dims, M);
    idx.entryPoint = entryPoint;
    idx.maxLevel = maxLevel;
    const ids = new Int32Array(N);
    const allNbrs = new Array(N);
    for (let i = 0; i < N; i++) {
      ids[i] = buf.readInt32LE(off); off += 4;
      const levelCount = buf.readUInt8(off); off += 1;
      const nbrsMap = new Map();
      for (let l = 0; l < levelCount; l++) {
        const lvl = buf.readUInt8(off); off += 1;
        const cnt = buf.readUInt8(off); off += 1;
        const nList = [];
        for (let n = 0; n < cnt; n++) { nList.push(buf.readInt32LE(off)); off += 4; }
        nbrsMap.set(lvl, nList);
      }
      allNbrs[i] = nbrsMap;
    }
    for (let i = 0; i < N; i++) {
      const vec = new Float32Array(dims);
      for (let d = 0; d < dims; d++) { vec[d] = buf.readFloatLE(off); off += 4; }
      idx.nodes.push({ id: ids[i], vec, neighbors: allNbrs[i] });
    }
    return idx;
  }
}

function buildHNSWIndex() {
  if (!embeddingsReady || embeddingCache.size === 0) return;
  if (db_embed) {
    try {
      const row = db_embed.prepare("SELECT data FROM hnsw_index WHERE key = 'hnsw_v1'").get();
      if (row?.data) {
        hnswIndex = HNSWIndex.deserialize(row.data);
        fastify.log.info(`[HNSW] Loaded pre-baked index (${hnswIndex.nodes.length} nodes) from DB.`);
        return;
      }
    } catch (err) { fastify.log.warn('[HNSW] Could not load pre-baked index, rebuilding:', err.message); }
  }
  fastify.log.info('[HNSW] Building index from scratch…');
  const t0 = Date.now();
  hnswIndex = new HNSWIndex(EMBED_DIM, 16, 200);
  for (const [verse_id, vec] of embeddingCache) hnswIndex.insert(verse_id, vec);
  fastify.log.info(`[HNSW] Built in ${Date.now() - t0} ms (${hnswIndex.nodes.length} nodes). Run scripts/prebake-hnsw.js to cache this.`);
}

async function expandWithConcepts(query, topN = 5, qvec = null) {
  if (!embeddingPipe || !conceptCache.length) return [];
  try {
    if (!qvec) {
      const out = await embeddingPipe(query, { pooling: 'mean', normalize: true });
      qvec = new Float32Array(out.data);
    }
    const scored = conceptCache.map(c => ({ phrase: c.phrase, source: c.source, score: cosineSimilarity(qvec, c.vec) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN).filter(s => s.score > 0.4);
  } catch { return []; }
}

function multiSourceFusion(query, expandedQuery, pageSize, intentType = null) {
  const stmtVerse = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`);
  const termWeights = queryTermWeights(query);
  const normalizedQueryText = normalizeSearchText(query);
  const queryWordCount = query.split(/\s+/).filter(Boolean).length;
  const anchorPhrases = queryWordCount >= 5 ? extractAnchorPhrases(query, termWeights, 4) : [];
  const anchorTexts = anchorPhrases.map(p => p.phrase.toLowerCase());
  const structuredMultiWordQuery = isStructuredMultiWordQuery(query, anchorPhrases);
  const detectedPhrases = (() => {
    const raw = detectSignificantPhrases(query);
    if (!raw || raw.length === 0) return raw;
    const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    if (words.length >= 5) { const fullPhrase = words.join(' '); return raw.filter(p => p.phrase === fullPhrase); }
    if (words.length >= 3) { const fullPhrase = words.join(' '); return raw.filter(p => p.phrase === fullPhrase); }
    return raw;
  })();
  const _pmiWords = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
  const pmiTerms = _pmiWords.length <= 1 ? expandWithPmi(query) : [];
  let pmiExpandedQuery = expandedQuery;
  if (pmiTerms.length > 0) { const pmiWords = pmiTerms.map(t => t.term); pmiExpandedQuery = [...new Set([...expandedQuery.split(/\s+/), ...pmiWords])].join(' '); }
  const directMatchWords = normalizedQueryText.split(/\s+/).filter(Boolean);
  const directMatchEligible = directMatchWords.length >= 2;
  // const ftsResult = searchScripture(query, 0, 50, dba, fastify.log);
  // const ftsRanked = ftsResult.results.map(r => ({ ...r, _source: 'fts', _bm25: r._bm25_rank || 0, _directQueryMatch: directMatchEligible && normalizedTextIncludes(normalizeSearchText(r.scripture_text || ''), normalizedQueryText), _lexicalCoverage: weightedLexicalCoverage(query, r, termWeights), _anchorPhraseMatch: anchorTexts.some(phrase => String(r.scripture_text || '').toLowerCase().includes(phrase)), _anchorWindowScore: anchorWindowScore(r.scripture_text, anchorPhrases, termWeights), _sequenceScore: querySequenceScore(query, r.scripture_text, termWeights) }));
  
  // Replace with empty array
  const ftsRanked = [];
  const phraseRanked = [];  
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
            for (const w of queryWords) { if (labelText.includes(w)) fieldBoost += 0.3; if (speakerText.includes(w)) fieldBoost += 0.2; }
          }
        } catch {}
        row._bm25_rank = (row._bm25_rank || 0) * fieldBoost;
        row._bm25 = row._bm25_rank;
      }
      ftsRanked.sort((a, b) => (a._bm25 || 0) - (b._bm25 || 0));
    }
  }

    // No thresholds, no assumptions, just observed co-occurrence probability
  if (ftsRanked.length > 0) {
    const queryTermList = [...termWeights.keys()];
    if (queryTermList.length >= 2) {
      for (const row of ftsRanked) {
        const verseText = (row.scripture_text || '').toLowerCase();
        const cooccurWeight = getCooccurrenceWeight(verseText, queryTermList);
        // Apply penalty: if terms don't appear together, score drops to near zero
        row._bm25_rank = (row._bm25_rank || 0) * cooccurWeight;
        row._bm25 = row._bm25_rank;
      }
      // Re-sort after penalty
      ftsRanked.sort((a, b) => (a._bm25 || 0) - (b._bm25 || 0));
    }
  }

  if (queryWordCount >= 3 && ftsRanked.length > 1) {
    ftsRanked.sort((a, b) => Number(Boolean(b._directQueryMatch)) - Number(Boolean(a._directQueryMatch)) || (b._sequenceScore || 0) - (a._sequenceScore || 0) || (b._anchorWindowScore || 0) - (a._anchorWindowScore || 0) || Number(Boolean(b._anchorPhraseMatch)) - Number(Boolean(a._anchorPhraseMatch)) || (b._lexicalCoverage || 0) - (a._lexicalCoverage || 0) || (a._bm25 || 0) - (b._bm25 || 0));
  }
  // if (directMatchEligible && (ftsResult.matchType === 'phrase' || ftsResult.matchType === 'near')) { for (const row of ftsRanked) row._directQueryMatch = true; }

 
  const phraseCandidates = [...detectedPhrases, ...anchorPhrases].filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0) || (b.len || 0) - (a.len || 0));

  if (phraseCandidates.length > 0) {
    const bestByVerse = new Map();
    for (const candidate of phraseCandidates) {
      const { phrase } = candidate;
      try {
        const phraseQueries = candidate.anchor ? [...new Set(['"' + phrase + '"', phrase, buildFocusedAnchorQuery(candidate, termWeights)].filter(Boolean))] : ['"' + phrase + '"'];
        const phraseLimit = candidate.anchor ? 100 : 30;
        for (const phraseQuery of phraseQueries) {
          const phraseResult = searchScripture(phraseQuery, 0, phraseLimit, dba, fastify.log);
          if (!STRONG_PHRASE_MATCH_TYPES.has(phraseResult.matchType)) continue;
          if (queryWordCount >= 5 && phraseResult.matchType !== 'phrase') { if (!(candidate.anchor && (phraseResult.matchType === 'near' || phraseResult.matchType === 'and'))) continue; }
          for (const r of phraseResult.results) {
            const coverage = weightedLexicalCoverage(query, r, termWeights);
            const minCoverage = phraseResult.matchType === 'and' ? 0.34 : 0.24;
            if (queryWordCount >= 5 && coverage < minCoverage) continue;
            const matchStrength = PHRASE_MATCH_STRENGTH[phraseResult.matchType] || 0.5;
            const anchorStrength = candidate.anchor ? Math.min(1, (candidate.score || 0) + (candidate.salientTermCount || 0) * 0.08) : 0;
            const phraseSignal = matchStrength + coverage * 0.45 + anchorStrength * 0.35;
            const existing = bestByVerse.get(r.verse_id);
            if (!existing || phraseSignal > existing._phraseSignal) { bestByVerse.set(r.verse_id, { ...r, _source: 'fts-phrase', _bm25: r._bm25_rank || 0, _anchorPhraseMatch: phraseResult.matchType === 'phrase' || phraseResult.matchType === 'near', _phraseSignal: phraseSignal, _phraseCoverage: coverage, _anchorStrength: anchorStrength }); }
          }
        }
      } catch {}
    }
    phraseRanked.push(...[...bestByVerse.values()].sort((a, b) => (b._phraseSignal || 0) - (a._phraseSignal || 0) || (a._bm25 || 0) - (b._bm25 || 0)));
  }
    // Apply co-occurrence penalty to phraseRanked as well
  if (phraseRanked.length > 0) {
    const queryTermList = [...termWeights.keys()];
    if (queryTermList.length >= 2) {
      for (const row of phraseRanked) {
        const verseText = (row.scripture_text || '').toLowerCase();
        const cooccurWeight = getCooccurrenceWeight(verseText, queryTermList);
        row._bm25 = (row._bm25 || 0) * cooccurWeight;
        if (row._phraseSignal) row._phraseSignal = row._phraseSignal * cooccurWeight;
      }
      phraseRanked.sort((a, b) => (b._phraseSignal || 0) - (a._phraseSignal || 0) || (a._bm25 || 0) - (b._bm25 || 0));
    }
  }
  if (pmiExpandedQuery && pmiExpandedQuery !== query.toLowerCase()) {
    const expResult = searchScripture(pmiExpandedQuery, 0, 30, dba, fastify.log);
    const seen = new Set(ftsRanked.map(r => r.verse_id));
    for (const r of expResult.results) { if (!seen.has(r.verse_id)) { ftsRanked.push({ ...r, _source: 'fts', _bm25: r._bm25_rank || 0 }); seen.add(r.verse_id); } }
  }
  let queryTopicSlugs = [];
  let hasExactTopicMatch = false;
  if (topicalGuideReady) {
    const normQuery = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').trim();
    const normWords = normQuery.split(/\s+/).filter(t => t.length > 1);
    const querySlugified = normQuery.replace(/\s+/g, '-');
    for (const [slug, name] of topicNameMap) {
      const slugNorm = slug.replace(/-/g, ' ');
      if (slugNorm === normQuery || name.toLowerCase() === normQuery || slug === querySlugified) { queryTopicSlugs.push(slug); hasExactTopicMatch = true; }
    }
    if (!structuredMultiWordQuery && normWords.length >= 2 && normWords.length <= 4) {
      for (let i = 0; i < normWords.length - 1; i++) {
        const bigram = normWords[i] + ' ' + normWords[i + 1];
        const bigramSlug = normWords[i] + '-' + normWords[i + 1];
        for (const [slug, name] of topicNameMap) {
          if (queryTopicSlugs.includes(slug)) continue;
          const slugNorm = slug.replace(/-/g, ' ');
          if (slugNorm.includes(bigram) || name.toLowerCase().includes(bigram) || slug.includes(bigramSlug)) queryTopicSlugs.push(slug);
        }
        if (queryTopicSlugs.length >= 10) break;
      }
    }
    if (!structuredMultiWordQuery && queryTopicSlugs.length === 0 && normWords.length <= 3) {
      for (const [slug, name] of topicNameMap) {
        const slugNorm = slug.replace(/-/g, ' ');
        for (const w of normWords) { if (slugNorm.includes(w) || name.toLowerCase().includes(w)) { queryTopicSlugs.push(slug); break; } }
        if (queryTopicSlugs.length >= 10) break;
      }
    }
    queryTopicSlugs = [...new Set(queryTopicSlugs)].slice(0, 10);
  }
  const summaryRanked = [];
  const shortTopicalQuery = queryWordCount <= 3 && queryTopicSlugs.length > 0;
  const longStructuredQuery = structuredMultiWordQuery || detectedPhrases.length > 0;
  if (db_chsummary && !shortTopicalQuery && !longStructuredQuery) {
    try {
      const cleanQ = query.replace(/[^a-zA-Z0-9\-\s]/g, ' ').trim();
      const terms = cleanQ.split(/\s+/).filter(t => t.length > 1).map(t => `${t}*`).join(' OR ');
      if (terms) {
        const sumRows = db_chsummary.prepare(`SELECT cs.chapter_id, cs.book_id, cs.chapter_num, fts.rank FROM chapter_summaries_fts fts JOIN chapter_summaries cs ON cs.rowid = fts.rowid WHERE chapter_summaries_fts MATCH ? ORDER BY fts.rank LIMIT 15`).all(terms);
        for (const sr of sumRows) {
          const verses = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE chapter_id = ? ORDER BY verse_number`).all(sr.chapter_id);
          for (const v of verses.slice(0, 5)) summaryRanked.push({ ...v, _source: 'summary' });
        }
      }
    } catch {}
  }
  const tgRanked = [];
  if (topicalGuideReady && topicallyEligible(queryWordCount, longStructuredQuery, hasExactTopicMatch, queryTopicSlugs)) {
    const bestByVerse = new Map();
    const probeLimit = hasExactTopicMatch ? 3 : Math.min(3, queryTopicSlugs.length);
    for (let slugIndex = 0; slugIndex < probeLimit; slugIndex++) {
      const topicSlug = queryTopicSlugs[slugIndex];
      const tg = topicSearch(topicSlug, 0, hasExactTopicMatch ? 15 : 10);
      if (!tg?.results?.length) continue;
      for (let rank = 0; rank < tg.results.length; rank++) {
        const row = tg.results[rank];
        const topicSignal = 1 + (hasExactTopicMatch && slugIndex === 0 ? 0.35 : 0) + Math.max(0, 0.18 - slugIndex * 0.04) - rank * 0.015;
        const existing = bestByVerse.get(row.verse_id);
        if (!existing || topicSignal > existing._topicSignal) bestByVerse.set(row.verse_id, { ...row, _source: 'topical-guide', _topicSignal: +topicSignal.toFixed(4), _matchedTopicSlug: topicSlug });
      }
    }
    tgRanked.push(...[...bestByVerse.values()].sort((a, b) => (b._topicSignal || 0) - (a._topicSignal || 0) || String(a.verse_title || '').localeCompare(String(b.verse_title || ''))));
  }
  const entityRanked = [];
  const normQ = query.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (const [idx, label] of [[entityPersonIndex, 'entity-person'], [entityPlaceIndex, 'entity-place']]) {
    const verseIds = idx.get(normQ);
    if (verseIds) { for (const vid of [...verseIds].slice(0, 15)) { const row = stmtVerse.get(vid); if (row) entityRanked.push({ ...row, _source: label }); } }
  }
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
          if (row) { xrefRanked.push({ ...row, _source: 'cross-ref', _xref_from: ftsVerse.verse_id }); seen.add(refId); }
        }
      } catch {}
    }
  }
  const W = (intentType && intentWeights.has(intentType)) ? intentWeights.get(intentType) : learnedWeights;
  const exactTopicalQuery = queryWordCount <= 2 && hasExactTopicMatch;
  const phraseWeight = exactTopicalQuery ? W[0] * 0.6 : W[0] * 3;
  const summaryWeight = shortTopicalQuery ? W[3] * 0.15 : W[3];
  // const rrfScores = reciprocalRankFusion([ftsRanked, phraseRanked, summaryRanked, entityRanked, xrefRanked], queryTopicSlugs, [W[0], phraseWeight, summaryWeight, W[2], W[3] * 5]);
  
  const rrfScores = reciprocalRankFusion([phraseRanked, summaryRanked, entityRanked, xrefRanked], queryTopicSlugs, [phraseWeight, summaryWeight, W[2], W[3] * 5]);
  const chapterScores = chapterAggregate(rrfScores);
  for (const ch of chapterScores.slice(0, 10)) {
    if (ch.verseCount >= 3 && ch.bestVerse && !rrfScores.has(ch.bestVerse)) {
      const row = stmtVerse.get(ch.bestVerse);
      if (row) rrfScores.set(ch.bestVerse, { rrfScore: ch.score * 0.8, row: { ...row, _source: 'chapter-agg' }, sources: new Set(['chapter-agg']) });
    }
    for (const [vid, entry] of rrfScores) {
      const meta = verseMetaCache.get(vid);
      if (meta && meta.chapter_id === ch.chapterId) entry.rrfScore += ch.score * 0.3 / Math.sqrt(ch.verseCount);
    }
  }
  const ftsMetaByVerse = new Map(ftsRanked.map(row => [row.verse_id, { _directQueryMatch: row._directQueryMatch, _lexicalCoverage: row._lexicalCoverage, _anchorPhraseMatch: row._anchorPhraseMatch, _anchorWindowScore: row._anchorWindowScore, _sequenceScore: row._sequenceScore }]));
  const sorted = [...rrfScores.entries()].map(([vid, entry]) => ({ ...entry.row, ...(ftsMetaByVerse.get(vid) || {}), verse_id: vid, _rrfScore: entry.rrfScore, _sourceCount: entry.sources.size })).sort((a, b) => b._rrfScore - a._rrfScore);
  return { results: sorted, total: sorted.length, diagnostics: { lexicalSignalQuality: lexicalSignalQuality(query, ftsRanked, termWeights), topFtsCount: ftsRanked.length, hasExactTopicMatch, queryTopicSlugs, topicGuideHitCount: tgRanked.length } };
}

function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function bayesianRelevance(embeddingSim, topicJaccard, sharedTopicCount) {
  const prior = embeddingSim;
  const likelihood = 1 + sharedTopicCount * 0.3 + topicJaccard * 2.0;
  return prior * likelihood;
}

function contextBoost(results, contextVerseId) {
  if (!contextVerseId) return results;
  const meta = verseMetaCache.get(contextVerseId);
  if (!meta) return results;
  const contextTopics = verseTopicCache.get(contextVerseId);
  const contextBookId = db.prepare('SELECT book_id FROM chapters WHERE id = ?').get(meta.chapter_id)?.book_id;
  const contextVolId = contextBookId ? db.prepare('SELECT volume_id FROM books WHERE id = ?').get(contextBookId)?.volume_id : null;
  return results.map(r => {
    let boost = 0;
    if (contextVolId && r.book_id) { const rVol = db.prepare('SELECT volume_id FROM books WHERE id = ?').get(r.book_id)?.volume_id; if (rVol === contextVolId) boost += 0.05; }
    if (contextTopics && r.verse_id) { const rTopics = verseTopicCache.get(r.verse_id); if (rTopics) { let shared = 0; for (const t of contextTopics) if (rTopics.has(t)) shared++; boost += shared * 0.08; } }
    return { ...r, similarity_score: +((r.similarity_score || 0) + boost).toFixed(4) };
  });
}

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_POPULAR_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_POPULAR_MIN = 3;
const SEARCH_CACHE_MAX = 300;
const searchResultsCache = new Map();

function searchCacheGet(key) {
  const entry = searchResultsCache.get(key);
  if (!entry) return null;
  const ttl = (entry.hitCount || 0) >= SEARCH_CACHE_POPULAR_MIN ? SEARCH_CACHE_POPULAR_TTL_MS : SEARCH_CACHE_TTL_MS;
  if (Date.now() - entry.ts > ttl) { searchResultsCache.delete(key); return null; }
  entry.hitCount = (entry.hitCount || 0) + 1;
  searchResultsCache.delete(key);
  searchResultsCache.set(key, entry);
  return entry;
}

function searchCacheSet(key, results, total, meta) {
  const existing = searchResultsCache.get(key);
  const hitCount = existing ? (existing.hitCount || 0) : 0;
  if (searchResultsCache.size >= SEARCH_CACHE_MAX) searchResultsCache.delete(searchResultsCache.keys().next().value);
  searchResultsCache.set(key, { results, total, meta: meta || null, ts: Date.now(), hitCount });
}

function makeCacheKey(query, language, contextVerseId) { return `${String(query).toLowerCase().trim()}|${language}|${contextVerseId || ''}`; }
function encodeCursor(cacheKey, nextOffset, total) { return Buffer.from(JSON.stringify({ k: cacheKey, o: nextOffset, t: total })).toString('base64url'); }
function decodeCursor(cursor) { try { return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { return null; } }

const KJV_SPELLINGS = kjvSpellingReplacements.map(({ from, to }) => [new RegExp(`\\b${from}\\b`, 'gi'), to]);
function normalizeKJVSpellings(q) { let s = q; for (const [re, rep] of KJV_SPELLINGS) s = s.replace(re, rep); return s; }
function normalizeSearchText(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalizedTextIncludes(haystack, needle) { if (!needle || !haystack) return false; const idx = haystack.indexOf(needle); if (idx === -1) return false; const afterIdx = idx + needle.length; return afterIdx >= haystack.length || !/[a-z0-9]/.test(haystack[afterIdx]); }

async function runSearchPipeline(query, language, contextVerseId, log, sessionId = null) {
  const lang = String(language || 'en').toLowerCase().trim();
  if (lang === 'en' || lang === 'ylt') query = normalizeKJVSpellings(query);
  const cacheKey = makeCacheKey(query, lang, contextVerseId);
  const cached = searchCacheGet(cacheKey);
  if (cached) return { ...cached, fromCache: true, cacheKey };
  let results = [];
  let total = 0;
  let pipelineMeta = null;
  if (lang !== 'en') {
    const ENGLISH_VERSIONS = new Set(['ylt']);
    if (ENGLISH_VERSIONS.has(lang)) {
      const full = await runSearchPipeline(query, 'en', contextVerseId, log, sessionId);
      results = full.results || [];
      total = full.total || results.length;
      pipelineMeta = full.meta || null;
      const targetDb = resolveDbAdapter(lang);
      if (targetDb && targetDb !== dba) {
        const stmtCoords = dba.prepare('SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1');
        const stmtTransText = targetDb.prepare('SELECT scripture_text, verse_title, book_title FROM scriptures WHERE book_id = ? AND chapter_number = ? AND verse_number = ? LIMIT 1');
        results = results.map(r => { const coords = stmtCoords.get(r.verse_id); if (!coords) return r; const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number); if (t?.scripture_text) return { ...r, scripture_text: t.scripture_text, verse_title: t.verse_title || r.verse_title, book_title: t.book_title || r.book_title }; return r; });
      }
    } else {
      const r = searchScriptureInDb(query, 0, 200, resolveDbAdapter(lang), log);
      results = r.results || [];
      total = r.total || results.length;
    }
  } else {
    const isQuoted = /^"(.+)"$/.test(query.trim());
    const isSemantic = query.trim().startsWith('~');
    if (!isQuoted && !isSemantic) {
      const ref = engine.parseScriptureReference(query);
      if (ref) {
        const refResult = searchScripture(query, 0, 200, dba, log);
        if (refResult.total > 0) {
          const refMeta = { intent: 'reference', confidence: 1, expansions: [], facets: [] };
          searchCacheSet(cacheKey, refResult.results, refResult.total, refMeta);
          return { results: refResult.results, total: refResult.total, meta: refMeta, fromCache: false, cacheKey };
        }
      }
    }
    if (isQuoted) {
      const phrase = query.trim().slice(1, -1).trim();
      const phraseResult = phraseSearch(phrase, 0, 200, dba, log);
      const phraseMeta = { intent: 'phrase', display: 'Phrase', subtype: 'exact', entityMatch: null, confidence: 1, expansions: [], facets: [], originalQuery: phrase };
      searchCacheSet(cacheKey, phraseResult.results, phraseResult.total, phraseMeta);
      return { results: phraseResult.results, total: phraseResult.total, meta: phraseMeta, fromCache: false, cacheKey };
    }
    if (!embeddingsReady || !topicalGuideReady || !entitiesReady) await ensureSearchWarmup({ waitForEmbeddings: true });
    if (isSemantic) {
      const semQuery = query.trim().slice(1).trim();
      if (semQuery && embeddingsReady && embeddingPipe) {
        try {
          const out = await embeddingPipe(semQuery, { pooling: 'mean', normalize: true });
          const qvec = new Float32Array(out.data);
          const semResult = await semanticSearch(semQuery, 0, 200, new Set(), qvec);
          if (semResult && semResult.results.length > 0) {
            const facets = nearestClusters(qvec, 4);
            const semMeta = { intent: 'semantic-explicit', display: 'Semantic', subtype: 'embedding', entityMatch: null, confidence: 0, expansions: [], facets, originalQuery: semQuery };
            searchCacheSet(cacheKey, semResult.results, semResult.total, semMeta);
            return { results: semResult.results, total: semResult.total, meta: semMeta, fromCache: false, cacheKey };
          }
        } catch (err) { log.warn({ err }, '[SemanticExplicit] embedding failed, falling through to normal pipeline'); }
      }
      query = query.trim().slice(1).trim();
    }
    // const autoPhraseResult = phraseSearch(query.trim(), 0, 50, dba, log);
    // const autoPhraseWordCount = query.trim().split(/\s+/).filter(t => t.length > 1).length;
    // const autoPhraseCoverageFloor = autoPhraseWordCount >= 5 ? 0.42 : 0.68;
    // const normalizedQueryText = normalizeSearchText(query.trim());
    // const autoPhraseTermWeights = queryTermWeights(query.trim());
    // const autoAnchorPhrases = autoPhraseWordCount >= 5 ? extractAnchorPhrases(query.trim(), autoPhraseTermWeights, 4) : [];
    // const phraseHitEligible = autoPhraseWordCount >= 5 ? LONG_QUERY_PHRASE_MATCH_TYPES.has(autoPhraseResult.matchType) : autoPhraseWordCount >= 2 && SHORT_QUERY_PHRASE_MATCH_TYPES.has(autoPhraseResult.matchType);
    // const autoPhraseResult = { matchType: '' };   // dummy to avoid undefined
    const phraseHits = [];                        // empty array
    // const ftsResult = { matchType: '', results: [] };
    
    // const phraseHits = phraseHitEligible ? autoPhraseResult.results.map(r => { const phraseCoverage = weightedLexicalCoverage(query.trim(), r, autoPhraseTermWeights); const normalizedVerseText = normalizeSearchText(r.scripture_text || ''); const directPhraseMatch = normalizedQueryText.length > 0 && normalizedTextIncludes(normalizedVerseText, normalizedQueryText); const sequenceScore = querySequenceScore(query.trim(), r.scripture_text, autoPhraseTermWeights); return { ...r, _source: 'fts-phrase', _phraseMatch: true, _phraseCoverage: phraseCoverage, _directPhraseMatch: directPhraseMatch, _anchorPhraseMatch: autoPhraseResult.matchType === 'phrase' || autoPhraseResult.matchType === 'near', _directQueryMatch: directPhraseMatch, _sequenceScore: sequenceScore, _anchorWindowScore: anchorWindowScore(r.scripture_text, autoAnchorPhrases, autoPhraseTermWeights) }; }).filter(r => { if ((r._phraseCoverage || 0) < autoPhraseCoverageFloor) return false; if (autoPhraseWordCount <= 4) return Boolean(r._directPhraseMatch); return Boolean(r._directPhraseMatch) || (r._sequenceScore || 0) >= 0.35 || ((r._anchorWindowScore || 0) >= 0.55 && (r._phraseCoverage || 0) >= 0.5); }) : [];

    const phraseIdsSet = new Set(phraseHits.map(r => r.verse_id));
    let qvec = null;
    if (embeddingsReady && embeddingPipe) { try { const out = await embeddingPipe(query.trim(), { pooling: 'mean', normalize: true }); qvec = whitenVector(new Float32Array(out.data)); } catch {} }
    let queryWordVecs = null;
    const qWords = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (embeddingsReady && embeddingPipe && qWords.length >= 2 && qWords.length <= 8) { try { const wordEmbeds = []; for (const w of qWords) { const wout = await embeddingPipe(w, { pooling: 'mean', normalize: true }); wordEmbeds.push({ word: w, vec: whitenVector(new Float32Array(wout.data)), weight: 1.0 }); } queryWordVecs = wordEmbeds; } catch {} }
    if (phraseHits.length > 0 && qvec) { for (const r of phraseHits) { const vec = embeddingCache.get(r.verse_id); r.similarity_score = vec ? +cosineSimilarity(qvec, vec).toFixed(4) : 0; } }
    const queryWords = new Set(query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 1));
    let fusionResult = multiSourceFusion(query.trim(), query.trim(), 200);
    const topRrfScore = fusionResult.results[0]?._rrfScore || 0;
    const topBm25 = topRrfScore * 300;
    const lexicalQuality = fusionResult.diagnostics?.lexicalSignalQuality ?? 0;
    const confidence = sigmoidConfidence(topBm25, fusionResult.total) * (0.35 + 0.65 * lexicalQuality);
    const queryWordCount = query.trim().split(/\s+/).filter(t => t.length > 1).length;
    const isShortQuery = queryWordCount <= 2;
    const shouldPreferSemantic = qvec && queryWordCount >= 5 && lexicalQuality < 0.45;
    const hasExactTopicMatch = !!fusionResult.diagnostics?.hasExactTopicMatch;
    const topicGuideHitCount = fusionResult.diagnostics?.topicGuideHitCount || 0;
    let prelimIntent = null;
    if (qvec && (queryWordCount >= 2 || hasExactTopicMatch)) {
      prelimIntent = classifyQueryIntent(query.trim(), confidence, qvec);
      prelimIntent = refineIntentWithTopicSignals(prelimIntent, queryWordCount, lexicalQuality, topicGuideHitCount, hasExactTopicMatch);
      if (shouldPreferSemantic && prelimIntent.type === 'keyword') prelimIntent = { type: 'conceptual', subtype: 'long-query-low-lexical', entityMatch: null, display: 'Semantic' };
      else if (shouldPreferSemantic && prelimIntent.type === 'mixed') prelimIntent = { type: 'situational', subtype: 'long-query-low-lexical', entityMatch: null, display: 'Situational' };
      if (intentWeights.has(prelimIntent.type)) fusionResult = multiSourceFusion(query.trim(), query.trim(), 200, prelimIntent.type);
    }
    if (shouldPreferSemantic && qvec) {
      try {
        const semPrimary = await semanticSearch(query.trim(), 0, 80, new Set(), qvec);
        const semFiltered = (semPrimary?.results || []).filter(r => (r.similarity_score || 0) >= 0.25);
        if (semFiltered.length >= 3) {
          const semWeight = Math.max(1.8, (getIntentWeights(prelimIntent?.type || 'conceptual')[1] || 1.0) * 2.2);
          const mergedScores = reciprocalRankFusion([semFiltered.map(r => ({ ...r, _source: 'semantic-primary' })), fusionResult.results], [], [semWeight, 1.0]);
          fusionResult.results = [...mergedScores.entries()].map(([vid, entry]) => ({ ...entry.row, verse_id: vid, _rrfScore: entry.rrfScore, _sourceCount: entry.sources.size })).sort((a, b) => b._rrfScore - a._rrfScore);
          fusionResult.total = fusionResult.results.length;
        }
      } catch {}
    }
    const pmiTermsAdded = queryWordCount <= 1 ? expandWithPmi(query.trim()).slice(0, 5).map(t => t.term) : [];
    let conceptTermsUsed = [];
    const shouldExpand = shouldPreferSemantic || (confidence < 0.6) || (isShortQuery && confidence < 0.85);
    if (shouldExpand && qvec && conceptCache.length) {
      const topN = confidence < 0.3 ? 5 : (confidence < 0.6 ? 3 : 2);
      const wScale = confidence >= 0.6 ? 0.5 : 1.0;
      const concepts = await expandWithConcepts(query.trim(), topN, qvec);
      conceptTermsUsed = concepts.map(c => c.phrase);
      for (const c of concepts) {
        const cFusion = multiSourceFusion(c.phrase, c.phrase, 5);
        for (const r of cFusion.results) { if (!fusionResult.results.find(e => e.verse_id === r.verse_id)) { r._rrfScore = (r._rrfScore || 0) * c.score * wScale; fusionResult.results.push(r); } }
      }
      fusionResult.total = fusionResult.results.length;
    }
    const queryTopicSlugs = fusionResult.diagnostics?.queryTopicSlugs || [];
    results = fusionResult.results;
    total = fusionResult.total;
    if (phraseHits.length > 0) {
      const rrfScoreByVerse = new Map(results.filter(r => phraseIdsSet.has(r.verse_id)).map(r => [r.verse_id, r._rrfScore || 0]));
      results = results.filter(r => !phraseIdsSet.has(r.verse_id));
      results = [...phraseHits.map(r => ({ ...r, _rrfScore: rrfScoreByVerse.get(r.verse_id) || 0 })), ...results];
    }
    let embeddingPhraseMatches = [];
    const queryWordCountForPhrase = query.trim().split(/\s+/).filter(t => t.length > 1).length;
    if (embeddingsReady && queryWordCountForPhrase >= 2 && queryWordCountForPhrase <= 8 && wordEmbeddingCache && wordEmbeddingCache.size > 0 && results && results.length > 0) {
      try {
        const phraseMatchStartTime = Date.now();
        const candidates = results.slice(0, 200).map(r => ({ verse_id: r.verse_id, scripture_text: r.scripture_text || (verseMetaCache.get(r.verse_id)?.scripture_text || ''), existingScore: r._rrfScore || 0 })).filter(c => c.scripture_text && c.scripture_text.length > 0);
        const embedder = embeddingPipe ? { encode: async (text, opts) => { const out = await embeddingPipe(text, opts); return { data: out.data }; } } : null;
        const matches = await batchPhraseMatch(query.trim(), candidates, wordEmbeddingCache, embedder, { threshold: 0.55, maxResults: 15 });
        if (matches && matches.length > 0) {
          const stmtVerseForMatch = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`);
          for (const match of matches) {
            const row = stmtVerseForMatch.get(match.verse_id);
            if (row) embeddingPhraseMatches.push({ ...row, similarity_score: match.score, _source: 'semantic-phrase', _rrfScore: match.score * 0.9, _directQueryMatch: true, _phraseCoverage: match.score });
          }
          const phraseMatchElapsed = Date.now() - phraseMatchStartTime;
          log.info(`[PhraseMatcher] Found ${matches.length} matches from ${candidates.length} candidates in ${phraseMatchElapsed}ms`);
        }
      } catch (err) { log.warn('[PhraseMatcher] Error:', err.message); }
    }
    if (embeddingPhraseMatches && embeddingPhraseMatches.length > 0) {
      const existingIds = new Set(results.map(r => r.verse_id));
      let injectedCount = 0;
      for (const match of embeddingPhraseMatches) { if (!existingIds.has(match.verse_id)) { results.push(match); existingIds.add(match.verse_id); injectedCount++; } }
      if (injectedCount > 0) { results.sort((a, b) => (b._rrfScore || 0) - (a._rrfScore || 0)); log.info(`[PhraseMatcher] Injected ${injectedCount} new semantic phrase results`); }
    }
    if (qvec && queryWordCount >= 2 && embeddingsReady && embeddingPipe) {
      const semInjectWeight = Math.min(0.95, 0.40 + (queryWordCount - 1) * 0.08);
      const semInjectFloor = queryWordCount >= 5 ? 0.22 : 0.16;
      const strongLexicalHead = results.slice(0, 5).some(r => (r._sequenceScore || 0) >= 0.35 || (r._lexicalCoverage || 0) >= 0.48 || Boolean(r._anchorPhraseMatch));
      try {
        const semProbe = await semanticSearch(query.trim(), 0, 50, new Set(), qvec);
        if (semProbe && semProbe.results.length > 0) {
          const existingByVerse = new Map(results.map((r, i) => [r.verse_id, i]));
          for (const sr of semProbe.results) {
            if ((sr.similarity_score || 0) < semInjectFloor) continue;
            if (queryWordCount >= 5 && strongLexicalHead && (sr.similarity_score || 0) < 0.28) continue;
            const existingIdx = existingByVerse.get(sr.verse_id);
            if (existingIdx !== undefined) {
              const existing = results[existingIdx];
              if ((sr.similarity_score || 0) > (existing.similarity_score || 0)) { existing.similarity_score = sr.similarity_score; existing._rrfScore = Math.max(existing._rrfScore || 0, sr.similarity_score * semInjectWeight * 0.05); }
            } else {
              results.push({ ...sr, _source: 'sem-inject', _rrfScore: Math.max(0.01, sr.similarity_score * semInjectWeight * 0.06) });
              existingByVerse.set(sr.verse_id, results.length - 1);
            }
          }
          total = results.length;
        }
      } catch {}
    }
    if (qvec && db_graph && results.length > 0) {
      const existingIds = new Set(results.map(r => r.verse_id));
      const stmtVerse = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`);
      const knnStmt = db_graph.prepare('SELECT neighbor_id, similarity FROM verse_knn WHERE verse_id = ? ORDER BY rank ASC LIMIT 10');
      const toInject = [];
      for (const r of results.slice(0, 12)) {
        const parentSim = r.similarity_score || r.simToQuery || 0;
        if (parentSim < 0.25) continue;
        let knnRows;
        try { knnRows = knnStmt.all(r.verse_id); } catch { continue; }
        for (let ki = 0; ki < knnRows.length; ki++) {
          const { neighbor_id, similarity: edgeSim } = knnRows[ki];
          if (existingIds.has(neighbor_id)) continue;
          const neighborScore = parentSim * edgeSim * Math.exp(-ki * 0.15);
          const nVec = embeddingCache.get(neighbor_id);
          const directSim = nVec ? cosineSimilarity(qvec, nVec) : 0;
          if (directSim < 0.2) continue;
          const finalScore = (neighborScore + directSim) / 2;
          toInject.push({ verse_id: neighbor_id, score: finalScore });
          existingIds.add(neighbor_id);
        }
      }
      toInject.sort((a, b) => b.score - a.score);
      for (const { verse_id, score } of toInject.slice(0, 30)) { const row = stmtVerse.get(verse_id); if (row) results.push({ ...row, _source: 'knn-expand', _rrfScore: score * 0.6, similarity_score: +score.toFixed(4) }); }
      total = results.length;
    }
    if (spectralReady && qvec && results.length > 0) {
      const topK = Math.min(5, results.length);
      const qSpec = new Float32Array(SPECTRAL_DIM);
      let wSum = 0;
      let spectralSeeds;
      if (hnswIndex) spectralSeeds = hnswIndex.query(qvec, topK, topK * 4).map(h => h.verse_id);
      else spectralSeeds = results.slice(0, topK).map(r => r.verse_id);
      for (const vid of spectralSeeds) {
        const sv = spectralCache.get(vid);
        if (!sv) continue;
        const vec = embeddingCache.get(vid);
        const w = vec ? Math.max(0, cosineSimilarity(qvec, vec)) : 0.1;
        for (let d = 0; d < SPECTRAL_DIM; d++) qSpec[d] += w * sv[d];
        wSum += w;
      }
      if (wSum > 0) {
        for (let d = 0; d < SPECTRAL_DIM; d++) qSpec[d] /= wSum;
        let norm = 0;
        for (let d = 0; d < SPECTRAL_DIM; d++) norm += qSpec[d] * qSpec[d];
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < SPECTRAL_DIM; d++) qSpec[d] /= norm;
        for (const r of results) {
          const sv = spectralCache.get(r.verse_id);
          if (sv) {
            let dot = 0, na = 0, nb = 0;
            for (let d = 0; d < SPECTRAL_DIM; d++) { dot += qSpec[d] * sv[d]; na += qSpec[d] * qSpec[d]; nb += sv[d] * sv[d]; }
            r._spectralSim = dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
          }
        }
      }
    }
    if (results.length > 1 && qvec) {
      const _preIntentClass = refineIntentWithTopicSignals(classifyQueryIntent(query.trim(), confidence, qvec), queryWordCount, lexicalQuality, topicGuideHitCount, hasExactTopicMatch);
      const _iW = getIntentWeights(_preIntentClass.type);
      const _semNorm = Math.min(1.0, Math.max(0.0, (_iW[1] - 0.1) / 1.3));
      const _mmrLambda = 0.5 + (0.5 - _semNorm) * 0.16;
      results = mmrRerank(results, qvec, _mmrLambda, Math.min(200, results.length));
      results = results.map(r => ({ ...r, similarity_score: +(r.simToQuery ?? r.similarity_score ?? 0).toFixed(4) }));
    }
    const semFallbackThreshold = isShortQuery ? 15 : 5;
    if (total < semFallbackThreshold && qvec) {
      const excludeIds = new Set(results.map(r => r.verse_id));
      const sem = await semanticSearch(query.trim(), 0, 30, excludeIds, qvec);
      if (sem && sem.results.length > 0) { results = [...results, ...sem.results]; total = results.length; }
    }
    const propagationIntentClass = prelimIntent || refineIntentWithTopicSignals(classifyQueryIntent(query.trim(), confidence, qvec), queryWordCount, lexicalQuality, topicGuideHitCount, hasExactTopicMatch);
    const propagationProfiles = {
      reference: null,
      phrase: { alpha: 0.72, hops: 1, iters: 3, seedLimit: 5, maxInfluence: 0.06, knnLimit: 8, crossRefLimit: 4, topicEdgeLimit: 0 },
      keyword: { alpha: 0.76, hops: 1, iters: 3, seedLimit: 6, maxInfluence: 0.07, knnLimit: 8, crossRefLimit: 5, topicEdgeLimit: hasExactTopicMatch ? 2 : 0 },
      mixed: { alpha: 0.8, hops: 2, iters: 4, seedLimit: 7, maxInfluence: 0.09, knnLimit: 10, crossRefLimit: 6, topicEdgeLimit: queryTopicSlugs.length > 0 ? 2 : 0 },
      situational: { alpha: 0.83, hops: 2, iters: 4, seedLimit: 8, maxInfluence: 0.12, knnLimit: 10, crossRefLimit: 6, topicEdgeLimit: queryTopicSlugs.length > 0 ? 4 : 0 },
      conceptual: { alpha: 0.84, hops: 2, iters: 5, seedLimit: 8, maxInfluence: 0.14, knnLimit: 12, crossRefLimit: 6, topicEdgeLimit: queryTopicSlugs.length > 0 ? 4 : 2 },
      entity: { alpha: 0.78, hops: 1, iters: 3, seedLimit: 5, maxInfluence: 0.07, knnLimit: 8, crossRefLimit: 4, topicEdgeLimit: 0 },
    };
    const propagationConfig = propagationProfiles[propagationIntentClass.type] || propagationProfiles.mixed;
    const qpprSeedRows = propagationConfig && results.length > 0 ? results.filter((row) => { if (!row || !row.verse_id) return false; if (row._directQueryMatch || row._anchorPhraseMatch) return true; if ((row._lexicalCoverage || 0) >= 0.44) return true; if ((row.similarity_score || 0) >= 0.32) return true; return row._source === 'cross-ref' || row._source === 'semantic-primary'; }).slice(0, propagationConfig.seedLimit) : [];
    const qpprScores = propagationConfig && qpprSeedRows.length >= 3 ? queryPPR(qpprSeedRows, { ...propagationConfig, queryTopicSlugs }) : null;
    if (contextVerseId) results = contextBoost(results, contextVerseId);
    if (rwrStmt && results.length > 0) {
      try {
        const existingIds = new Set(results.map(r => r.verse_id));
        const stmtVerse = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`);
        const toInject = new Map();
        for (const seed of results.slice(0, 3)) {
          const rwrRows = rwrStmt.all(seed.verse_id);
          for (const rr of rwrRows) {
            if (existingIds.has(rr.neighbor_id)) { const existing = results.find(r => r.verse_id === rr.neighbor_id); if (existing) existing._rrfScore = (existing._rrfScore || 0) + rr.rwr_score * 0.1; }
            else if ((toInject.get(rr.neighbor_id) || 0) < rr.rwr_score) toInject.set(rr.neighbor_id, rr.rwr_score);
          }
        }
        const candidates = [...toInject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        for (const [vid, rwrScore] of candidates) { const row = stmtVerse.get(vid); if (row) { const vec = embeddingCache.get(vid); const simScore = (vec && qvec) ? +cosineSimilarity(qvec, vec).toFixed(4) : 0; results.push({ ...row, _source: 'rwr', _rrfScore: rwrScore * 0.08, similarity_score: simScore }); } }
      } catch {}
    }
    if (queryWordVecs && queryWordVecs.length >= 2 && confidence < 0.7 && results.length > 0) {
      const wordVecLookup = new Map();
      for (const c of conceptCache) { if (!c.phrase.includes(' ')) wordVecLookup.set(c.phrase.toLowerCase(), c.vec); }
      const wmdLimit = Math.min(50, results.length);
      for (let i = 0; i < wmdLimit; i++) {
        const r = results[i];
        const cosSim = r.similarity_score || 0;
        if (cosSim <= 0) continue;
        const verseMeta = verseMetaCache.get(r.verse_id);
        const verseText = verseMeta?.scripture_text || r.scripture_text || '';
        const verseWords = verseText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const verseTokens = [];
        for (const w of [...new Set(verseWords)]) {
          const vec = wordVecLookup.get(w);
          if (!vec) continue;
          const idfScore = idfStmt ? (idfStmt.get(w)?.idf || 3.0) : 1.0;
          if (idfScore < 1.0) continue;
          verseTokens.push({ vec, weight: idfScore });
        }
        const vVec = embeddingCache.get(r.verse_id);
        if (verseTokens.length < 2) {
          if (!vVec) continue;
          const wmd = sinkhornWMD(queryWordVecs, [{ vec: vVec, weight: 1.0 }]);
          const wmdScore = Math.exp(-wmd * 3.0);
          r.similarity_score = +(0.7 * cosSim + 0.3 * wmdScore).toFixed(4);
        } else {
          const wSum = verseTokens.reduce((s, t) => s + t.weight, 0);
          for (const t of verseTokens) t.weight /= wSum;
          const wmd = sinkhornWMD(queryWordVecs, verseTokens);
          const wmdScore = Math.exp(-wmd * 3.0);
          r.similarity_score = +(0.6 * cosSim + 0.4 * wmdScore).toFixed(4);
        }
      }
    }
    const SEM_THRESHOLD_BASE = 0.28;
    const SEM_SIGMOID_K = 20;
    const intentClass = refineIntentWithTopicSignals(classifyQueryIntent(query.trim(), confidence, qvec), queryWordCount, lexicalQuality, topicGuideHitCount, hasExactTopicMatch);
    const _iWFinal = getIntentWeights(intentClass.type);
    const _semWNorm = Math.min(1.0, Math.max(0.0, (_iWFinal[1] - 0.1) / 1.3));
    const SEM_THRESHOLD = SEM_THRESHOLD_BASE - (_semWNorm - 0.5) * 0.08;
    const SIM_FLOOR = 0.15;
    if (qvec) {
      const _topRrf = results.length > 0 ? Math.max(...results.slice(0, 20).map(r => r._rrfScore || 0)) : 0;
      const RRF_FLOOR = _topRrf > 0 ? Math.max(_topRrf * 0.08, 0.001) : 0.015;
      results = results.filter(r => { if (phraseIdsSet.has(r.verse_id)) return true; const sim = r.similarity_score || 0; const rrf = r._rrfScore || 0; return sim >= SIM_FLOOR || rrf >= RRF_FLOOR; });
    }
    if (results.length > 1) {
      results = results.map(r => {
        const simScore = r.similarity_score || 0;
        const rrf = r._rrfScore || 0;
        const rrfNorm = Math.min(rrf * 8, 0.99);
        const isTopicalSource = (r._source || '').includes('topical');
        const qpprBoost = (qpprScores && qpprScores.get(r.verse_id)) || 0;
        r._qpprScore = qpprBoost;
        const specSim = r._spectralSim || 0;
        let tier, tierScore;
        const hasMeaningfulPhraseEvidence = phraseIdsSet.has(r.verse_id) || Boolean(r._directQueryMatch) || r._anchorPhraseMatch || (queryWordCount >= 5 && (r._sequenceScore || 0) >= 0.52 && (r._lexicalCoverage || 0) >= 0.4) || (queryWordCount >= 5 && (r._anchorWindowScore || 0) >= 0.72);
        if (hasMeaningfulPhraseEvidence) {
          tier = 2;
          tierScore = Math.min(Math.max(simScore > 0 ? simScore : 0, (r._directQueryMatch ? 0.92 : 0), (r._phraseCoverage || r._lexicalCoverage || 0) * 0.6 + (r._anchorStrength || 0) * 0.2 + (r._phraseSignal || 0) * 0.1 + (r._anchorWindowScore || 0) * 0.1, rrfNorm), 0.99);
        } else if (qvec && simScore > 0) {
          const gate = 1.0 / (1.0 + Math.exp(-SEM_SIGMOID_K * (simScore - SEM_THRESHOLD)));
          if (gate >= 0.5) { tier = 3; tierScore = Math.min(gate * simScore, 0.99); }
          else if (isTopicalSource) { tier = 4; tierScore = Math.min(gate * simScore + (1 - gate) * rrfNorm, 0.99); }
          else if (specSim > 0.55 && qpprBoost > 0.3) { tier = 4; tierScore = Math.min(specSim * 0.6 + rrfNorm * 0.4, 0.99); }
          else { tier = 5; tierScore = Math.min(rrfNorm + gate * simScore * 0.3, 0.99); }
        } else if (isTopicalSource) { tier = 4; tierScore = rrfNorm; }
        else { tier = 5; if (queryWordCount >= 5) { const lexicalNudge = Math.max(0, (r._lexicalCoverage || 0) - 0.28) * 0.08; const anchorNudge = (r._anchorWindowScore || 0) * 0.07; const sequenceNudge = (r._sequenceScore || 0) * 0.12; tierScore = Math.min(rrfNorm + lexicalNudge + anchorNudge + sequenceNudge, 0.99); } else { tierScore = rrfNorm; } }
        const structurePrior = computeWeakStructurePrior(r, intentClass.type, queryWordCount, lexicalQuality);
        let specificityScore = (6 - tier) + tierScore + qpprBoost * (propagationConfig?.maxInfluence || 0.08) + structurePrior;
        if (calibrationCurves.size > 0) specificityScore = calibrateScore(tier, specificityScore);
        const nextRow = { ...r, _specificity_score: specificityScore, _tier: tier, _structurePrior: structurePrior };
        nextRow._relevance_probability = computeRelevanceProbability(nextRow, intentClass.type, confidence);
        return nextRow;
      });
      results.sort((a, b) => (b._specificity_score || 0) - (a._specificity_score || 0) || (b._relevance_probability || 0) - (a._relevance_probability || 0));
    }
    const adaptiveCutoff = computeAdaptiveResultCutoff(results, intentClass.type, confidence);
    if (adaptiveCutoff) results = results.slice(0, adaptiveCutoff.keepCount);
    const allExpansions = [...new Set([...pmiTermsAdded, ...conceptTermsUsed])].filter(t => !queryWords.has(t) && t.length > 1).slice(0, 10);
    const facets = qvec ? nearestClusters(qvec, 4) : [];
    pipelineMeta = { intent: intentClass.type, display: intentClass.display, subtype: intentClass.subtype, entityMatch: intentClass.entityMatch, confidence: +confidence.toFixed(3), probabilityModel: 'logistic-v1', expansions: allExpansions, facets, qpprActive: !!(qpprScores && qpprScores.size > 0), graphSeedCount: qpprSeedRows.length, weakStructurePrior: shouldUseWeakStructurePrior(intentClass.type, queryWordCount, lexicalQuality), phraseMatchCount: phraseHits.length, adaptiveCutoff };
    try {
      const calIns = db_user.prepare('INSERT INTO search_calibration (ts, tier, raw_score, clicked) VALUES (?, ?, ?, 0)');
      const now = Date.now();
      db_user.transaction(() => { for (const r of results.slice(0, 20)) { if (r._tier != null && r._specificity_score != null) calIns.run(now, r._tier, +r._specificity_score.toFixed(4)); } })();
    } catch {}
    results = results.map(r => { const { _rrfScore, _bm25, _bm25_rank, _sourceCount, simToQuery, idx, _learned_score, _phraseMatch, _anchorPhraseMatch, _phraseSignal, _phraseCoverage, _qpprScore, _structurePrior, ...clean } = r; return clean; });
    total = results.length;
  }

    // ── FALLBACK: if no semantic results, use plain FTS ──
  if (total === 0 && lang === 'en') {
    log.info(`[Fallback] No semantic results for "${query}" → using FTS`);
    const ftsResult = searchScripture(query, 0, 200, dba, log);
    if (ftsResult.results.length > 0) {
      results = ftsResult.results;
      total = ftsResult.total;
      // Mark the meta so the client knows it's a fallback
      pipelineMeta = {
        intent: 'keyword-fallback',
        display: 'Keyword (Fallback)',
        confidence: 0,
        fallback: true,
      };
      // Skip the rest of post‑processing (dwell, item2vec, session centroid)
      // because those rely on embeddings which are not available.
      searchCacheSet(cacheKey, results, total, pipelineMeta);
      return { results, total, meta: pipelineMeta, fromCache: false, cacheKey };
    }
  }
  try {
    const topDwell = db_user.prepare(`SELECT verse_id, SUM(dwell_ms) AS total_dwell FROM reading_events WHERE event_type = 'read' AND dwell_ms > 3000 GROUP BY verse_id ORDER BY total_dwell DESC LIMIT 500`).all();
    if (topDwell.length > 0) {
      const maxDwell = topDwell[0].total_dwell || 1;
      const dwellMap = new Map(topDwell.map(r => [r.verse_id, r.total_dwell / maxDwell]));
      results = results.map(r => { const dw = dwellMap.get(r.verse_id) || 0; if (dw > 0) return { ...r, similarity_score: ((r.similarity_score || 0) + dw * 0.15) }; return r; });
    }
  } catch {}
  if (item2vecReady && item2vecVectors.size > 0 && results.length > 0) {
    const topVecs = results.slice(0, 5).map(r => item2vecVectors.get(r.verse_id)).filter(Boolean);
    if (topVecs.length > 0) {
      const queryVec = new Float32Array(ITEM2VEC_DIM);
      for (const v of topVecs) for (let i = 0; i < ITEM2VEC_DIM; i++) queryVec[i] += v[i] / topVecs.length;
      results = results.map(r => { const rv = item2vecVectors.get(r.verse_id); if (!rv) return r; const sim = item2vecSimilarity(queryVec, rv); return { ...r, similarity_score: (r.similarity_score || 0) + sim * 0.1 }; });
    }
  }
  let sessionCentroidActive = false;
  if (sessionId && embeddingsReady) {
    try {
      const sState = sessionId && typeof getSessionState === 'function' ? sessionState.get(sessionId) : null;
      if (sState && sState.liveHistory && sState.liveHistory.length >= 2) {
        const centroid = sessionCentroid(sState.liveHistory);
        if (centroid) {
          sessionCentroidActive = true;
          results = results.map(r => { const vec = embeddingCache.get(r.verse_id); if (!vec) return r; const sim = cosineSimilarity(centroid, vec); const boost = Math.max(0, sim - 0.3) * 0.4; return boost > 0 ? { ...r, similarity_score: (r.similarity_score || 0) + boost } : r; });
        }
      }
    } catch {}
  }
  if (pipelineMeta) pipelineMeta.sessionDrift = sessionCentroidActive;
  searchCacheSet(cacheKey, results, total, pipelineMeta);
  return { results, total, meta: pipelineMeta, fromCache: false, cacheKey };
}

function buildVerseMetaCache() {
  const rows = db.prepare('SELECT id AS verse_id, chapter_id, scripture_text FROM verses').all();
  for (const r of rows) verseMetaCache.set(r.verse_id, { chapter_id: r.chapter_id, scripture_text: r.scripture_text });
}

function buildEmbeddingCache() {
  if (!db_embed) return;
  const useWhitened = false;
  const table = 'verse_embeddings';
  let count = 0;
  try {
    const rows = db_embed.prepare(`SELECT verse_id, embedding FROM ${table}`).all();
    for (const r of rows) { embeddingCache.set(r.verse_id, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)); count++; }
  } catch (err) { fastify.log.warn('[Embeddings] Failed to load verse_embeddings — no fallback available'); }
  embeddingsReady = true;
  fastify.log.info(`[Embeddings] Loaded ${count} vectors (raw — ZCA whitening disabled)`);
  buildHNSWIndex();
  try {
    const graphPath = require('path').join(__dirname, '..', 'resources', 'db', 'verse-graph.db');
    const graphDb = new (require('better-sqlite3'))(graphPath, { readonly: true });
    const specRows = graphDb.prepare('SELECT verse_id, embedding FROM verse_spectral').all();
    for (const r of specRows) spectralCache.set(r.verse_id, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4));
    spectralReady = spectralCache.size > 0;
    graphDb.close();
    fastify.log.info(`[Spectral] Loaded ${spectralCache.size} spectral embeddings (${SPECTRAL_DIM}D)`);
  } catch (err) { fastify.log.warn('[Spectral] verse_spectral not available (non-fatal):', err.message); }
}

async function processBatchAsync(pipe, verses, offset) {
  if (offset >= verses.length) { buildEmbeddingCache(); fastify.log.info('[Embeddings] Ready — in-memory cache built.'); return; }
  const batch = verses.slice(offset, offset + EMBED_BATCH_SIZE);
  const rows = [];
  for (const v of batch) { const out = await pipe(v.scripture_text, { pooling: 'mean', normalize: true }); rows.push({ verse_id: v.verse_id, buf: Buffer.from(new Float32Array(out.data).buffer) }); }
  const ins = db_embed.prepare('INSERT OR REPLACE INTO verse_embeddings (verse_id, embedding) VALUES (?, ?)');
  db_embed.transaction(items => { for (const { verse_id, buf } of items) ins.run(verse_id, buf); })(rows);
  const done = offset + batch.length;
  if (done % 1000 < EMBED_BATCH_SIZE || done >= verses.length) fastify.log.info(`[Embeddings] ${done}/${verses.length}`);
  setImmediate(() => processBatchAsync(pipe, verses, done));
}

async function initEmbeddings() {
  if (!db_embed) return;
  
  async function loadScripturePipeline() {
    const { pipeline, env } = await import('@xenova/transformers');
    try {
      const onnxNode = require('onnxruntime-node');
      if (onnxNode && onnxNode.env) {
        env.backends = env.backends || {};
        env.backends.onnx = onnxNode.env;
        fastify.log.info('[Embeddings] forcing Xenova to use onnxruntime-node backend');
      }
    } catch (e) {
      fastify.log.warn('[Embeddings] onnxruntime-node not available:', e.message);
    }
    const localModel = path.join(ONNX_MODEL_DIR, SCRIPTURE_MODEL);
    const quantizedPath = path.join(localModel, 'onnx', 'model_quantized.onnx');
    const plainPath = path.join(localModel, 'onnx', 'model.onnx');
    const hasQuantized = fs.existsSync(quantizedPath);
    const hasPlain = fs.existsSync(plainPath);
    if (!hasQuantized && !hasPlain) throw new Error('[Embeddings] ONNX model not found');
    env.localModelPath = ONNX_MODEL_DIR;
    env.allowRemoteModels = false;
    return pipeline('feature-extraction', SCRIPTURE_MODEL, { quantized: hasQuantized });
  }
  
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
    const existing = db_embed.prepare('SELECT COUNT(*) AS n FROM verse_embeddings').get().n;
    
    if (!REBUILD_EMBEDDINGS && existing >= total) {
      fastify.log.info(`[Embeddings] ${existing}/${total} pre-stored — loading cache.`);
      buildEmbeddingCache();
      
      // CRITICAL: Initialize ONNX Runtime for semantic search
      fastify.log.info('[Embeddings] Initializing ONNX Runtime for semantic search…');
      const onnxReady = await initOnnxSession();
      
      if (onnxReady) {
        embeddingPipe = async (text, opts) => {
          const vec = await embedWithOnnx(text);
          return { data: vec };
        };
        fastify.log.info('[Embeddings] ONNX Runtime ready — semantic search enabled.');
      } else {
        fastify.log.warn('[Embeddings] ONNX Runtime failed, falling back to Xenova');
        try {
          embeddingPipe = await loadScripturePipeline();
          fastify.log.info('[Embeddings] Xenova pipeline ready (fallback).');
        } catch (pipeErr) {
          fastify.log.warn('[Embeddings] Pipeline load failed (semantic search disabled):', pipeErr.message);
        }
      }
      return;
    }
    
    if (SKIP_RECOMPUTE) {
      fastify.log.warn('[Embeddings] Production mode — cannot compute missing embeddings.');
      if (existing > 0) {
        buildEmbeddingCache();
        const onnxReady = await initOnnxSession();
        if (onnxReady) {
          embeddingPipe = async (text, opts) => {
            const vec = await embedWithOnnx(text);
            return { data: vec };
          };
        }
      }
      return;
    }
    
    fastify.log.info('[Embeddings] Loading pipeline…');
    const pipe = await loadScripturePipeline();
    embeddingPipe = pipe;
    fastify.log.info('[Embeddings] Pipeline loaded.');
    
    if (REBUILD_EMBEDDINGS) {
      db_embed.prepare('DELETE FROM verse_embeddings').run();
      fastify.log.info('[Embeddings] Cleared for rebuild.');
    }
    
    const embeddedIds = new Set(db_embed.prepare('SELECT verse_id FROM verse_embeddings').all().map(r => r.verse_id));
    const missing = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all().filter(v => !embeddedIds.has(v.verse_id));
    fastify.log.info(`[Embeddings] Computing ${missing.length} embeddings in background…`);
    setImmediate(() => processBatchAsync(pipe, missing, 0));
  } catch (err) {
    fastify.log.error('[Embeddings] Init failed: ' + err.message);
  }
}

function ensureSearchWarmup({ waitForEmbeddings = false } = {}) {
  if (!searchWarmupPromise) {
    searchWarmupPromise = (async () => { try { initializeCaches(); } catch (err) { fastify.log.error(err, '[Caches] initialization failed'); } try { await initEmbeddings(); } catch (err) { fastify.log.error(err, '[Embeddings] initialization failed'); } })();
  }
  if (!waitForEmbeddings) searchWarmupPromise.catch(() => {});
  return searchWarmupPromise;
}

const entityPersonIndex = new Map();
const entityPlaceIndex = new Map();
const verseEntityCache = new Map();
let entitiesReady = false;

function normalizeEntityName(name) { return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }

function buildEntityCache() {
  if (!db_tags) return;
  try {
    const personCount = db_tags.prepare('SELECT COUNT(*) AS n FROM entity_person_index').get()?.n;
    if (personCount > 0) {
      const personStmt = db_tags.prepare('SELECT DISTINCT name_normalized FROM entity_person_index');
      for (const r of personStmt.all()) { const verses = db_tags.prepare('SELECT verse_id FROM entity_person_index WHERE name_normalized = ?').all(r.name_normalized); entityPersonIndex.set(r.name_normalized, new Set(verses.map(v => v.verse_id))); }
      const placeStmt = db_tags.prepare('SELECT DISTINCT name_normalized FROM entity_place_index');
      for (const r of placeStmt.all()) { const verses = db_tags.prepare('SELECT verse_id FROM entity_place_index WHERE name_normalized = ?').all(r.name_normalized); entityPlaceIndex.set(r.name_normalized, new Set(verses.map(v => v.verse_id))); }
      const vecRows = db_tags.prepare('SELECT verse_id, people, places FROM verse_entity_cache').all();
      for (const r of vecRows) verseEntityCache.set(r.verse_id, { people: JSON.parse(r.people || '[]'), places: JSON.parse(r.places || '[]') });
      entitiesReady = true;
      fastify.log.info(`[Entities] Pre-baked: ${entityPersonIndex.size} people, ${entityPlaceIndex.size} places, ${verseEntityCache.size} verses`);
      try {
        const centroidRows = db_tags.prepare('SELECT entity_id, centroid FROM ai_entity_centroids').all();
        for (const r of centroidRows) entityCentroidCache.set(r.entity_id, new Float32Array(r.centroid.buffer, r.centroid.byteOffset, r.centroid.byteLength / 4));
        fastify.log.info(`[Entity Centroids] ${entityCentroidCache.size} centroid vectors loaded`);
      } catch {}
      return;
    }
  } catch {}
  try {
    const chapterRows = db_tags.prepare('SELECT chapter_id, entities_json FROM chapter_entities').all();
    const chapterEntityCache = new Map();
    for (const r of chapterRows) { let people = [], places = []; if (r.entities_json) { try { const j = JSON.parse(r.entities_json); people = j.people || []; places = j.places || []; } catch {} } chapterEntityCache.set(r.chapter_id, { people, places }); }
    const verseChapterRows = db_tags.prepare('SELECT verse_id, chapter_id FROM verse_doctrine_tags').all();
    for (const vc of verseChapterRows) {
      const ent = chapterEntityCache.get(vc.chapter_id);
      if (!ent) continue;
      verseEntityCache.set(vc.verse_id, ent);
      for (const p of ent.people) { const key = normalizeEntityName(p); if (!entityPersonIndex.has(key)) entityPersonIndex.set(key, new Set()); entityPersonIndex.get(key).add(vc.verse_id); }
      for (const p of ent.places) { const key = normalizeEntityName(p); if (!entityPlaceIndex.has(key)) entityPlaceIndex.set(key, new Set()); entityPlaceIndex.get(key).add(vc.verse_id); }
    }
    entitiesReady = chapterRows.length > 0;
    fastify.log.info(`[Entities] Runtime cache: ${entityPersonIndex.size} people, ${entityPlaceIndex.size} places`);
  } catch (err) { fastify.log.warn('[Entities] Cache build failed:', err.message); }
}

function initializeCaches() {
  buildVerseMetaCache();
  buildTopicalGuideCache();
  buildEntityCache();
  initIdfLookup();
  initPprLookup();
  initRwrLookup();
  initClusterLabels();
}

function topicSearch(query, page = 0, pageSize = 10) {
  if (!topicalGuideReady || !db_tg) return { results: [], total: 0 };
  const lower = String(query || '').toLowerCase().trim();
  if (!lower) return { results: [], total: 0 };
  const allTopics = [...topicNameMap.entries()];
  let matched = allTopics.find(([s, n]) => s === lower || String(n || '').toLowerCase() === lower) ?? allTopics.find(([s, n]) => s.startsWith(lower) || String(n || '').toLowerCase().startsWith(lower)) ?? allTopics.find(([s, n]) => s.includes(lower) || String(n || '').toLowerCase().includes(lower));
  if (!matched) return null;
  const [topicSlug, topicName] = matched;
  const queryTopics = new Set([topicSlug]);
  const topicVerseIds = db_tg.prepare(`SELECT g.verse_id FROM topical_guide g JOIN topics t ON t.id = g.topic_id WHERE t.slug = ? AND g.verse_id IS NOT NULL AND g.verse_id != -1`).all(topicSlug).map(r => r.verse_id);
  if (!topicVerseIds.length) return { results: [], total: 0, matchedTopic: topicName };
  const scored = topicVerseIds.map(vid => { const vTopics = verseTopicCache.get(vid) ?? new Set(); let overlap = 0; for (const s of queryTopics) if (vTopics.has(s)) overlap++; return { verse_id: vid, overlap }; });
  scored.sort((a, b) => b.overlap - a.overlap);
  const total = scored.length;
  const paged = scored.slice(page * pageSize, page * pageSize + pageSize);
  const stmt = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, volume_id FROM scriptures WHERE verse_id = ?`);
  const results = paged.map(({ verse_id }) => ({ ...stmt.get(verse_id), matched_concept: topicName }));
  return { results, total, matchedTopic: topicName };
}

fastify.get('/topic-search', async (request, reply) => {
  const { q, language = 'en' } = request.query;
  const page = Math.max(0, parseInt(request.query.page ?? 0, 10) || 0);
  const pageSize = Math.min(20, Math.max(1, parseInt(request.query.pageSize ?? 10, 10) || 10));
  if (!q || !q.trim()) { reply.code(400); return { error: 'q is required' }; }
  if (!topicalGuideReady || !embeddingsReady || !entitiesReady) await ensureSearchWarmup({ waitForEmbeddings: true });
  const lang = language.toLowerCase();
  const targetDb = lang !== 'en' ? resolveDbAdapter(lang) : null;
  const stmtCoords = targetDb ? dba.prepare('SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1') : null;
  const stmtTransText = targetDb ? targetDb.prepare('SELECT scripture_text FROM scriptures WHERE book_id = ? AND chapter_number = ? AND verse_number = ? LIMIT 1') : null;
  const translateResults = (results) => { if (!stmtCoords || !stmtTransText) return results; return results.map(r => { const coords = stmtCoords.get(r.verse_id); if (!coords) return r; const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number); return t?.scripture_text ? { ...r, scripture_text: t.scripture_text } : r; }); };
  const tgResult = topicSearch(q.trim(), page, pageSize);
  if (tgResult && tgResult.total > 0) return { results: translateResults(tgResult.results), total: tgResult.total, matchedTopic: tgResult.matchedTopic ?? null, page, pageSize, fallback: false };
  const db = lang !== 'en' && targetDb ? targetDb : dba;
  const { results: ftsResults, total: ftsTotal } = phraseSearch(q.trim(), page, pageSize, dba, fastify.log);
  return { results: translateResults(ftsResults), total: ftsTotal ?? ftsResults.length, matchedTopic: null, page, pageSize, fallback: true };
});

fastify.get('/verse/adjacent', async (request, reply) => {
  const { verse_id, direction, language, book_id, chapter_number, verse_number } = request.query;
  if (!verse_id || !direction) { reply.code(400); return { error: 'missing parameters' }; }
  const targetDb = resolveDbAdapter(language);
  const result = getAdjacentVerse({ verse_id: Number(verse_id), book_id: book_id ? Number(book_id) : undefined, chapter_number: chapter_number ? Number(chapter_number) : undefined, verse_number: verse_number ? Number(verse_number) : undefined, direction }, targetDb, fastify.log);
  if (!result) { reply.code(404); return { error: 'not found' }; }
  return { ...result, version_citation: getVersionCitation(language || 'en', result.volume_id) };
});

fastify.get('/verse/:verse_id/related', async (request, reply) => {
  const verseId = parseInt(request.params.verse_id, 10);
  if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; }
  const language = (request.query.language || 'en').toLowerCase();
  const page = Math.max(0, parseInt(request.query.page ?? 0, 10) || 0);
  const pageSize = Math.min(20, Math.max(1, parseInt(request.query.pageSize ?? 10, 10) || 10));
  const offset = page * pageSize;
  const targetDb = resolveDbAdapter(language);
  const meta = verseMetaCache.get(verseId);
  if (!meta) { reply.code(404); return { error: 'Verse not found' }; }
  const liveTopics = topicalGuideReady ? (verseTopicCache.get(verseId) ?? new Set()) : new Set();
  const liveChapter = meta.chapter_id;
  const stmtMeta = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, volume_id FROM scriptures WHERE verse_id = ?`);
  const stmtCoords = language !== 'en' ? dba.prepare('SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1') : null;
  const stmtTransText = language !== 'en' ? targetDb.prepare(`SELECT scripture_text FROM scriptures WHERE book_id = ? AND chapter_number = ? AND verse_number = ? LIMIT 1`) : null;
  const resolveRow = (verse_id) => { const row = stmtMeta.get(verse_id); if (!row) return null; if (stmtCoords && stmtTransText) { const coords = stmtCoords.get(verse_id); if (coords) { const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number); if (t?.scripture_text) row.scripture_text = t.scripture_text; } } return row; };
  const tgScores = new Map();
  if (liveTopics.size > 0) { for (const slug of liveTopics) { const peers = topicVerseIndex.get(slug); if (!peers) continue; for (const vid of peers) { if (vid === verseId) continue; const vmeta = verseMetaCache.get(vid); if (vmeta && vmeta.chapter_id === liveChapter) continue; tgScores.set(vid, (tgScores.get(vid) ?? 0) + 1); } } }
  let knnAvailable = false;
  try { if (db_graph) { const knnRow = db_graph.prepare('SELECT COUNT(*) AS n FROM verse_knn WHERE verse_id = ?').get(verseId); knnAvailable = knnRow && knnRow.n > 0; } } catch {}
  if (knnAvailable) {
    const knnRows = db_graph.prepare('SELECT neighbor_id, similarity FROM verse_knn WHERE verse_id = ? ORDER BY rank').all(verseId);
    let rwrMap = new Map();
    if (rwrStmt) { try { const rwrRows = rwrStmt.all(verseId); for (const r of rwrRows) rwrMap.set(r.neighbor_id, r.rwr_score); } catch {} }
    const allCandidates = new Map();
    for (const r of knnRows) { const overlap = tgScores.get(r.neighbor_id) ?? 0; const pr = pageRankCache.get(r.neighbor_id) ?? 0; const cTopics = verseTopicCache.get(r.neighbor_id) ?? new Set(); const jaccard = jaccardSimilarity(liveTopics, cTopics); const rwrScore = rwrMap.get(r.neighbor_id) ?? 0; let pprBoost = 0; if (pprStmt && liveTopics.size > 0) { for (const slug of [...liveTopics].slice(0, 5)) { try { const row = db_tg.prepare('SELECT ppr FROM topic_ppr WHERE topic_slug = ? AND verse_id = ?').get(slug, r.neighbor_id); if (row && row.ppr > pprBoost) pprBoost = row.ppr; } catch {} } } const score = r.similarity * 1.0 + rwrScore * 2.0 + overlap * 0.15 + jaccard * 0.5 + pprBoost * 0.5 + pr * 2000; allCandidates.set(r.neighbor_id, { verse_id: r.neighbor_id, embSim: r.similarity, score, overlap }); }
    for (const [nid, rwrScore] of rwrMap) { if (allCandidates.has(nid)) continue; const overlap = tgScores.get(nid) ?? 0; const pr = pageRankCache.get(nid) ?? 0; const cTopics = verseTopicCache.get(nid) ?? new Set(); const jaccard = jaccardSimilarity(liveTopics, cTopics); const score = rwrScore * 3.0 + overlap * 0.15 + jaccard * 0.5 + pr * 2000; allCandidates.set(nid, { verse_id: nid, embSim: 0, score, overlap }); }
    const enhanced = [...allCandidates.values()].filter(r => { const m = verseMetaCache.get(r.verse_id); return !m || m.chapter_id !== liveChapter; });
    enhanced.sort((a, b) => b.score - a.score);
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
          const clusterMembers = db_graph.prepare(`SELECT vc.verse_id, vc.centroid_distance FROM verse_clusters vc WHERE vc.cluster_id = ? AND vc.verse_id != ? ORDER BY vc.centroid_distance ASC LIMIT 60`).all(clusterRow.cluster_id, verseId);
          const clusterNeighbors = [];
          for (const m of clusterMembers) { if (existingIds.has(m.verse_id)) continue; const row = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`).get(m.verse_id); if (!row) continue; const sameBook = row.book_id === verseBook; const clusterScore = (1 - m.centroid_distance) * (sameBook ? 0.4 : 1.0); clusterNeighbors.push({ verse_id: m.verse_id, embSim: 0, score: clusterScore * 0.7, overlap: 0 }); existingIds.add(m.verse_id); if (clusterNeighbors.length >= 12) break; }
          if (clusterNeighbors.length > 0) { enhanced.push(...clusterNeighbors); enhanced.sort((a, b) => b.score - a.score); }
        }
      } catch {}
    }
    if (item2vecReady && item2vecVectors.size > 0 && item2vecVectors.size <= 10000) {
      const iv = item2vecVectors.get(verseId);
      if (iv) {
        const existingIds = new Set(enhanced.map(r => r.verse_id));
        existingIds.add(verseId);
        const i2vScored = [];
        for (const [vid, vec] of item2vecVectors) { if (existingIds.has(vid)) continue; const sim = item2vecSimilarity(iv, vec); if (sim > 0.3) i2vScored.push({ vid, sim }); }
        i2vScored.sort((a, b) => b.sim - a.sim);
        for (const { vid, sim } of i2vScored.slice(0, 8)) { try { const row = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`).get(vid); if (row) enhanced.push({ verse_id: vid, embSim: sim * 0.5, score: sim * 0.5, overlap: 0, source: 'item2vec', ...row }); } catch {} }
        if (i2vScored.length > 0) enhanced.sort((a, b) => b.score - a.score);
      }
    }
    const diverseResults = enhanced.slice(0, offset + pageSize);
    const paged = diverseResults.slice(offset, offset + pageSize);
    const results = paged.map(({ verse_id, embSim }) => { const row = resolveRow(verse_id); const cTopics = verseTopicCache.get(verse_id); const sharedSlug = cTopics ? ([...liveTopics].find(s => cTopics.has(s)) ?? null) : null; const matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? sharedSlug) : null; return { ...row, similarity_score: +(embSim ?? 0).toFixed(4), matched_concept: matchedConcept }; });
    const matchedConcept = liveTopics.size ? (topicNameMap.get([...liveTopics][0]) ?? null) : null;
    return { results, total: enhanced.length, matchedConcept, page, pageSize, cluster_id: clusterLabel };
  }
  if (embeddingsReady) {
    const liveVec = embeddingCache.get(verseId);
    if (!liveVec) { reply.code(404); return { error: 'Embedding not found' }; }
    const candidates = [];
    for (const [cid, cvec] of embeddingCache) { const cmeta = verseMetaCache.get(cid); if (cmeta && cmeta.chapter_id === liveChapter) continue; const embSim = cosineSimilarity(liveVec, cvec); if (embSim < 0.15) continue; const overlap = tgScores.get(cid) ?? 0; const cTopics = verseTopicCache.get(cid) ?? new Set(); const jaccard = jaccardSimilarity(liveTopics, cTopics); const bayesScore = bayesianRelevance(embSim, jaccard, overlap); candidates.push({ verse_id: cid, score: bayesScore, embSim, overlap }); }
    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, 200);
    const mmrResults = [];
    const selectedVecs = [];
    for (let pick = 0; pick < offset + pageSize && topCandidates.length > 0; pick++) {
      let bestIdx = -1;
      let bestMmr = -Infinity;
      const LAMBDA = 0.65;
      for (let i = 0; i < topCandidates.length; i++) {
        const c = topCandidates[i];
        const cVec = embeddingCache.get(c.verse_id);
        let maxSimToSelected = 0;
        if (cVec && selectedVecs.length > 0) { for (const sv of selectedVecs) { const sim = cosineSimilarity(cVec, sv); if (sim > maxSimToSelected) maxSimToSelected = sim; } }
        const mmr = LAMBDA * (c.score / (candidates[0]?.score || 1)) - (1 - LAMBDA) * maxSimToSelected;
        if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
      }
      if (bestIdx >= 0) { const chosen = topCandidates.splice(bestIdx, 1)[0]; const cVec = embeddingCache.get(chosen.verse_id); if (cVec) selectedVecs.push(cVec); mmrResults.push(chosen); } else break;
    }
    const paged = mmrResults.slice(offset, offset + pageSize);
    const results = paged.map(({ verse_id, score, embSim }) => { const row = resolveRow(verse_id); const cTopics = verseTopicCache.get(verse_id); const sharedSlug = cTopics ? ([...liveTopics].find(s => cTopics.has(s)) ?? null) : null; const matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? sharedSlug) : null; return { ...row, similarity_score: +embSim.toFixed(4), matched_concept: matchedConcept }; });
    const matchedConcept = liveTopics.size ? (topicNameMap.get([...liveTopics][0]) ?? null) : null;
    return { results, total: candidates.length, matchedConcept, page, pageSize };
  }
  if (tgScores.size > 0) {
    const allSorted = [...tgScores.entries()].sort((a, b) => b[1] - a[1]);
    const paged = allSorted.slice(offset, offset + pageSize);
    const results = paged.map(([vid, overlap]) => { const row = resolveRow(vid); const cTopics = verseTopicCache.get(vid); const sharedSlug = cTopics ? ([...liveTopics].find(s => cTopics.has(s)) ?? null) : null; const matchedConcept = sharedSlug ? (topicNameMap.get(sharedSlug) ?? null) : null; return { ...row, similarity_score: +(overlap / liveTopics.size).toFixed(4), matched_concept: matchedConcept }; });
    const matchedConcept = liveTopics.size ? (topicNameMap.get([...liveTopics][0]) ?? null) : null;
    return { results, total: allSorted.length, matchedConcept, page, pageSize, fallback: true };
  }
  const phrase = meta.scripture_text.split(/\s+/).slice(0, 8).join(' ');
  const { results: ftsResults, total: ftsTotal } = phraseSearch(phrase, page, pageSize, dba, fastify.log);
  const filtered = ftsResults.filter(r => r.verse_id !== verseId);
  if (stmtCoords && stmtTransText) { for (const r of filtered) { const coords = stmtCoords.get(r.verse_id); if (coords) { const t = stmtTransText.get(coords.book_id, coords.chapter_number, coords.verse_number); if (t?.scripture_text) r.scripture_text = t.scripture_text; } } }
  return { results: filtered, total: ftsTotal ?? filtered.length, page, pageSize, fallback: true };
});

fastify.get('/verse/:verse_id/translation', async (request, reply) => {
  const { verse_id } = request.params;
  const { language } = request.query;
  if (!language || !['en', 'tl', 'ceb', 'es', 'el', 'ilo', 'ja', 'ylt', 'war'].includes(language.toLowerCase())) { reply.code(400); return { error: 'language must be en, tl, ceb, es, el, ilo, ja, ylt or war' }; }
  const targetDb = language.toLowerCase() === 'en' ? dba : resolveDbAdapter(language);
  try {
    const coords = dba.prepare('SELECT book_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ? LIMIT 1').get(Number(verse_id));
    if (!coords) { reply.code(404); return { error: 'verse not found' }; }
    const row = fetchVerseByCoords(targetDb, coords, 'scripture_text');
    if (!row) { reply.code(404); return { error: 'verse not found in translation' }; }
    return { verse_id: Number(verse_id), language: language.toLowerCase(), scripture_text: row.scripture_text };
  } catch (err) { fastify.log.error('translation fetch failed', err); reply.code(500); return { error: 'fetch failed' }; }
});

fastify.get('/verse/of-the-day', async (request, reply) => {
  try { const result = getVerseOfTheDay(dba); if (!result) { reply.code(404); return { error: 'not found' }; } return result; } catch (err) { fastify.log.error('verse-of-the-day failed', err); reply.code(500); return { error: 'internal error' }; }
});

fastify.get('/for-you', async (request, reply) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(request.query.limit || '12', 10)));
    const language = (request.query.language || 'en').toLowerCase();
    const stmtVerse = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id, volume_id FROM scriptures WHERE verse_id = ?`);
    const readRows = db_user.prepare(`SELECT DISTINCT verse_id FROM reading_events WHERE event_type = 'read' ORDER BY ts DESC LIMIT 200`).all();
    const readSet = new Set(readRows.map(r => r.verse_id));
    const scored = new Map();
    if (db_graph && readSet.size > 0) {
      const clusterFreq = new Map();
      for (const vid of [...readSet].slice(0, 100)) { try { const cr = db_graph.prepare('SELECT cluster_id FROM verse_clusters WHERE verse_id = ?').get(vid); if (cr) clusterFreq.set(cr.cluster_id, (clusterFreq.get(cr.cluster_id) || 0) + 1); } catch {} }
      const topClusters = [...clusterFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [clusterId, freq] of topClusters) { const weight = freq / Math.max(...topClusters.map(c => c[1])); try { const members = db_graph.prepare(`SELECT verse_id, centroid_distance FROM verse_clusters WHERE cluster_id = ? ORDER BY centroid_distance ASC LIMIT 30`).all(clusterId); for (const m of members) { if (readSet.has(m.verse_id)) continue; const s = weight * (1 - m.centroid_distance); scored.set(m.verse_id, (scored.get(m.verse_id) || 0) + s * 0.6); } } catch {} } }
    if (db_tg && readSet.size > 0) {
      const recentVerses = [...readSet].slice(0, 30);
      const topicSlugs = new Set();
      for (const vid of recentVerses) { try { const vt = db_tg.prepare('SELECT topic_slugs FROM verse_topics WHERE verse_id = ?').get(vid); if (vt && vt.topic_slugs) { JSON.parse(vt.topic_slugs || '[]').slice(0, 3).forEach(s => topicSlugs.add(s)); } } catch {} }
      for (const slug of [...topicSlugs].slice(0, 8)) { try { const pprRows = db_tg.prepare(`SELECT verse_id, ppr FROM topic_ppr WHERE topic_slug = ? ORDER BY ppr DESC LIMIT 50`).all(slug); for (const r of pprRows) { if (readSet.has(r.verse_id)) continue; scored.set(r.verse_id, (scored.get(r.verse_id) || 0) + r.ppr * 0.4); } } catch {} } }
    if (scored.size < limit) {
      const pr = [...pageRankCache.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).filter(([vid]) => !readSet.has(vid));
      for (const [vid, pr_score] of pr.slice(0, limit * 3)) { if (!scored.has(vid)) scored.set(vid, pr_score * 0.2); }
    }
    const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]);
    const results = [];
    const seenBooks = new Set();
    for (const [vid, score] of ranked) { if (results.length >= limit) break; try { const row = stmtVerse.get(vid); if (!row) continue; const bookCount = [...seenBooks].filter(b => b === row.book_id).length; if (bookCount >= 2) continue; seenBooks.add(row.book_id); results.push({ ...row, _for_you_score: +score.toFixed(4), _reason: 'for-you' }); } catch {} }
    const withReasons = results.map(r => { const { _for_you_score, ...clean } = r; return { ...clean, discovery_score: _for_you_score }; });
    return { verses: withReasons, total: withReasons.length, personalised: readSet.size > 0 };
  } catch (err) { fastify.log.warn({ err }, '/for-you failed'); return { verses: [], total: 0, personalised: false }; }
});

fastify.get('/trending', async (request, reply) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(request.query.limit || '10', 10)));
    const now = Date.now();
    const h24 = now - 86400000;
    const d7 = now - 7 * 86400000;
    const readRows = db_user.prepare(`SELECT verse_id, SUM(CASE WHEN ts >= ? THEN 3 ELSE 0 END) + SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS hot_score, MAX(ts) AS last_seen FROM reading_events WHERE ts >= ? AND event_type IN ('read', 'highlight', 'bookmark') GROUP BY verse_id HAVING hot_score > 0`).all(h24, d7, d7);
    const clickRows = db_user.prepare(`SELECT verse_id, SUM(CASE WHEN ts >= ? THEN 2 ELSE 1 END) AS click_score FROM search_feedback WHERE ts >= ? GROUP BY verse_id`).all(h24, d7);
    const scores = new Map();
    for (const r of readRows) scores.set(r.verse_id, (scores.get(r.verse_id) || 0) + r.hot_score);
    for (const r of clickRows) scores.set(r.verse_id, (scores.get(r.verse_id) || 0) + r.click_score);
    if (scores.size < limit) { const prTop = [...pageRankCache.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 2); for (const [vid, pr] of prTop) { if (!scores.has(vid)) scores.set(vid, pr * 5); } }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 3);
    const results = [];
    const seenBooks = new Set();
    for (const [vid, score] of ranked) { if (results.length >= limit) break; try { const row = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id FROM scriptures WHERE verse_id = ?`).get(vid); if (!row) continue; if (seenBooks.has(row.book_id) && seenBooks.size < 5) { seenBooks.add(row.book_id); } results.push({ ...row, trending_score: +score.toFixed(2) }); seenBooks.add(row.book_id); } catch {} }
    return { verses: results, total: results.length };
  } catch (err) { fastify.log.warn({ err }, '/trending failed'); return { verses: [], total: 0 }; }
});

fastify.get('/personalized-votd', async (request, reply) => {
  try {
    const language = (request.query.language || 'en').toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const recentCount = db_user.prepare(`SELECT COUNT(DISTINCT verse_id) AS n FROM reading_events WHERE ts > ?`).get(Date.now() - 30 * 86400000).n;
    if (recentCount >= 5 && db_graph) {
      const clusterFreq = new Map();
      const readRows = db_user.prepare(`SELECT verse_id FROM reading_events WHERE event_type = 'read' ORDER BY ts DESC LIMIT 50`).all();
      const readSet = new Set(readRows.map(r => r.verse_id));
      for (const { verse_id } of readRows.slice(0, 30)) { try { const cr = db_graph.prepare('SELECT cluster_id FROM verse_clusters WHERE verse_id = ?').get(verse_id); if (cr) clusterFreq.set(cr.cluster_id, (clusterFreq.get(cr.cluster_id) || 0) + 1); } catch {} }
      if (clusterFreq.size > 0) {
        const topCluster = [...clusterFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const members = db_graph.prepare(`SELECT verse_id FROM verse_clusters WHERE cluster_id = ? AND verse_id NOT IN (SELECT verse_id FROM reading_events WHERE ts > ?) ORDER BY centroid_distance ASC LIMIT 50`).all(topCluster, Date.now() - 86400000);
        if (members.length > 0) {
          const dateSeed = parseInt(today.replace(/-/g, ''), 10);
          const pick = members[dateSeed % members.length];
          const row = dba.prepare(`SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, book_id FROM scriptures WHERE verse_id = ?`).get(pick.verse_id);
          if (row) return { verse: row, personalised: true, date: today };
        }
      }
    }
    const fallback = getVerseOfTheDay(dba);
    return { verse: fallback, personalised: false, date: today };
  } catch (err) { fastify.log.warn({ err }, '/personalized-votd failed'); try { return { verse: getVerseOfTheDay(dba), personalised: false, date: new Date().toISOString().slice(0, 10) }; } catch { return { verse: null }; } }
});

function registerSocketHandlers(io, { segmentVerseText, db, db_cebuano, db_tagalog, db_spanish, db_greek, db_ilocano, db_japanese, db_ylt, db_waray }) {
  const DEFAULT_SESSION_ID = 'GLOBAL';
  const SESSION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const SESSION_CODE_LENGTH = 6;
  const SESSION_GRACE_MS = Number(process.env.SESSION_GRACE_MS || SERVICE_CONFIG.SESSION_GRACE_MS);
  const SESSION_NO_VIEWER_GRACE_MS = Number(process.env.SESSION_NO_VIEWER_GRACE_MS || SERVICE_CONFIG.SESSION_NO_VIEWER_GRACE_MS);
  const PRESENTER_LEFT_DEBOUNCE_MS = Number(process.env.PRESENTER_LEFT_DEBOUNCE_MS || SERVICE_CONFIG.PRESENTER_LEFT_DEBOUNCE_MS);
  const sessionState = new Map();
  const cleanupTimers = new Map();
  const sessionViewerCounts = new Map();
  function normalizeSessionId(value) { if (!value) return ''; return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24); }
  function getSessionState(sessionId) { if (!sessionState.has(sessionId)) sessionState.set(sessionId, { theme: null, liveVerse: null, highlightedText: '', presenterSocketId: null, label: '', presenterToken: null, presenterLastActivityAt: null, presenterDisconnectedAt: null, lockedOutTokens: new Set(), mainClientToken: null, mainClientSocketId: null, pinHash: null, updatedAt: Date.now(), liveHistory: [], hadViewer: false, _presenterLeftTimer: null }); return sessionState.get(sessionId); }
  const IS_ELECTRON = !!process.versions?.electron;
  if (IS_ELECTRON) { getSessionState('LOCAL'); fastify.log.info('Electron mode: LOCAL session pre-seeded'); }
  function generateSessionId() { if (sessionState.size >= SERVICE_CONFIG.MAX_SESSIONS) { fastify.log.warn(`MAX_SESSIONS (${SERVICE_CONFIG.MAX_SESSIONS}) reached — refusing new session`); return null; } for (let i = 0; i < 16; i += 1) { let generated = ''; for (let j = 0; j < SESSION_CODE_LENGTH; j += 1) { const idx = Math.floor(Math.random() * SESSION_CODE_CHARS.length); generated += SESSION_CODE_CHARS[idx]; } if (!sessionState.has(generated) && generated !== DEFAULT_SESSION_ID) return generated; } return `${SESSION_CODE_CHARS[Math.floor(Math.random() * SESSION_CODE_CHARS.length)]}${Date.now().toString(36).toUpperCase().slice(-5)}`; }
  function generateToken() { return require('crypto').randomBytes(16).toString('hex'); }
  function incrementViewerCount(sessionId) { const n = (sessionViewerCounts.get(sessionId) || 0) + 1; sessionViewerCounts.set(sessionId, n); broadcastViewerCount(sessionId, n); }
  function decrementViewerCount(sessionId) { const n = Math.max(0, (sessionViewerCounts.get(sessionId) || 1) - 1); sessionViewerCounts.set(sessionId, n); broadcastViewerCount(sessionId, n); }
  function broadcastViewerCount(sessionId, count) { if (!sessionId || sessionId === DEFAULT_SESSION_ID) return; io.to(sessionId).emit('viewer-count', { sessionId, count }); }
  function emitToSession(sessionId, event, payload) { io.to(sessionId).emit(event, payload); }
  function getRoomSize(sessionId) { const rooms = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms; if (!rooms || typeof rooms.get !== 'function') return null; const room = rooms.get(sessionId); return room ? room.size : 0; }
  function cancelCleanup(sessionId) { const normalized = normalizeSessionId(sessionId); if (!normalized) return; const timer = cleanupTimers.get(normalized); if (timer) { clearTimeout(timer); cleanupTimers.delete(normalized); } }
  function cleanupSessionIfUnused(sessionId) { const normalized = normalizeSessionId(sessionId); if (!normalized || normalized === DEFAULT_SESSION_ID) return; const roomSize = getRoomSize(normalized); if (roomSize !== 0) return; const state = sessionState.get(normalized); if (state && state.presenterLastActivityAt && (Date.now() - state.presenterLastActivityAt < 60000)) { scheduleCleanup(normalized); return; } cancelCleanup(normalized); if (sessionState.has(normalized)) { sessionState.delete(normalized); fastify.log.info(`Session ${normalized} terminated (no active sockets)`); } }
  function scheduleCleanup(sessionId, { disconnecting = false } = {}) { const normalized = normalizeSessionId(sessionId); if (!normalized || normalized === DEFAULT_SESSION_ID) return; const roomSize = getRoomSize(normalized); if (roomSize === null || (!disconnecting && roomSize > 0) || (disconnecting && roomSize > 1)) { cancelCleanup(normalized); return; } cancelCleanup(normalized); const state = sessionState.get(normalized); const graceMs = (state && state.hadViewer) ? SESSION_GRACE_MS : SESSION_NO_VIEWER_GRACE_MS; const timer = setTimeout(() => { cleanupSessionIfUnused(normalized); }, graceMs); cleanupTimers.set(normalized, timer); }
  function sessionExists(sessionId) { const normalized = normalizeSessionId(sessionId); if (!normalized) return false; if (sessionState.has(normalized)) return true; const roomSize = getRoomSize(normalized); return typeof roomSize === 'number' && roomSize > 0; }
  function releasePresenterLock(sessionId, socketId, voluntary = false) { const normalized = normalizeSessionId(sessionId); if (!normalized || normalized === DEFAULT_SESSION_ID) return; const state = sessionState.get(normalized); if (state && state.presenterSocketId === socketId) { state.presenterSocketId = null; if (voluntary) { state.presenterToken = null; state.presenterLastActivityAt = null; state.presenterDisconnectedAt = null; state.lockedOutTokens = new Set(); } state.updatedAt = Date.now(); } }
  function hasConnectedSocket(socketId) { if (!socketId) return false; const socketMap = io && io.sockets && io.sockets.sockets; if (!socketMap) return false; if (typeof socketMap.has === 'function') return socketMap.has(socketId); if (typeof socketMap.get === 'function') return Boolean(socketMap.get(socketId)); return false; }
  function clearStalePresenterLock(state) { if (!state || !state.presenterSocketId) return; if (!hasConnectedSocket(state.presenterSocketId)) { state.presenterSocketId = null; state.updatedAt = Date.now(); } }
  function ensurePresenterAccess(sessionId, socket) { const state = getSessionState(sessionId); clearStalePresenterLock(state); if (state.presenterSocketId === socket.id) state.presenterLastActivityAt = Date.now(); if (!state.presenterSocketId || state.presenterSocketId !== socket.id) { socket.emit('session-error', { message: 'Presenter access required — join as presenter first' }); return false; } return true; }
  const _idleSweep = setInterval(() => { for (const [sessionId] of sessionState) { if (sessionId === DEFAULT_SESSION_ID) continue; const roomSize = getRoomSize(sessionId); if (roomSize !== null && roomSize === 0 && !cleanupTimers.has(sessionId)) { sessionState.delete(sessionId); fastify.log.info(`[idle-sweep] Removed ghost session ${sessionId}`); } } }, 5 * 60 * 1000);
  io.engine.on('connection_error', (err) => { fastify.log.warn({ err: err.message, code: err.code }, '[Socket.IO] connection error'); });
  io.on('connection', (socket) => {
    fastify.log.info('a user connected');
    socket.on('error', (err) => { fastify.log.warn({ err: err.message, socketId: socket.id }, '[Socket.IO] socket error'); });
    let activeSessionId = DEFAULT_SESSION_ID;
    let activeRole = 'viewer';
    socket.join(activeSessionId);
    getSessionState(activeSessionId);
    const _socketRateBuckets = {};
    function socketRateLimit(event, maxPerMin) { const now = Date.now(); const bucket = _socketRateBuckets[event] || (_socketRateBuckets[event] = { count: 0, resetAt: now + 60000 }); if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 60000; } if (++bucket.count > maxPerMin) { fastify.log.warn({ socketId: socket.id, event }, '[rate-limit] Socket event throttled'); return false; } return true; }
    const joinSession = (candidateSessionId, role = 'viewer', pin = '', presenterToken = '') => { const normalized = normalizeSessionId(candidateSessionId); if (!normalized) return null; const previousSessionId = activeSessionId; if (role === 'presenter') { const state = getSessionState(normalized); clearStalePresenterLock(state); const incomingToken = String(presenterToken || '').trim(); if (incomingToken && state.lockedOutTokens.has(incomingToken)) return { error: 'presenter-locked-out' }; if (state.pinHash) { const provided = String(pin || '').trim(); if (!provided) return { requiresPin: true }; if (hashPin(provided) !== state.pinHash) return { pinIncorrect: true }; } if (incomingToken && state.presenterToken === incomingToken) state.presenterDisconnectedAt = null; else if (!state.presenterToken) state.presenterToken = incomingToken || generateToken(); else { if (hasConnectedSocket(state.presenterSocketId)) { io.to(state.presenterSocketId).emit('presenter-takeover-attempt', { message: 'Another device attempted to join your session as presenter' }); return { error: 'Another presenter is active in this session' }; } else { const disconnectedAt = state.presenterDisconnectedAt; const graceElapsed = disconnectedAt && (Date.now() - disconnectedAt > SESSION_GRACE_MS); if (graceElapsed) { state.presenterToken = incomingToken || generateToken(); state.presenterDisconnectedAt = null; state.lockedOutTokens = new Set(); fastify.log.info(`Session ${normalized}: presenter slot released after grace period`); } else return { error: 'presenter-session-in-progress' }; } } } if (activeSessionId && activeSessionId !== normalized) { socket.leave(activeSessionId); if (activeRole === 'presenter') releasePresenterLock(previousSessionId, socket.id, true); else decrementViewerCount(previousSessionId); scheduleCleanup(previousSessionId); } activeSessionId = normalized; activeRole = role; socket.join(activeSessionId); cancelCleanup(activeSessionId); const state = getSessionState(activeSessionId); if (role === 'presenter') { if (state._presenterLeftTimer) { clearTimeout(state._presenterLeftTimer); state._presenterLeftTimer = null; } state.presenterSocketId = socket.id; } else { state.hadViewer = true; incrementViewerCount(activeSessionId); } socket.emit('session-joined', { sessionId: activeSessionId, pinSet: !!state.pinHash, label: state.label || '' }); if (state.theme) socket.emit('update-theme', state.theme); if (state.liveVerse) socket.emit('update-verse', state.liveVerse); if (state.customMode) socket.emit('custom-text', { ...state.customMode, theme: state.theme }); if (state.highlightedText) socket.emit('highlight-text', state.highlightedText); socket.emit('viewer-count', { sessionId: activeSessionId, count: sessionViewerCounts.get(activeSessionId) || 0 }); if (role === 'presenter') socket.to(activeSessionId).emit('presenter-joined', { sessionId: activeSessionId, verse: state.liveVerse || null, theme: state.theme || null }); else if (state.presenterSocketId && io.sockets.sockets.get(state.presenterSocketId)) socket.emit('presenter-joined', { sessionId: activeSessionId, verse: state.liveVerse || null, theme: state.theme || null }); return { sessionId: activeSessionId, pinSet: !!state.pinHash, presenterToken: state.presenterToken, label: state.label || '' }; };
    const leaveActiveSession = () => { if (!activeSessionId || activeSessionId === DEFAULT_SESSION_ID) return { sessionId: DEFAULT_SESSION_ID }; const previousSessionId = activeSessionId; if (activeRole === 'presenter') { socket.to(previousSessionId).emit('presenter-left', { sessionId: previousSessionId, voluntary: true }); releasePresenterLock(previousSessionId, socket.id, true); } else decrementViewerCount(previousSessionId); socket.leave(previousSessionId); activeSessionId = DEFAULT_SESSION_ID; activeRole = 'viewer'; socket.join(DEFAULT_SESSION_ID); scheduleCleanup(previousSessionId); socket.emit('session-left', { sessionId: previousSessionId }); return { sessionId: previousSessionId }; };
    socket.on('create-session', (payload, callback) => { const sessionId = generateSessionId(); if (!sessionId) { const error = { message: 'Server session limit reached — please try again later' }; socket.emit('session-error', error); if (typeof callback === 'function') callback({ ok: false, ...error }); return; } const presenterToken = generateToken(); const joined = joinSession(sessionId, 'presenter', '', presenterToken); if (joined && joined.error) { const error = { message: joined.error }; socket.emit('session-error', error); if (typeof callback === 'function') callback({ ok: false, ...error }); return; } const label = String((payload && payload.label) || '').trim().slice(0, 40); if (label) getSessionState(joined.sessionId).label = label; socket.emit('session-created', { sessionId: joined.sessionId, presenterToken: joined.presenterToken, label }); if (typeof callback === 'function') callback({ ok: true, sessionId: joined.sessionId, presenterToken: joined.presenterToken, label }); });
    socket.on('create-client-session', (payload, callback) => { const preferred = normalizeSessionId(payload && payload.preferredSessionId); const incomingToken = payload && payload.mainClientToken ? String(payload.mainClientToken).trim() : ''; let sessionId; let isMainClient = false; if (preferred && sessionExists(preferred)) { sessionId = preferred; const state = getSessionState(sessionId); if (!state.mainClientToken) isMainClient = true; else if (incomingToken && incomingToken === state.mainClientToken) isMainClient = true; else isMainClient = false; } else { sessionId = generateSessionId(); if (!sessionId) { const error = { message: 'Server session limit reached' }; socket.emit('session-error', error); if (typeof callback === 'function') callback({ ok: false, ...error }); return; } isMainClient = true; } if (activeSessionId && activeSessionId !== DEFAULT_SESSION_ID && activeSessionId !== sessionId) { socket.leave(activeSessionId); decrementViewerCount(activeSessionId); scheduleCleanup(activeSessionId); } activeSessionId = sessionId; activeRole = 'viewer'; socket.join(sessionId); cancelCleanup(sessionId); const state = getSessionState(sessionId); state.hadViewer = true; incrementViewerCount(sessionId); let mainClientToken = state.mainClientToken || null; if (isMainClient) { if (!state.mainClientToken) { mainClientToken = generateToken(); state.mainClientToken = mainClientToken; } state.mainClientSocketId = socket.id; } socket.emit('client-session-created', { sessionId, mainClientToken: isMainClient ? mainClientToken : undefined, isMainClient }); if (typeof callback === 'function') callback({ ok: true, sessionId, mainClientToken: isMainClient ? mainClientToken : undefined, isMainClient }); });
    socket.on('join-session', (payload, callback) => { const requested = normalizeSessionId(payload && payload.sessionId); const role = payload && payload.role === 'presenter' ? 'presenter' : 'viewer'; const pin = payload && payload.pin ? String(payload.pin).trim() : ''; const presenterToken = payload && payload.presenterToken ? String(payload.presenterToken).trim() : ''; if (!sessionExists(requested)) { const error = { message: 'Session not found' }; socket.emit('session-error', error); if (typeof callback === 'function') callback({ ok: false, ...error }); return; } const joined = joinSession(requested, role, pin, presenterToken); if (joined && joined.requiresPin) { if (typeof callback === 'function') callback({ ok: false, requiresPin: true }); return; } if (joined && joined.pinIncorrect) { if (typeof callback === 'function') callback({ ok: false, pinIncorrect: true, message: 'Incorrect PIN — try again' }); return; } if (!joined || joined.error) { const errCode = joined && joined.error; const message = errCode === 'presenter-locked-out' ? 'This session already has an active presenter. You can join once they end the service.' : (errCode || 'Valid session code is required'); socket.emit('session-error', { message }); if (typeof callback === 'function') callback({ ok: false, error: errCode, message }); return; } if (!joined.sessionId) { const error = { message: 'Valid session code is required' }; socket.emit('session-error', error); if (typeof callback === 'function') callback({ ok: false, ...error }); return; } if (role === 'presenter' && payload && payload.label) { const state = getSessionState(joined.sessionId); if (!state.label) state.label = String(payload.label).trim().slice(0, 40); joined.label = state.label; } if (typeof callback === 'function') callback({ ok: true, sessionId: joined.sessionId, pinSet: joined.pinSet, presenterToken: joined.presenterToken || null, label: joined.label || '' }); });
    socket.on('leave-session', (payload, callback) => { const left = leaveActiveSession(); if (typeof callback === 'function') callback({ ok: true, sessionId: left.sessionId }); });
    socket.on('set-session-pin', (payload, callback) => { if (!ensurePresenterAccess(activeSessionId, socket)) { if (typeof callback === 'function') callback({ ok: false, message: 'Not authorized' }); return; } const pin = payload && payload.pin ? String(payload.pin).trim() : ''; if (!/^\d{4,8}$/.test(pin)) { if (typeof callback === 'function') callback({ ok: false, message: 'PIN must be 4–8 digits' }); return; } const state = getSessionState(activeSessionId); state.pinHash = hashPin(pin); if (typeof callback === 'function') callback({ ok: true }); });
    socket.on('clear-session-pin', (_payload, callback) => { if (!ensurePresenterAccess(activeSessionId, socket)) { if (typeof callback === 'function') callback({ ok: false, message: 'Not authorized' }); return; } const state = getSessionState(activeSessionId); state.pinHash = null; if (typeof callback === 'function') callback({ ok: true }); });
    socket.on('search', async (payload) => { try { if (!socketRateLimit('search', 120)) { socket.emit('search-results', { results: [], total: 0, nextCursor: null, error: 'rate-limited' }); return; } const query = typeof payload === 'string' ? payload : payload?.query; const pageSize = Math.min(50, Math.max(1, Number(payload?.pageSize) || 10)); const language = payload?.language ? String(payload.language).toLowerCase().trim() : 'en'; const contextVerseId = Number(payload?.contextVerseId) || null; const cursorStr = payload?.cursor || null; if (!query || !String(query).trim()) { socket.emit('search-results', { results: [], total: 0, nextCursor: null }); return; } const queryStr = String(query).trim(); if (queryStr.length > 500) { socket.emit('search-results', { results: [], total: 0, nextCursor: null, error: 'query-too-long' }); return; } fastify.log.info(`search: "${queryStr}" pageSize=${pageSize} lang=${language} cursor=${cursorStr ? 'yes' : 'no'}`); let offset = 0; let pipelineResults, total, cacheKey, pipelineMeta; if (cursorStr) { const decoded = decodeCursor(cursorStr); if (decoded) { const cached = searchCacheGet(decoded.k); if (cached) { offset = decoded.o; pipelineResults = cached.results; total = cached.total; pipelineMeta = cached.meta; cacheKey = decoded.k; } } if (!pipelineResults) { const fresh = await runSearchPipeline(query, language, contextVerseId, fastify.log, activeSessionId); pipelineResults = fresh.results; total = fresh.total; pipelineMeta = fresh.meta; cacheKey = fresh.cacheKey; offset = 0; } } else { const fresh = await runSearchPipeline(query, language, contextVerseId, fastify.log, activeSessionId); pipelineResults = fresh.results; total = fresh.total; pipelineMeta = fresh.meta; cacheKey = fresh.cacheKey; offset = 0; } const pageResults = pipelineResults.slice(offset, offset + pageSize); const nextOffset = offset + pageResults.length; const hasMore = nextOffset < total; const nextCursor = hasMore ? encodeCursor(cacheKey, nextOffset, total) : null; socket.emit('search-results', { results: pageResults, total, nextCursor, meta: pipelineMeta, page: Math.floor(offset / pageSize), pageSize, query, language }); } catch (err) { fastify.log.error({ err }, 'search handler failed'); socket.emit('search-results', { results: [], total: 0, nextCursor: null }); socket.emit('session-error', 'Search failed for the selected language'); } });
    socket.on('update-verse', (payload) => { if (!socketRateLimit('update-verse', 60)) return; const verse = payload && payload.verse ? payload.verse : payload; if (!verse || typeof verse !== 'object' || !verse.verse_id) return; const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; fastify.log.info({ verseId: verse?.verse_id }, 'updating verse'); const state = getSessionState(sessionId); state.liveVerse = verse; state.updatedAt = Date.now(); emitToSession(sessionId, 'update-verse', verse); });
    socket.on('update-theme', (payload) => { const theme = payload && payload.theme ? payload.theme : payload; const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; fastify.log.info('updating theme'); const state = getSessionState(sessionId); state.theme = theme; state.updatedAt = Date.now(); emitToSession(sessionId, 'update-theme', theme); });
    socket.on('highlight-text', (payload) => { if (!socketRateLimit('highlight-text', 60)) return; const text = payload && Object.prototype.hasOwnProperty.call(payload, 'text') ? payload.text : payload; const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; fastify.log.info('highlighting text'); const state = getSessionState(sessionId); state.highlightedText = text ? String(text).trim().slice(0, 5000) : ''; state.updatedAt = Date.now(); emitToSession(sessionId, 'highlight-text', state.highlightedText); });
    socket.on('clear-screen', (payload, callback) => { const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; const state = getSessionState(sessionId); state.liveVerse = null; state.highlightedText = ''; state.customMode = null; state.updatedAt = Date.now(); emitToSession(sessionId, 'clear-screen', {}); fastify.log.info(`clear-screen broadcast to session ${sessionId}`); if (typeof callback === 'function') callback({ ok: true }); });
    socket.on('go-custom', (payload) => { if (!socketRateLimit('go-custom', 30)) return; const { text, subtext, theme } = payload || {}; const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; if (!text) return; const state = getSessionState(sessionId); state.customMode = { text: String(text), subtext: String(subtext || '') }; state.theme = theme || state.theme; state.liveVerse = null; state.updatedAt = Date.now(); emitToSession(sessionId, 'custom-text', { text: String(text), subtext: String(subtext || ''), theme }); if (theme) emitToSession(sessionId, 'update-theme', theme); fastify.log.info(`go-custom broadcast to session ${sessionId}`); });
    socket.on('preload-background', (payload) => { if (!payload?.background_url) return; const sessionId = activeSessionId || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; emitToSession(sessionId, 'preload-background', { background_url: payload.background_url }); });
    socket.on('now-reading', (payload) => { const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; emitToSession(sessionId, 'now-reading', { on: !!payload?.on, verse_id: payload?.verse_id || null }); });
    socket.on('update-language', (payload) => { const lang = payload?.language ? String(payload.language).toLowerCase().trim() : 'en'; const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; const state = getSessionState(sessionId); state.language = lang; state.updatedAt = Date.now(); if (state.liveVerse) { const targetDb = resolveDbAdapter(lang); try { const row = fetchVerseByCoords(targetDb, state.liveVerse, 'scripture_text, verse_title, book_title, volume_title, volume_short_title'); if (row) { const updated = { ...state.liveVerse, scripture_text: row.scripture_text || state.liveVerse.scripture_text, book_title: row.book_title || state.liveVerse.book_title, verse_title: row.verse_title || state.liveVerse.verse_title, volume_title: row.volume_title || state.liveVerse.volume_title || '', volume_short_title: row.volume_short_title || state.liveVerse.volume_short_title || '', segments: segmentVerseText(row.scripture_text || state.liveVerse.scripture_text), currentSegment: 0 }; updated.totalSegments = updated.segments.length; state.liveVerse = updated; emitToSession(sessionId, 'update-verse', updated); } } catch (err) { fastify.log.warn(`update-language: failed to fetch verse in ${lang}:`, err?.message); } } fastify.log.info(`update-language: session ${sessionId} → ${lang}`); });
    socket.on('go-live', ({ verse, theme, language, sessionId: rawSessionId, secondaryLanguage }) => { const sessionId = activeSessionId || normalizeSessionId(rawSessionId) || DEFAULT_SESSION_ID; if (!ensurePresenterAccess(sessionId, socket)) return; fastify.log.info({ sessionId }, '[Socket.IO] go-live triggered'); let scriptureText = verse.scripture_text; let verseTitle = verse.book_title + ' ' + verse.chapter_number + ':' + verse.verse_number; let bookTitle = verse.book_title; const normalizedLanguage = language ? language.toLowerCase().trim() : null; let targetDb = dba; const isTranslation = normalizedLanguage && ['ceb', 'tl', 'es', 'el', 'ilo', 'ja', 'ylt', 'war'].includes(normalizedLanguage); if (isTranslation) targetDb = resolveDbAdapter(normalizedLanguage); if (targetDb) { try { const result = fetchVerseByCoords(targetDb, verse, 'scripture_text, verse_title, book_title, volume_title, volume_short_title'); if (result) { if (isTranslation) { if (result.scripture_text) scriptureText = result.scripture_text; if (result.verse_title) verseTitle = result.verse_title; if (result.book_title) bookTitle = result.book_title; } else { scriptureText = result.scripture_text; verseTitle = result.verse_title; bookTitle = result.book_title; } verse = { ...verse, volume_title: result.volume_title || verse.volume_title || '', volume_short_title: result.volume_short_title || verse.volume_short_title || '' }; } } catch (err) { fastify.log.error(isTranslation ? `Failed to fetch ${normalizedLanguage} translation` : 'Failed to fetch English text', err); } } const segments = segmentVerseText(scriptureText); const verseWithSegments = { ...verse, scripture_text: scriptureText, verse_title: verseTitle, book_title: bookTitle, segments, totalSegments: segments.length, currentSegment: 0, secondary_text: null, secondary_book_title: null, secondary_segments: null, secondaryLanguage: null, language: normalizedLanguage || 'en', version_citation: getVersionCitation(normalizedLanguage || 'en', verse.volume_id) }; const normSecLang = secondaryLanguage ? String(secondaryLanguage).toLowerCase().trim() : null; if (normSecLang && ['tl', 'ceb', 'en', 'es', 'el', 'ilo', 'ja', 'ylt', 'war'].includes(normSecLang) && normSecLang !== normalizedLanguage) { const secDb = resolveDbAdapter(normSecLang); try { const secRow = fetchVerseByCoords(secDb, verse, 'scripture_text, book_title'); if (secRow) { verseWithSegments.secondary_text = secRow.scripture_text; verseWithSegments.secondary_book_title = secRow.book_title; verseWithSegments.secondaryLanguage = normSecLang; } } catch (err) { fastify.log.warn('dual-lang fetch failed:', err?.message); } } if (verseWithSegments.secondaryLanguage) verseWithSegments.version_citation = getVersionCitation(normalizedLanguage || 'en', verse.volume_id, verseWithSegments.secondaryLanguage); if (verseWithSegments.secondaryLanguage && verseWithSegments.secondary_text) { const { primarySegments, secondarySegments } = segmentVerseTextDual(scriptureText, verseWithSegments.secondary_text); verseWithSegments.segments = primarySegments; verseWithSegments.totalSegments = primarySegments.length; verseWithSegments.secondary_segments = secondarySegments; } const state = getSessionState(sessionId); state.liveVerse = verseWithSegments; state.theme = theme; state.highlightedText = ''; state.updatedAt = Date.now(); if (verse.verse_id) state.liveHistory = [verse.verse_id, ...state.liveHistory.filter(id => id !== verse.verse_id)].slice(0, 5); emitToSession(sessionId, 'update-verse', verseWithSegments); emitToSession(sessionId, 'update-theme', theme); });
    socket.on('disconnecting', () => { if (socket.rooms && typeof socket.rooms.forEach === 'function') { socket.rooms.forEach((roomId) => { if (roomId !== socket.id) { if (activeRole === 'presenter') { const state = getSessionState(roomId); if (state) { if (state.presenterSocketId === socket.id) state.presenterDisconnectedAt = Date.now(); if (state._presenterLeftTimer) clearTimeout(state._presenterLeftTimer); const capturedRoomId = roomId; state._presenterLeftTimer = setTimeout(() => { state._presenterLeftTimer = null; io.to(capturedRoomId).emit('presenter-left', { sessionId: capturedRoomId, locked: true }); }, PRESENTER_LEFT_DEBOUNCE_MS); } } releasePresenterLock(roomId, socket.id); if (activeRole !== 'presenter') decrementViewerCount(roomId); scheduleCleanup(roomId, { disconnecting: true }); } }); } else { if (activeRole === 'presenter') { const state = getSessionState(activeSessionId); if (state) { if (state.presenterSocketId === socket.id) state.presenterDisconnectedAt = Date.now(); if (state._presenterLeftTimer) clearTimeout(state._presenterLeftTimer); const capturedSessionId = activeSessionId; state._presenterLeftTimer = setTimeout(() => { state._presenterLeftTimer = null; io.to(capturedSessionId).emit('presenter-left', { sessionId: capturedSessionId, locked: true }); }, PRESENTER_LEFT_DEBOUNCE_MS); } } releasePresenterLock(activeSessionId, socket.id); if (activeRole !== 'presenter') decrementViewerCount(activeSessionId); scheduleCleanup(activeSessionId, { disconnecting: true }); } });
    socket.on('disconnect', () => { releasePresenterLock(activeSessionId, socket.id); scheduleCleanup(activeSessionId); fastify.log.info({ socketId: socket.id }, 'user disconnected'); });
  });
}

if (require.main === module) { registerSocketHandlers(io, { segmentVerseText, db, db_cebuano, db_tagalog, db_spanish, db_greek, db_ilocano, db_japanese, db_ylt, db_waray }); }

fastify.get('/verse/:verse_id/entities', async (request, reply) => { const verseId = parseInt(request.params.verse_id, 10); if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; } const cached = verseEntityCache.get(verseId); if (cached) return { verse_id: verseId, ...cached, ready: true }; return { verse_id: verseId, people: [], places: [], ready: entitiesReady }; });

fastify.get('/entity/search', async (request, reply) => { const { name, type = 'person', language = 'en', page: pg = '0', pageSize: ps = '10', entity_id, verse_id: vid } = request.query; if (!name || !name.trim()) { reply.code(400); return { error: 'name is required' }; } const page = Math.max(0, parseInt(pg, 10) || 0); const pageSize = Math.min(30, Math.max(1, parseInt(ps, 10) || 10)); const lang = language.toLowerCase(); const targetDb = lang !== 'en' ? resolveDbAdapter(lang) : dba; if (!targetDb) return { results: [], total: 0, name, type, page, pageSize, groups: [] }; if (db_tags) { let resolvedEid = entity_id || null; const searchName = name.trim().replace(/\s*\([^)]*\)\s*/g, '').toLowerCase(); const searchToken = searchName.replace(/\s+/g, '_'); if (!resolvedEid && vid) { const vInt = parseInt(vid, 10); const row = db_tags.prepare(`SELECT m.entity_id FROM ai_entity_verse_map m JOIN ai_entity_profiles p ON m.entity_id = p.entity_id WHERE m.verse_id = ? AND LOWER(p.name) = ? AND p.type = ? LIMIT 1`).get(vInt, searchName, type); if (row) resolvedEid = row.entity_id; else { const eidRows = db_tags.prepare(`SELECT m.entity_id, p.verse_count FROM ai_entity_verse_map m JOIN ai_entity_profiles p ON m.entity_id = p.entity_id WHERE m.verse_id = ? AND p.entity_id LIKE ? AND p.type = ?`).all(vInt, `${type}:${searchToken}%`, type); if (eidRows.length === 1) resolvedEid = eidRows[0].entity_id; else if (eidRows.length > 1) { const verseEmb = embeddingCache.get(vInt) || null; const scored = scoreEntityCandidates(eidRows, vInt, verseEmb); resolvedEid = scored[0].entity_id; } } } if (!resolvedEid) { const profiles = db_tags.prepare(`SELECT entity_id, verse_count FROM ai_entity_profiles WHERE (LOWER(name) = ? OR entity_id LIKE ?) AND type = ?`).all(searchName, `${type}:${searchToken}%`, type); const seen = new Set(); const uniq = []; for (const p of profiles) { if (!seen.has(p.entity_id)) { seen.add(p.entity_id); uniq.push(p); } } if (uniq.length === 1) resolvedEid = uniq[0].entity_id; else if (uniq.length > 1) { const vInt = vid ? parseInt(vid, 10) : null; const verseEmb = vInt ? (embeddingCache.get(vInt) || null) : null; const scored = scoreEntityCandidates(uniq, vInt, verseEmb); resolvedEid = scored[0].entity_id; } } if (resolvedEid) { const profile = db_tags.prepare('SELECT * FROM ai_entity_profiles WHERE entity_id = ?').get(resolvedEid); const allVids = db_tags.prepare('SELECT verse_id FROM ai_entity_verse_map WHERE entity_id = ? ORDER BY verse_id').all(resolvedEid).map(r => r.verse_id); const total = allVids.length; const offset = page * pageSize; const pageVids = allVids.slice(offset, offset + pageSize); const results = pageVids.length > 0 ? targetDb.prepare(`SELECT * FROM scriptures WHERE verse_id IN (${pageVids.map(() => '?').join(',')}) ORDER BY verse_id`).all(...pageVids) : []; const volumeMap = new Map(); for (const r of results) { const volId = r.volume_id || 0; if (!volumeMap.has(volId)) volumeMap.set(volId, { volume_id: volId, volume_title: r.volume_title || r.book_title, results: [] }); volumeMap.get(volId).results.push(r); } const siblings = profile ? db_tags.prepare(`SELECT entity_id, qualifier, verse_count FROM ai_entity_profiles WHERE (LOWER(name) = LOWER(?) OR entity_id LIKE ?) AND type = ? AND entity_id != ?`).all(profile.name, `${type}:${searchToken}%`, profile.type, resolvedEid) : []; return { results, total, name, type, page, pageSize, groups: [...volumeMap.values()], entity_id: resolvedEid, qualifier: profile?.qualifier || null, description: profile?.description || null, siblings }; } } const searchName = name.trim().replace(/\s*\([^)]*\)\s*/g, '').trim(); const { results: ftsResults, total } = phraseSearch(searchName, page, pageSize, targetDb, fastify.log); if (ftsResults.length === 0 && total === 0 && db_tags) { try { const col = type === 'place' ? 'places' : 'people'; const altCol = col === 'people' ? 'places' : 'people'; const key = searchName.toLowerCase(); let chapterRows = db_tags.prepare(`SELECT chapter_id FROM chapter_entities WHERE lower(${col}) LIKE ?`).all(`%${key}%`); if (chapterRows.length === 0) chapterRows = db_tags.prepare(`SELECT chapter_id FROM chapter_entities WHERE lower(${altCol}) LIKE ?`).all(`%${key}%`); if (chapterRows.length > 0) { const allVerseIds = []; for (const { chapter_id } of chapterRows) { const vs = targetDb.prepare('SELECT verse_id FROM scriptures WHERE chapter_id = ? ORDER BY verse_number').all(chapter_id); vs.forEach(v => allVerseIds.push(v.verse_id)); } const entTotal = allVerseIds.length; const offset = page * pageSize; const pageIds = allVerseIds.slice(offset, offset + pageSize); const entResults = pageIds.length > 0 ? targetDb.prepare(`SELECT * FROM scriptures WHERE verse_id IN (${pageIds.map(() => '?').join(',')}) ORDER BY verse_id`).all(...pageIds) : []; const volumeMap = new Map(); for (const r of entResults) { const vid = r.volume_id || 0; if (!volumeMap.has(vid)) volumeMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] }); volumeMap.get(vid).results.push(r); } return { results: entResults, total: entTotal, name, type, page, pageSize, groups: [...volumeMap.values()] }; } } catch {} } const volumeMap = new Map(); for (const r of ftsResults) { const vid = r.volume_id || 0; if (!volumeMap.has(vid)) volumeMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] }); volumeMap.get(vid).results.push(r); } const groups = [...volumeMap.values()]; return { results: ftsResults, total, name, type, page, pageSize, groups }; });

fastify.get('/verse/:verse_id/tags', async (request, reply) => { const verseId = parseInt(request.params.verse_id, 10); if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; } if (!db_tags) return { verse_id: verseId, pov: null, labels: [], ready: false }; try { const row = db_tags.prepare('SELECT pov, labels_json, speaker FROM verse_doctrine_tags WHERE verse_id = ?').get(verseId); if (!row) return { verse_id: verseId, pov: null, labels: [], speaker: null, ready: false }; return { verse_id: verseId, pov: row.pov, labels: JSON.parse(row.labels_json || '[]'), speaker: row.speaker || null, ready: true }; } catch { return { verse_id: verseId, pov: null, labels: [], ready: false }; } });

fastify.get('/chapter/:chapter_id/summary', async (request, reply) => { const chapterId = parseInt(request.params.chapter_id, 10); if (isNaN(chapterId)) { reply.code(400); return { error: 'Invalid chapter_id' }; } if (!db_chsummary) return { chapter_id: chapterId, summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false }; try { const row = db_chsummary.prepare('SELECT summary_text, summary_method, key_verses_json, top_topics_json FROM chapter_summaries WHERE chapter_id = ?').get(chapterId); if (!row) return { chapter_id: chapterId, summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false }; let nabre_footnotes = null; let net_footnotes = null; if (db_footnotes) { try { const fn = db_footnotes.prepare('SELECT bg_footnotes, net_notes FROM chapter_footnotes WHERE chapter_id = ?').get(chapterId); if (fn) { nabre_footnotes = fn.bg_footnotes || null; net_footnotes = fn.net_notes || null; } } catch (_) {} } return { chapter_id: chapterId, summary_text: row.summary_text, summary_method: row.summary_method || 'extractive', key_verses: JSON.parse(row.key_verses_json || '[]'), top_topics: JSON.parse(row.top_topics_json || '[]'), nabre_footnotes, net_footnotes, ready: true }; } catch { return { chapter_id: chapterId, summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false }; } });

fastify.get('/verse/:verse_id/summary', async (request, reply) => { const verseId = parseInt(request.params.verse_id, 10); if (isNaN(verseId)) { reply.code(400); return { error: 'Invalid verse_id' }; } if (!db_vsummary) return { verse_id: verseId, summary: null, cross_references: [], ready: false }; try { const row = db_vsummary.prepare('SELECT summary FROM verse_summaries WHERE verse_id = ?').get(verseId); if (!row || !row.summary) return { verse_id: verseId, summary: null, cross_references: [], ready: false }; let xrefs = []; if (db_vxref) { try { const xr = db_vxref.prepare('SELECT cross_references FROM verse_cross_references WHERE verse_id = ?').get(verseId); if (xr) xrefs = JSON.parse(xr.cross_references || '[]'); } catch {} } return { verse_id: verseId, summary: row.summary, cross_references: xrefs, ready: true }; } catch { return { verse_id: verseId, summary: null, cross_references: [], ready: false }; } });

fastify.get('/chapter/:chapter_id/entities', async (request, reply) => { const chapterId = parseInt(request.params.chapter_id, 10); if (isNaN(chapterId)) { reply.code(400); return { error: 'Invalid chapter_id' }; } if (!db_tags) return { chapter_id: chapterId, people: [], places: [], ready: false }; try { const row = db_tags.prepare('SELECT entities_json FROM chapter_entities WHERE chapter_id = ?').get(chapterId); if (!row || !row.entities_json) return { chapter_id: chapterId, people: [], places: [], ready: true }; const j = JSON.parse(row.entities_json); return { chapter_id: chapterId, people: j.people || [], places: j.places || [], ready: true }; } catch { return { chapter_id: chapterId, people: [], places: [], ready: false }; } });

fastify.get('/sermon-search', async (request, reply) => { const { q, limit: lim = '12' } = request.query; if (!q || !q.trim()) { reply.code(400); return { error: 'q is required' }; } if (!db_chsummary) return { results: [], total: 0, ready: false }; const limit = Math.min(30, Math.max(1, parseInt(lim, 10) || 12)); const term = q.trim().toLowerCase(); try { const rows = db_chsummary.prepare(`SELECT cs.chapter_id, cs.book_id, cs.chapter_num, cs.summary_text, cs.top_topics_json FROM chapter_summaries_fts fts JOIN chapter_summaries cs ON cs.chapter_id = fts.rowid WHERE chapter_summaries_fts MATCH ? ORDER BY fts.rank LIMIT ?`).all(term, limit); const stmtTitle = dba.prepare('SELECT book_title FROM scriptures WHERE book_id = ? LIMIT 1'); const results = rows.map(r => { const meta = stmtTitle.get(r.book_id); return { chapter_id: r.chapter_id, book_id: r.book_id, chapter_num: r.chapter_num, book_title: meta?.book_title || '', summary_text: r.summary_text || '', top_topics: JSON.parse(r.top_topics_json || '[]').slice(0, 5) }; }); return { results, total: results.length, query: q }; } catch (err) { fastify.log.error(err); return { results: [], total: 0, query: q }; } });


const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server running on ${port}`);
    
    // Add this line - ensure ONNX is ready
    await initOnnxSession();
    
    setImmediate(() => {
      ensureSearchWarmup().catch(err => fastify.log.error(err, '[SearchWarmup] initialization failed'));
    });
    // ... rest of start function
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};



if (require.main !== module) { setImmediate(() => { ensureSearchWarmup().catch(err => fastify.log.error(err, '[SearchWarmup] initialization failed')); }); }

if (require.main === module) { start(); }

async function startElectron() { registerSocketHandlers(io, { segmentVerseText, segmentVerseTextDual, db, db_cebuano, db_tagalog, db_spanish, db_greek, db_ilocano, db_japanese, db_ylt, db_waray }); return start(); }

const searchScriptureDefault = (input, page, pageSize) => searchScripture(input, page, pageSize, dba, fastify.log);
const searchScriptureInDbDefault = (input, page, pageSize, targetDb) => searchScriptureInDb(input, page, pageSize, targetDb, fastify.log);

module.exports = { parseScriptureReference, searchScripture: searchScriptureDefault, segmentVerseText, segmentVerseTextDual, computeAdaptiveResultCutoff, computeRelevanceProbability, normalizeKJVSpellings, normalizeQueryTokens, fastify, registerSocketHandlers, startElectron };