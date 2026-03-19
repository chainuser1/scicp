'use strict';

// ── Scripture Engine ────────────────────────────────────────────────────────
// Pure query logic shared between the Node.js backend (better-sqlite3) and
// the mobile app (sql.js WASM).  Every function that touches the database
// takes a `db` parameter — a db-adapter instance (BetterSqliteAdapter or
// SqlJsAdapter) so the same code runs on both platforms.
//
// Functions that don't touch the DB are pure helpers (expandBookName,
// segmentVerseText, parseScriptureReference, etc.).

const { BOOK_ABBREVIATIONS, CANONICAL_BOOK_IDS } = require('./data/book-abbreviations');
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
  const safe = phrase.replace(/[^a-zA-Z0-9\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return `"${safe}"`;
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

// No stopword filtering — scripture phrases like "my jesus", "thou art my son",
// "not be", "I am" etc. are meaningful. FTS5's BM25 naturally down-weights
// high-frequency terms, so common words won't dominate rankings.

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
      s.scripture_text, s.verse_title, s.verse_short_title,
      fts.rank AS _bm25_rank
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

  const raw    = phrase.trim().replace(/[^a-zA-Z0-9\-\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an)\s+/i, '');
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
           scripture_text, verse_title, verse_id, volume_id
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
        verse_id,
        volume_id
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
               scripture_text, verse_title, verse_short_title, verse_id, volume_id
        FROM scriptures
        WHERE LOWER(book_title) = LOWER(?) AND chapter_number = ?
        ${ref.verse !== null ? 'AND verse_number = ?' : ''}
        ORDER BY verse_id ASC LIMIT ? OFFSET ?
      `).all(...(ref.verse !== null
        ? [ref.book, ref.chapter, ref.verse, pageSize, offset]
        : [ref.book, ref.chapter, pageSize, offset]));

      if (rows.length > 0 || total > 0) return { results: rows, total };

      // Fallback: look up by canonical book_id (handles cross-language refs,
      // e.g. "Numbers" typed while viewing a Tagalog DB that stores "Mga Bilang").
      const bookId = CANONICAL_BOOK_IDS[ref.book.toLowerCase()];
      if (bookId) {
        const fbCount = db.prepare(`
          SELECT COUNT(*) AS total FROM scriptures
          WHERE book_id = ? AND chapter_number = ?
          ${ref.verse !== null ? 'AND verse_number = ?' : ''}
          LIMIT 200
        `).get(...(ref.verse !== null ? [bookId, ref.chapter, ref.verse] : [bookId, ref.chapter]))?.total ?? 0;
        const fbRows = db.prepare(`
          SELECT book_id, chapter_id, book_title, chapter_number, verse_number,
                 scripture_text, verse_title, verse_short_title, verse_id, volume_id
          FROM scriptures
          WHERE book_id = ? AND chapter_number = ?
          ${ref.verse !== null ? 'AND verse_number = ?' : ''}
          ORDER BY verse_id ASC LIMIT ? OFFSET ?
        `).all(...(ref.verse !== null
          ? [bookId, ref.chapter, ref.verse, pageSize, offset]
          : [bookId, ref.chapter, pageSize, offset]));
        if (fbRows.length > 0 || fbCount > 0) return { results: fbRows, total: fbCount };
      }
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
      'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id, volume_id FROM scriptures WHERE verse_id = ?'
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

function getComeFollowMeGroupForYear(year) {
  // 2026 anchor:
  // 2026 OT (+Moses/Abraham), 2027 NT (+JS-M), 2028 BoM, 2029 D&C (+JS-H/AoF)
  const groups = ['ot', 'nt', 'bom', 'dc'];
  const idx = ((Number(year) - 2026) % 4 + 4) % 4;
  return groups[idx];
}

function isVerseInComeFollowMeGroup(row, group) {
  const volume = Number(row?.volume_id);
  const book = String(row?.book_title || '').toLowerCase();
  const isJSM = /joseph smith\s*[—-]?\s*matthew|\bjs[-\s]?m\b/i.test(book);
  const isJSH = /joseph smith\s*[—-]?\s*history|\bjs[-\s]?h\b/i.test(book);
  const isAof = /articles?\s+of\s+faith/i.test(book);
  const isMosesOrAbraham = /\bmoses\b|\babraham\b/i.test(book);

  if (group === 'ot') return volume === 1 || isMosesOrAbraham;
  if (group === 'nt') return volume === 2 || isJSM;
  if (group === 'bom') return volume === 3;
  if (group === 'dc') return volume === 4 || isJSH || isAof;
  return false;
}

// 2026 Come Follow Me — Old Testament + Pearl of Great Price
// Week 1 starts Dec 29, 2025 (Mon). Week numbers are ISO-style (week of year).
const CFM_2026_OT_WEEKLY_BLOCKS = {
  1:  { book: 'Moses',    chapterStart: 1, chapterEnd: 1,   label: 'Moses 1' },
  2:  { book: 'Moses',    chapterStart: 1, chapterEnd: 1,   label: 'Moses 1; Abraham 3' },          // intro week
  3:  { book: 'Abraham',  chapterStart: 3, chapterEnd: 5,   label: 'Abraham 3–5' },
  4:  { book: 'Genesis',  chapterStart: 1, chapterEnd: 2,   label: 'Genesis 1–2; Moses 2–3' },
  5:  { book: 'Genesis',  chapterStart: 3, chapterEnd: 4,   label: 'Genesis 3–4; Moses 4–5' },
  6:  { book: 'Moses',    chapterStart: 5, chapterEnd: 7,   label: 'Moses 5–7' },
  7:  { book: 'Moses',    chapterStart: 8, chapterEnd: 8,   label: 'Moses 8; Genesis 5–6' },
  8:  { book: 'Genesis',  chapterStart: 6, chapterEnd: 10,  label: 'Genesis 6–10; Moses 8' },
  9:  { book: 'Genesis',  chapterStart: 11, chapterEnd: 14, label: 'Genesis 11–14' },
  10: { book: 'Genesis',  chapterStart: 15, chapterEnd: 19, label: 'Genesis 15–19' },
  11: { book: 'Genesis',  chapterStart: 20, chapterEnd: 23, label: 'Genesis 20–23' },
  12: { book: 'Genesis',  chapterStart: 24, chapterEnd: 27, label: 'Genesis 24–27' },
  13: { book: 'Genesis',  chapterStart: 28, chapterEnd: 31, label: 'Genesis 28–31' },
  14: { book: 'Genesis',  chapterStart: 32, chapterEnd: 36, label: 'Genesis 32–36' },
  15: { book: 'Genesis',  chapterStart: 37, chapterEnd: 41, label: 'Genesis 37–41' },
  16: { book: 'Genesis',  chapterStart: 42, chapterEnd: 50, label: 'Genesis 42–50' },
  17: { book: 'Exodus',   chapterStart: 1, chapterEnd: 6,   label: 'Exodus 1–6' },
  18: { book: 'Exodus',   chapterStart: 7, chapterEnd: 13,  label: 'Exodus 7–13' },
  19: { book: 'Exodus',   chapterStart: 14, chapterEnd: 17, label: 'Exodus 14–17' },
  20: { book: 'Exodus',   chapterStart: 18, chapterEnd: 20, label: 'Exodus 18–20' },
  21: { book: 'Exodus',   chapterStart: 21, chapterEnd: 24, label: 'Exodus 21–24' },
  22: { book: 'Exodus',   chapterStart: 25, chapterEnd: 31, label: 'Exodus 25–31' },
  23: { book: 'Exodus',   chapterStart: 32, chapterEnd: 34, label: 'Exodus 32–34' },
  24: { book: 'Exodus',   chapterStart: 35, chapterEnd: 40, label: 'Exodus 35–40; Leviticus 1' },
  25: { book: 'Leviticus', chapterStart: 1, chapterEnd: 15, label: 'Leviticus 1–15' },
  26: { book: 'Leviticus', chapterStart: 16, chapterEnd: 27, label: 'Leviticus 16–27' },
  27: { book: 'Numbers',  chapterStart: 1, chapterEnd: 21,  label: 'Numbers 1–21' },
  28: { book: 'Numbers',  chapterStart: 22, chapterEnd: 36, label: 'Numbers 22–36; Deuteronomy 1–4' },
  29: { book: 'Deuteronomy', chapterStart: 5, chapterEnd: 16, label: 'Deuteronomy 5–16' },
  30: { book: 'Deuteronomy', chapterStart: 17, chapterEnd: 34, label: 'Deuteronomy 17–34' },
  31: { book: 'Joshua',   chapterStart: 1, chapterEnd: 12,  label: 'Joshua 1–12' },
  32: { book: 'Joshua',   chapterStart: 13, chapterEnd: 24, label: 'Joshua 13–24; Judges 1–6' },
  33: { book: 'Judges',   chapterStart: 1, chapterEnd: 16,  label: 'Judges 1–16' },
  34: { book: 'Ruth',     chapterStart: 1, chapterEnd: 4,   label: 'Ruth; 1 Samuel 1–3' },
  35: { book: '1 Samuel', chapterStart: 1, chapterEnd: 15,  label: '1 Samuel 1–15' },
  36: { book: '1 Samuel', chapterStart: 16, chapterEnd: 31, label: '1 Samuel 16–31' },
  37: { book: '2 Samuel', chapterStart: 1, chapterEnd: 24,  label: '2 Samuel 1–24' },
  38: { book: '1 Kings',  chapterStart: 1, chapterEnd: 11,  label: '1 Kings 1–11' },
  39: { book: '1 Kings',  chapterStart: 12, chapterEnd: 22, label: '1 Kings 12–22; 2 Kings 1–2' },
  40: { book: '2 Kings',  chapterStart: 1, chapterEnd: 25,  label: '2 Kings 1–25' },
  41: { book: 'Ezra',     chapterStart: 1, chapterEnd: 10,  label: 'Ezra 1–10; Nehemiah 1–13' },
  42: { book: 'Esther',   chapterStart: 1, chapterEnd: 10,  label: 'Esther 1–10' },
  43: { book: 'Job',      chapterStart: 1, chapterEnd: 42,  label: 'Job 1–42' },
  44: { book: 'Psalms',   chapterStart: 1, chapterEnd: 75,  label: 'Psalms 1–75' },
  45: { book: 'Psalms',   chapterStart: 76, chapterEnd: 150, label: 'Psalms 76–150' },
  46: { book: 'Proverbs', chapterStart: 1, chapterEnd: 31,  label: 'Proverbs; Ecclesiastes' },
  47: { book: 'Song of Solomon', chapterStart: 1, chapterEnd: 8, label: 'Song of Solomon; Isaiah 1–5' },
  48: { book: 'Isaiah',   chapterStart: 1, chapterEnd: 12,  label: 'Isaiah 1–12' },
  49: { book: 'Isaiah',   chapterStart: 13, chapterEnd: 35, label: 'Isaiah 13–35' },
  50: { book: 'Isaiah',   chapterStart: 36, chapterEnd: 66, label: 'Isaiah 36–66' },
  51: { book: 'Jeremiah', chapterStart: 1, chapterEnd: 33,  label: 'Jeremiah 1–33; Lamentations' },
  52: { book: 'Ezekiel',  chapterStart: 1, chapterEnd: 48,  label: 'Ezekiel; Daniel; Minor Prophets' },
};

function getComeFollowMeWeeklyBlock(year, group, weekNumber) {
  if (Number(year) === 2026 && group === 'ot') {
    return CFM_2026_OT_WEEKLY_BLOCKS[weekNumber] || null;
  }
  return null;
}

function getVerseIdsForWeeklyBlock(db, block) {
  if (!block) return [];
  const rows = db.prepare(`
    SELECT verse_id
    FROM scriptures
    WHERE lower(book_title) = lower(?)
      AND chapter_number BETWEEN ? AND ?
    ORDER BY verse_id
  `).all(block.book, Number(block.chapterStart), Number(block.chapterEnd));
  return rows.map(r => r.verse_id);
}

// ── Verse of the Day ────────────────────────────────────────────────────────
// Picks a different verse each day from the Come Follow Me weekly block.
// Each day within the same week gets a unique verse; new week → new block.
function getVerseOfTheDay(db, now = new Date()) {
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 0);
  const dayOfYear = Math.floor(
    (Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) - start) / 86400000
  );
  const weekOfYear = Math.floor((dayOfYear - 1) / 7);
  const weekNumber = weekOfYear + 1;
  const dayOfWeek = now.getUTCDay(); // 0=Sun … 6=Sat
  const cfmGroup = getComeFollowMeGroupForYear(year);
  const weeklyBlock = getComeFollowMeWeeklyBlock(year, cfmGroup, weekNumber);

  const LCG_A = 1664525, LCG_C = 1013904223, MOD = 2 ** 32;
  // Week seed determines the starting offset; day seed shifts within the pool
  const weekSeed = ((LCG_A * (weekOfYear + year) + LCG_C) % MOD + MOD) % MOD;
  const daySeed = ((LCG_A * (dayOfYear + year * 366) + LCG_C) % MOD + MOD) % MOD;

  // Build CFM-year candidate pool from curated ids.
  const placeholders = VOTD_POOL.map(() => '?').join(',');
  const poolRows = db.prepare(`
    SELECT verse_id, volume_id, book_title
    FROM scriptures
    WHERE verse_id IN (${placeholders})
  `).all(...VOTD_POOL);
  const cfmPool = poolRows
    .filter(r => isVerseInComeFollowMeGroup(r, cfmGroup))
    .map(r => r.verse_id);

  const weeklyBlockPool = getVerseIdsForWeeklyBlock(db, weeklyBlock);

  let activePool, poolId;
  if (weeklyBlockPool.length) {
    // CFM block available — pick a unique verse for each day of the week.
    // Stride through the pool using weekSeed as base offset + dayOfWeek as step.
    activePool = weeklyBlockPool;
    const baseIdx = weekSeed % activePool.length;
    // Use a secondary stride so each day lands on a different verse
    const stride = Math.max(1, Math.floor(activePool.length / 7));
    poolId = activePool[(baseIdx + dayOfWeek * stride + daySeed) % activePool.length];
  } else {
    // No CFM block — use cfmPool or full VOTD_POOL with daily rotation
    activePool = cfmPool.length ? cfmPool : VOTD_POOL;
    poolId = activePool[daySeed % activePool.length];
  }

  const verse = db.prepare(`
    SELECT book_id, book_title, chapter_id, chapter_number, verse_number,
           scripture_text, verse_title, verse_id, volume_id
    FROM scriptures WHERE verse_id = ?
  `).get(poolId);

  if (verse) {
    return {
      ...verse,
      date: now.toISOString().slice(0, 10),
      version_citation: getVersionCitation('en', verse.volume_id),
      cfm_group: cfmGroup,
      cfm_week: weekNumber,
      cfm_block: weeklyBlock?.label || null,
    };
  }

  // Fallback — deterministic verse from full canon
  const countRow = db.prepare('SELECT COUNT(*) AS total FROM scriptures').get();
  const total    = countRow?.total || 41995;
  const fallback = db.prepare(`
    SELECT book_id, book_title, chapter_id, chapter_number, verse_number,
           scripture_text, verse_title, verse_id, volume_id
    FROM scriptures WHERE verse_id = ?
  `).get((daySeed % total) + 1);

  if (!fallback) return null;
  return {
    ...fallback,
    date: now.toISOString().slice(0, 10),
    version_citation: getVersionCitation('en', fallback.volume_id),
    cfm_group: cfmGroup,
    cfm_week: weekNumber,
    cfm_block: weeklyBlock?.label || null,
  };
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
  getComeFollowMeGroupForYear,
  topicSearch,

  // Re-export data for consumers that need raw access
  BOOK_ABBREVIATIONS,
  CANONICAL_BOOK_IDS,
  BIBLE_CITATIONS,
  TRIPLE_CITATIONS,
  LANGUAGE_NAMES,
  VOTD_POOL,
  MAX_COUNT_SCAN,
};
