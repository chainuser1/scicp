'use strict';

// ── Scripture Engine ────────────────────────────────────────────────────────
// Pure query logic shared between the Node.js backend (better-sqlite3) and
// the mobile app (sql.js WASM).  Every function that touches the database
// takes a `db` parameter — a db-adapter instance (BetterSqliteAdapter or
// SqlJsAdapter) so the same code runs on both platforms.
//
// Functions that don't touch the DB are pure helpers (expandBookName,
// segmentVerseText, parseScriptureReference, etc.).

const { BOOK_ABBREVIATIONS } = require('./data/book-abbreviations');
const { BIBLE_CITATIONS, TRIPLE_CITATIONS, LANGUAGE_NAMES, VOTD_POOL } = require('./data/citations');

// ── Book name expansion ─────────────────────────────────────────────────────
function expandBookName(bookRef) {
  if (!bookRef) return null;
  const lowerRef = bookRef.toLowerCase().trim();
  return BOOK_ABBREVIATIONS[lowerRef] || bookRef;
}

// ── Text segmentation ───────────────────────────────────────────────────────
function segmentVerseText(text, wordsPerSegment = 200) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const segments = [];
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    segments.push(words.slice(i, i + wordsPerSegment).join(' '));
  }
  return segments.length > 0 ? segments : [text];
}

function segmentVerseTextDual(primaryText, secondaryText, wordsPerSegment = 150) {
  const primarySegs   = segmentVerseText(primaryText,   wordsPerSegment);
  const secondarySegs = segmentVerseText(secondaryText, wordsPerSegment);
  const len = Math.max(primarySegs.length, secondarySegs.length);
  while (primarySegs.length   < len) primarySegs.push('');
  while (secondarySegs.length < len) secondarySegs.push('');
  return { primarySegments: primarySegs, secondarySegments: secondarySegs };
}

// ── Scripture reference parser ──────────────────────────────────────────────
function parseScriptureReference(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  const tokens  = trimmed.split(/\s+/);

  // ── Try "book chapter verse" (all spaces, e.g. "1 ne 1 1", "matt 5 3") ──
  // For multi-word books (≥4 tokens) AND single-word books (3 tokens).
  if (tokens.length >= 3) {
    const verse   = parseInt(tokens[tokens.length - 1], 10);
    const chapter = parseInt(tokens[tokens.length - 2], 10);
    if (!isNaN(verse) && !isNaN(chapter) && verse > 0 && chapter > 0) {
      const bookRaw = tokens.slice(0, tokens.length - 2).join(' ');
      const book    = expandBookName(bookRaw);
      if (book !== bookRaw) return { book, chapter, verse };
    }
  }

  // ── Try "book chapter:verse" or "book chapter" ────────────────────────────
  const colonMatch = trimmed.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (!colonMatch) return null;
  const book    = expandBookName(colonMatch[1].trim());
  const chapter = parseInt(colonMatch[2], 10);
  const verse   = colonMatch[3] ? parseInt(colonMatch[3], 10) : null;
  return { book, chapter, verse };
}

// ── Doctrine alias helpers ──────────────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeAliasEntry(entry) {
  const uniqPhrases = [];
  const seenPhrases = new Set();
  for (const phrase of entry.phrases || []) {
    const normalized = String(phrase || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seenPhrases.has(key)) continue;
    seenPhrases.add(key);
    uniqPhrases.push(normalized);
  }
  const uniqTerms = [];
  const seenTerms = new Set();
  for (const term of entry.terms || []) {
    const normalized = String(term || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    uniqTerms.push(normalized);
  }
  return { phrases: uniqPhrases, terms: uniqTerms };
}

function compileDoctrineAliases(aliases) {
  const normalizedMap = {};
  const keys = Object.keys(aliases);
  for (const key of keys) {
    normalizedMap[key.toLowerCase().trim()] = sanitizeAliasEntry(aliases[key]);
  }
  const sortedKeys = Object.keys(normalizedMap).sort((a, b) => b.length - a.length);
  return { normalizedMap, sortedKeys };
}

// ── FTS5 query builders ─────────────────────────────────────────────────────
const buildFTSPhraseQuery = (phrase) => {
  return `"${phrase.replace(/\"/g, '""')}"`;
};

const buildFTSTermQuery = (terms, mode = 'and') => {
  if (!terms || !terms.length) return '';
  const cleaned = terms.map((t) => String(t || '').trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const wildcarded = cleaned
    .map((t) => {
      const safe = t.replace(/["']/g, '').replace(/[^a-zA-Z0-9\-\s]/g, '').trim();
      if (!safe) return '';
      if (safe.includes(' ')) return `"${safe.replace(/\"/g, '""')}"`;
      return `${safe}*`;
    })
    .filter(Boolean);
  if (!wildcarded.length) return '';
  return mode === 'or'
    ? wildcarded.join(' OR ')
    : wildcarded.join(' AND ');
};

const buildFTSMatchQuery = (input, { orFallback = false } = {}) => {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const quoted = trimmed.match(/^"(.+)"$/);
  if (quoted) return `"${quoted[1].replace(/\"/g, '""')}"`;
  const terms = trimmed
    .split(/\s+/)
    .map(t => t.replace(/["']/g, '').replace(/[^a-zA-Z0-9\-]/g, ''))
    .filter(t => t.length > 1);
  if (terms.length === 0) return '';
  const wildcarded = terms.map(t => `${t}*`);
  return orFallback ? wildcarded.join(' OR ') : wildcarded.join(' AND ');
};

// ── FTS5 count / query runners ──────────────────────────────────────────────
const MAX_COUNT_SCAN = 2000;

const runFTSCount = (matchQuery, db) => {
  try {
    const stmt = db.prepare(`
      SELECT COUNT(*) AS total
      FROM (
        SELECT verse_id
        FROM scriptures_fts
        WHERE scriptures_fts MATCH ?
        LIMIT ${MAX_COUNT_SCAN}
      )
    `);
    return stmt.get(matchQuery)?.total ?? 0;
  } catch (_err) {
    return 0;
  }
};

const runFTSQuery = (matchQuery, rawPhrase = null, limit = 10, offset = 0, db) => {
  const literalPattern = rawPhrase
    ? `%${rawPhrase.trim().toLowerCase()}%`
    : null;

  const stmt = db.prepare(`
    SELECT
      s.volume_id, s.book_id, s.chapter_id, s.verse_id,
      s.volume_title, s.book_title, s.volume_long_title, s.book_long_title,
      s.volume_subtitle, s.book_subtitle, s.volume_short_title, s.book_short_title,
      s.volume_lds_url, s.book_lds_url, s.chapter_number, s.verse_number,
      s.scripture_text, s.verse_title, s.verse_short_title
    FROM scriptures s
    JOIN (
      SELECT verse_id, bm25(scriptures_fts, 0, 10, 5, 1, 0, 0) AS rank
      FROM scriptures_fts
      WHERE scriptures_fts MATCH ?
      LIMIT ${limit} OFFSET ${offset}
    ) fts ON fts.verse_id = s.verse_id
    ORDER BY
      CASE WHEN ${literalPattern ? 'LOWER(s.scripture_text) LIKE ?' : '0'} THEN 0 ELSE 1 END,
      fts.rank,
      s.verse_id
  `);

  const args = literalPattern
    ? [matchQuery, literalPattern]
    : [matchQuery];

  return stmt.all(...args);
};

// ── Phrase search (paginated, multi-pass FTS + LIKE fallback) ───────────────
const phraseSearch = (phrase, page = 0, pageSize = 10, db, log = null) => {
  if (!phrase || !phrase.trim()) return { results: [], total: 0 };

  const raw    = phrase.trim();
  const offset = page * pageSize;

  try {
    const ftsExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='scriptures_fts'`
    ).get();

    if (ftsExists) {
      // Exact phrase match (for multi-word input)
      if (raw.split(/\s+/).length > 1) {
        const exactQ  = buildFTSPhraseQuery(raw);
        const total   = runFTSCount(exactQ, db);
        const results = runFTSQuery(exactQ, raw, pageSize, offset, db);
        if (results.length > 0 || total > 0) return { results, total };
      }

      // AND match (all terms must appear)
      const andQ = buildFTSMatchQuery(raw);
      if (andQ) {
        const total   = runFTSCount(andQ, db);
        const results = runFTSQuery(andQ, raw, pageSize, offset, db);
        if (results.length > 0 || total > 0) return { results, total };
      }

      // OR match (any term)
      const orQ = buildFTSMatchQuery(raw, { orFallback: true });
      if (orQ) {
        const total   = runFTSCount(orQ, db);
        const results = runFTSQuery(orQ, raw, pageSize, offset, db);
        if (results.length > 0 || total > 0) return { results, total };
      }

      // Prefix wildcard (single word)
      if (raw.split(/\s+/).length === 1) {
        const wq      = `${raw}*`;
        const total   = runFTSCount(wq, db);
        const results = runFTSQuery(wq, raw, pageSize, offset, db);
        if (results.length > 0 || total > 0) return { results, total };
      }
    }
  } catch (err) {
    if (log) log.warn('FTS pipeline failed, falling back to LIKE:', err && err.message);
  }

  // Last resort — LIKE token scan
  const terms = raw.trim().split(/\s+/).filter(Boolean);
  const clauses = terms.map(() => '(scripture_text LIKE ? OR verse_title LIKE ?)');
  const likeParams = [];
  terms.forEach(t => likeParams.push(`%${t}%`, `%${t}%`));

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total FROM scriptures WHERE ${clauses.join(' AND ')}
  `).get(...likeParams);
  const total = Math.min(countRow?.total ?? 0, MAX_COUNT_SCAN);

  const results = db.prepare(`
    SELECT book_id, chapter_id, book_title, chapter_number, verse_number,
           scripture_text, verse_title, verse_id
    FROM scriptures
    WHERE ${clauses.join(' AND ')}
    ORDER BY verse_id
    LIMIT ? OFFSET ?
  `).all(...likeParams, pageSize, offset);

  return { results, total };
};

// ── searchScripture — paginated entry point ─────────────────────────────────
const searchScripture = (input, page = 0, pageSize = 10, db, log = null) => {
  const ref = parseScriptureReference(input);
  if (ref) {
    let sql = `
    SELECT
        book_id,
        chapter_id,
        book_title,
        chapter_number,
        verse_number,
        scripture_text,
        verse_title,
        verse_short_title,
        verse_id
    FROM
        scriptures
    WHERE
        LOWER(book_title) = LOWER(?)`;
    const params = [ref.book];

    sql += '\n        AND chapter_number = ?';
    params.push(ref.chapter);

    if (ref.verse !== null) {
      sql += ' AND verse_number = ?';
      params.push(ref.verse);
    }

    const countSql  = sql.replace(/SELECT[\s\S]+?FROM/, 'SELECT COUNT(*) AS total FROM');
    const countRow  = db.prepare(countSql + ' LIMIT 200').get(...params);
    const total     = countRow?.total ?? 0;

    const pageSql   = sql + `\n    ORDER BY verse_id ASC\n    LIMIT ? OFFSET ?`;
    const stmt      = db.prepare(pageSql);
    const result    = stmt.all(...params, pageSize, page * pageSize);
    if (result.length > 0 || total > 0) return { results: result, total };

    // Fallback for unexpected title variants
    const fallbackCountSql = countSql.replace('LOWER(book_title) = LOWER(?)', 'book_title LIKE ?') + ' LIMIT 200';
    const fallbackPageSql  = sql.replace('LOWER(book_title) = LOWER(?)', 'book_title LIKE ?') + '\n    ORDER BY verse_id ASC\n    LIMIT ? OFFSET ?';
    const fallbackParams   = [`%${ref.book}%`, ...params.slice(1)];
    const fbCount = db.prepare(fallbackCountSql).get(...fallbackParams)?.total ?? 0;
    const fbRows  = db.prepare(fallbackPageSql).all(...fallbackParams, pageSize, page * pageSize);
    if (fbRows.length > 0 || fbCount > 0) return { results: fbRows, total: fbCount };

    return phraseSearch(input, page, pageSize, db, log);
  }

  return phraseSearch(input, page, pageSize, db, log);
};

// ── searchScriptureInDb — same as searchScripture for non-English DBs ───────
const searchScriptureInDb = (input, page = 0, pageSize = 10, db, log = null) => {
  const ref = parseScriptureReference(input);
  const offset = page * pageSize;

  if (ref) {
    try {
      const countRow = db.prepare(`
        SELECT COUNT(*) AS total FROM scriptures
        WHERE LOWER(book_title) = LOWER(?) AND chapter_number = ?
        ${ref.verse !== null ? 'AND verse_number = ?' : ''}
        LIMIT 200
      `).get(...(ref.verse !== null ? [ref.book, ref.chapter, ref.verse] : [ref.book, ref.chapter]));

      const total = countRow?.total ?? 0;
      const rows  = db.prepare(`
        SELECT book_id, chapter_id, book_title, chapter_number, verse_number,
               scripture_text, verse_title, verse_short_title, verse_id
        FROM scriptures
        WHERE LOWER(book_title) = LOWER(?) AND chapter_number = ?
        ${ref.verse !== null ? 'AND verse_number = ?' : ''}
        ORDER BY verse_id ASC LIMIT ? OFFSET ?
      `).all(...(ref.verse !== null
        ? [ref.book, ref.chapter, ref.verse, pageSize, offset]
        : [ref.book, ref.chapter, pageSize, offset]));

      if (rows.length > 0 || total > 0) return { results: rows, total };
    } catch (_e) { /* fall through to phrase search */ }
  }

  return phraseSearch(input, page, pageSize, db, log);
};

// ── topicSearch — find verses in a Topical Guide topic cluster ───────────────
// tgDb: a DB adapter pointing at topical-guide.db
// scriptureDb: a DB adapter pointing at lds-scriptures-sqlite.db (for verse data)
// query: 1-3 word topic name or slug
// Returns { results, total, matchedTopic } or null if no topic matched.
const topicSearch = (query, page = 0, pageSize = 10, tgDb, scriptureDb) => {
  if (!tgDb || !scriptureDb) return null;
  const lower = query.toLowerCase().trim();
  try {
    // Try exact slug, exact name, prefix, then substring
    const findTopic = (sql, ...params) => tgDb.prepare(sql).get(...params);
    const topic =
      findTopic('SELECT id, slug, name FROM topics WHERE slug = ? OR LOWER(name) = ? LIMIT 1', lower, lower) ??
      findTopic('SELECT id, slug, name FROM topics WHERE slug LIKE ? OR LOWER(name) LIKE ? LIMIT 1', `${lower}%`, `${lower}%`) ??
      findTopic('SELECT id, slug, name FROM topics WHERE slug LIKE ? OR LOWER(name) LIKE ? LIMIT 1', `%${lower}%`, `%${lower}%`);

    if (!topic) return null;

    const total = tgDb.prepare(
      'SELECT COUNT(*) AS c FROM topical_guide WHERE topic_id = ? AND verse_id IS NOT NULL AND verse_id != -1'
    ).get(topic.id)?.c ?? 0;
    if (total === 0) return { results: [], total: 0, matchedTopic: topic.name };

    const offset = page * pageSize;
    const verseIds = tgDb.prepare(
      'SELECT verse_id FROM topical_guide WHERE topic_id = ? AND verse_id IS NOT NULL AND verse_id != -1 LIMIT ? OFFSET ?'
    ).all(topic.id, pageSize, offset).map(r => r.verse_id);

    const stmt = scriptureDb.prepare(
      'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
    );
    const results = verseIds
      .map(vid => stmt.get(vid))
      .filter(Boolean)
      .map(row => ({ ...row, matched_concept: topic.name }));

    return { results, total, matchedTopic: topic.name };
  } catch (_) {
    return null;
  }
};
function getAdjacentVerse({ verse_id, book_id, chapter_number, verse_number, direction }, db, log = null) {
  const op = direction === 'next' ? '+' : '-';

  let localVerseId = verse_id;
  if (book_id != null && chapter_number != null && verse_number != null) {
    const current = db.prepare(
      'SELECT verse_id FROM scriptures WHERE book_id = ? AND chapter_number = ? AND verse_number = ? LIMIT 1'
    ).get(Number(book_id), Number(chapter_number), Number(verse_number));
    if (current) localVerseId = current.verse_id;
  }

  const stmt = db.prepare(`
    SELECT
      book_id,
      book_title,
      chapter_number,
      verse_number,
      scripture_text,
      verse_title,
      verse_short_title,
      verse_id,
      volume_id
    FROM scriptures
    WHERE verse_id = ? ${op} 1
    LIMIT 1
  `);
  try {
    return stmt.get(localVerseId);
  } catch (err) {
    if (log) log.error('adjacent query failed', err);
    return null;
  }
}

// ── fetchVerseByCoords ──────────────────────────────────────────────────────
function fetchVerseByCoords(db, verse, cols) {
  if (verse.book_id != null && verse.chapter_number != null && verse.verse_number != null) {
    return db.prepare(
      `SELECT ${cols} FROM scriptures WHERE book_id = ? AND chapter_number = ? AND verse_number = ? LIMIT 1`
    ).get(Number(verse.book_id), Number(verse.chapter_number), Number(verse.verse_number));
  }
  return db.prepare(
    `SELECT ${cols} FROM scriptures WHERE verse_id = ? LIMIT 1`
  ).get(Number(verse.verse_id));
}

// ── Browse queries ──────────────────────────────────────────────────────────
function browseBooks(db) {
  return db.prepare(`
    SELECT b.id AS book_id, b.book_title, b.book_short_title,
           v.id AS volume_id, v.volume_title, v.volume_short_title,
           COUNT(DISTINCT c.id) AS chapter_count
    FROM books b
    JOIN volumes v ON v.id = b.volume_id
    JOIN chapters c ON c.book_id = b.id
    GROUP BY b.id
    ORDER BY b.id
  `).all();
}

function browseChapters(db, bookId) {
  return db.prepare(`
    SELECT c.id AS chapter_id, c.chapter_number,
           COUNT(vs.id) AS verse_count
    FROM chapters c
    JOIN verses vs ON vs.chapter_id = c.id
    WHERE c.book_id = ?
    GROUP BY c.id
    ORDER BY c.chapter_number
  `).all(Number(bookId));
}

function browseVerses(db, chapterId) {
  return db.prepare(`
    SELECT verse_id, book_id, chapter_id, book_title, chapter_number, verse_number,
           scripture_text, verse_title, volume_id, volume_title, volume_short_title
    FROM scriptures
    WHERE chapter_id = ?
    ORDER BY verse_number
  `).all(Number(chapterId));
}

// ── FTS initialization ──────────────────────────────────────────────────────
function initializeFts(db, label = 'English', { forceRebuild = false, log = null } = {}) {
  const createFtsTableSql = `
    CREATE VIRTUAL TABLE scriptures_fts USING fts5(
      verse_id   UNINDEXED,
      scripture_text,
      verse_title,
      book_title,
      chapter_number UNINDEXED,
      verse_number   UNINDEXED,
      tokenize = "porter ascii"
    )
  `;

  const populateFts = () => {
    if (log) log.info(`[${label}] Populating FTS5 table from verses...`);
    const insertStmt = db.prepare(`
      INSERT INTO scriptures_fts(verse_id, scripture_text, verse_title, book_title, chapter_number, verse_number)
      SELECT
        verses.id,
        verses.scripture_text,
        (books.book_title || ' ' || chapters.chapter_number || ':' || verses.verse_number),
        books.book_title,
        chapters.chapter_number,
        verses.verse_number
      FROM verses
      JOIN chapters ON chapters.id = verses.chapter_id
      JOIN books    ON books.id    = chapters.book_id
    `);
    const result = insertStmt.run();
    if (log) log.info(`[${label}] FTS5 table populated with ${result.changes} verses`);
    db.exec(`INSERT INTO scriptures_fts(scriptures_fts) VALUES('optimize')`);
    if (log) log.info(`[${label}] FTS5 index optimized`);
  };

  try {
    const existing = db.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'scriptures_fts'
    `).get();
    const hasExpectedTokenizer = existing?.sql?.includes('porter ascii');

    if (forceRebuild || !existing || !hasExpectedTokenizer) {
      db.exec(`DROP TABLE IF EXISTS scriptures_fts`);
      db.exec(createFtsTableSql);
      populateFts();
      return;
    }

    const ftsCount = db.prepare(`SELECT COUNT(*) AS count FROM scriptures_fts`).get()?.count ?? 0;
    if (ftsCount === 0) {
      populateFts();
    } else {
      if (log) log.info(`[${label}] FTS5 table ready with ${ftsCount} indexed verses`);
    }
  } catch (err) {
    if (log) log.error(`[${label}] FTS5 setup failed:`, err && err.message ? err.message : err);
  }
}

// ── Version citation ────────────────────────────────────────────────────────
function getVersionCitation(language, volumeId, secondaryLanguage) {
  const vid = Number(volumeId);
  if (secondaryLanguage) {
    if (vid >= 3) {
      const p = LANGUAGE_NAMES[language] || 'English';
      const s = LANGUAGE_NAMES[secondaryLanguage] || secondaryLanguage;
      return `${p} vs ${s}`;
    }
    const p = BIBLE_CITATIONS[language] || (language ? language.toUpperCase() : '');
    const s = BIBLE_CITATIONS[secondaryLanguage] || secondaryLanguage.toUpperCase();
    return `${p} vs ${s}`;
  }
  if (vid >= 3) {
    const book = TRIPLE_CITATIONS[vid] || '';
    const lang = LANGUAGE_NAMES[language] || 'English';
    return book ? `${book}, ${lang}` : '';
  }
  return BIBLE_CITATIONS[language] || (language ? language.toUpperCase() : '');
}

// ── Verse of the Day ────────────────────────────────────────────────────────
function getVerseOfTheDay(db) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000
  );

  const LCG_A = 1664525, LCG_C = 1013904223, MOD = 2 ** 32;
  const seed   = ((LCG_A * dayOfYear + LCG_C) % MOD + MOD) % MOD;
  const poolId = VOTD_POOL[seed % VOTD_POOL.length];

  const verse = db.prepare(`
    SELECT book_id, book_title, chapter_id, chapter_number, verse_number,
           scripture_text, verse_title, verse_id, volume_id
    FROM scriptures WHERE verse_id = ?
  `).get(poolId);

  if (verse) {
    return { ...verse, date: now.toISOString().slice(0, 10), version_citation: getVersionCitation('en', verse.volume_id) };
  }

  // Fallback — random verse from full canon
  const countRow = db.prepare('SELECT COUNT(*) AS total FROM scriptures').get();
  const total    = countRow?.total || 41995;
  const fallbackSeed = ((LCG_A * (dayOfYear + 1) + LCG_C) % MOD + MOD) % MOD;
  const fallback = db.prepare(`
    SELECT book_id, book_title, chapter_id, chapter_number, verse_number,
           scripture_text, verse_title, verse_id, volume_id
    FROM scriptures WHERE verse_id = ?
  `).get((fallbackSeed % total) + 1);

  if (!fallback) return null;
  return { ...fallback, date: now.toISOString().slice(0, 10), version_citation: getVersionCitation('en', fallback.volume_id) };
}

module.exports = {
  // Pure helpers
  expandBookName,
  segmentVerseText,
  segmentVerseTextDual,
  parseScriptureReference,
  getVersionCitation,

  // FTS builders
  buildFTSPhraseQuery,
  buildFTSTermQuery,
  buildFTSMatchQuery,

  // DB query functions (require adapter instance)
  runFTSCount,
  runFTSQuery,
  phraseSearch,
  searchScripture,
  searchScriptureInDb,
  getAdjacentVerse,
  fetchVerseByCoords,
  browseBooks,
  browseChapters,
  browseVerses,
  initializeFts,
  getVerseOfTheDay,
  topicSearch,

  // Re-export data for consumers that need raw access
  BOOK_ABBREVIATIONS,
  BIBLE_CITATIONS,
  TRIPLE_CITATIONS,
  LANGUAGE_NAMES,
  VOTD_POOL,
  MAX_COUNT_SCAN,
};
