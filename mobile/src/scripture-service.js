/**
 * scripture-service.js — Offline scripture engine for the mobile app.
 *
 * Wraps the shared/scripture-engine functions with SqlJsAdapter instances
 * loaded from db-manager.js. Provides a clean async API for MobilePresenter.
 */
import { getDb, getLoadedLanguages, initAllDatabases, isReady } from './db-manager';
import { SqlJsAdapter } from '@shared/db-adapter';
import {
  segmentVerseText,
  segmentVerseTextDual,
  parseScriptureReference,
  searchScripture,
  searchScriptureInDb,
  topicSearch,
  phraseSearch,
  getAdjacentVerse,
  fetchVerseByCoords,
  browseBooks,
  browseChapters,
  browseVerses,
  getVersionCitation,
  getVerseOfTheDay,
  LANGUAGE_NAMES,
  VOTD_POOL,
} from '@shared/scripture-engine';

/** Resolve the SqlJsAdapter for a given language code. */
function resolveAdapter(language) {
  const rawDb = getDb(language);
  if (!rawDb) return null;
  return new SqlJsAdapter(rawDb);
}

/** Ensure DBs are loaded before any query. */
export async function init() {
  if (!isReady()) {
    await initAllDatabases();
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

export function search(query, page = 0, pageSize = 10, language = 'en') {
  const adapter = resolveAdapter(language);
  if (!adapter) return { results: [], total: 0, page, pageSize };

  const log = { info: () => {}, warn: console.warn, error: console.error };

  // For short English queries (1-7 words), try Topical Guide first (TG topic names go up to 7 words)
  if (language === 'en') {
    const words = query.trim().split(/\s+/);
    if (words.length >= 1 && words.length <= 7) {
      const tgRaw = getDb('tg');
      if (tgRaw) {
        const tgAdapter = new SqlJsAdapter(tgRaw);
        const tgResult = topicSearch(query, page, pageSize, tgAdapter, adapter);
        if (tgResult && tgResult.total > 0) return { ...tgResult, page, pageSize };
      }
    }
    return searchScripture(query, page, pageSize, adapter, log);
  }
  return searchScriptureInDb(query, page, pageSize, adapter, log);
}

// ── Browse ──────────────────────────────────────────────────────────────────

export function browse(type, params, language = 'en') {
  const adapter = resolveAdapter(language);
  if (!adapter) return [];

  switch (type) {
    case 'books':    return browseBooks(adapter);
    case 'chapters': return browseChapters(adapter, params.bookId);
    case 'verses':   return browseVerses(adapter, params.chapterId);
    default:         return [];
  }
}

// ── Verse fetch ─────────────────────────────────────────────────────────────

export function getVerse(verse, language = 'en') {
  const adapter = resolveAdapter(language);
  if (!adapter) return null;
  return fetchVerseByCoords(
    adapter, verse,
    'scripture_text, verse_title, book_title, volume_title, volume_short_title'
  );
}

export function getAdjacent(verse, direction, language = 'en') {
  const adapter = resolveAdapter(language);
  if (!adapter) return null;
  return getAdjacentVerse({ ...verse, direction }, adapter);
}

// ── Related Verses (TG topic overlap, offline) ──────────────────────────────

export function getRelated(verseId, language = 'en') {
  const engAdapter = resolveAdapter('en');
  if (!engAdapter) return { results: [], matchedConcept: null };
  const tgRaw = getDb('tg');
  if (!tgRaw) return { results: [], matchedConcept: null };
  const tgAdapter = new SqlJsAdapter(tgRaw);

  // Get topics for this verse
  const liveTopicRows = tgAdapter.prepare(
    'SELECT t.slug, t.name FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE tg.verse_id = ? AND tg.verse_id != -1'
  ).all(verseId);
  if (!liveTopicRows.length) {
    // No TG coverage — FTS phrase fallback
    const meta = engAdapter.prepare('SELECT scripture_text FROM scriptures WHERE verse_id = ? LIMIT 1').get(verseId);
    if (!meta) return { results: [], matchedConcept: null };
    const phrase = meta.scripture_text.split(/\s+/).slice(0, 8).join(' ');
    const log = { info: () => {}, warn: () => {}, error: console.error };
    const { results } = phraseSearch(phrase, 0, 12, engAdapter, log);
    return { results: results.filter(r => r.verse_id !== verseId), matchedConcept: null, fallback: true };
  }

  const liveSlugs = new Set(liveTopicRows.map(r => r.slug));
  const matchedConcept = liveTopicRows[0]?.name ?? null;

  // For each topic, fetch all verse_ids
  const scoreMap = new Map();
  for (const { slug } of liveTopicRows) {
    const peers = tgAdapter.prepare(
      'SELECT tg.verse_id FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE t.slug = ? AND tg.verse_id IS NOT NULL AND tg.verse_id != -1'
    ).all(slug);
    for (const { verse_id: vid } of peers) {
      if (vid === verseId) continue;
      scoreMap.set(vid, (scoreMap.get(vid) ?? 0) + 1);
    }
  }

  // Sort by overlap count desc, take top 12
  const sorted = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const stmt = engAdapter.prepare(
    'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
  );
  const results = sorted.map(([vid, overlap]) => {
    const row = stmt.get(vid);
    if (!row) return null;
    // Find shared topic name
    const shared = tgAdapter.prepare(
      'SELECT t.name FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE tg.verse_id = ? AND t.slug IN (' + [...liveSlugs].map(() => '?').join(',') + ') LIMIT 1'
    ).get(vid, ...[...liveSlugs]);
    return { ...row, matched_concept: shared?.name ?? null, similarity_score: +(overlap / liveSlugs.size).toFixed(4) };
  }).filter(Boolean);

  // Translate if needed
  if (language !== 'en') {
    const transAdapter = resolveAdapter(language);
    if (transAdapter) {
      return {
        results: results.map(v => {
          const trans = transAdapter.prepare('SELECT scripture_text FROM scriptures WHERE verse_id = ? LIMIT 1').get(v.verse_id);
          return trans ? { ...v, scripture_text: trans.scripture_text } : v;
        }),
        matchedConcept,
      };
    }
  }
  return { results, matchedConcept };
}

// ── Verse of the Day ────────────────────────────────────────────────────────

export function verseOfTheDay() {
  const adapter = resolveAdapter('en');
  if (!adapter) return null;
  return getVerseOfTheDay(adapter);
}

// ── NLP / Tags ──────────────────────────────────────────────────────────────

export function getVerseTags(verseId) {
  const tagsDb = getDb('tags');
  if (!tagsDb) return { pov: null, labels: [], ready: false };
  try {
    const rows = tagsDb.exec('SELECT pov, labels_json, speaker FROM verse_doctrine_tags WHERE verse_id = ?', [verseId]);
    if (!rows.length || !rows[0].values.length) return { pov: null, labels: [], speaker: null, ready: false };
    const [pov, labelsJson, speaker] = rows[0].values[0];
    return { pov: pov || null, labels: JSON.parse(labelsJson || '[]'), speaker: speaker || null, ready: true };
  } catch { return { pov: null, labels: [], ready: false }; }
}

export function getChapterSummary(chapterId) {
  const tagsDb = getDb('tags');
  if (!tagsDb) return { summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false };
  try {
    const rows = tagsDb.exec('SELECT summary_text, summary_method, key_verses_json, top_topics_json FROM chapter_summaries WHERE chapter_id = ?', [chapterId]);
    if (!rows.length || !rows[0].values.length) return { summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false };
    const [summary_text, summary_method, keyVersesJson, topTopicsJson] = rows[0].values[0];
    return {
      summary_text,
      summary_method: summary_method || 'extractive',
      key_verses: JSON.parse(keyVersesJson || '[]'),
      top_topics: JSON.parse(topTopicsJson || '[]'),
      ready: true,
    };
  } catch { return { summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false }; }
}

export function getChapterEntities(chapterId) {
  const tagsDb = getDb('tags');
  const enDb   = getDb('en');
  if (!tagsDb || !enDb) return { people: [], places: [], ready: false };
  try {
    // Get all verse_ids for this chapter from the English scripture DB
    const vRows = enDb.exec('SELECT id FROM verses WHERE chapter_id = ?', [chapterId]);
    if (!vRows.length) return { people: [], places: [], ready: true };
    const verseIds = vRows[0].values.map(r => r[0]);
    const peopleSet = new Set(), placesSet = new Set();
    for (const vid of verseIds) {
      const eRows = tagsDb.exec('SELECT people, places FROM verse_entities WHERE verse_id = ?', [vid]);
      if (!eRows.length || !eRows[0].values.length) continue;
      const [people, places] = eRows[0].values[0];
      if (people) people.split('|').forEach(p => { const n = p.trim().replace(/[,;.!?]+$/, '').trim(); if (n) peopleSet.add(n); });
      if (places) places.split('|').forEach(p => { const n = p.trim().replace(/[,;.!?]+$/, '').trim(); if (n) placesSet.add(n); });
    }
    return { people: [...peopleSet].sort(), places: [...placesSet].sort(), ready: true };
  } catch { return { people: [], places: [], ready: false }; }
}

export function searchEntities(name, type = 'person') {
  const tagsDb = getDb('tags');
  const engAdapter = resolveAdapter('en');
  if (!tagsDb || !engAdapter) return { results: [], total: 0, name, type };
  try {
    const col = type === 'place' ? 'places' : 'people';
    const key = name.toLowerCase();
    const rows = tagsDb.exec(
      `SELECT verse_id FROM verse_entities WHERE lower(${col}) LIKE ?`,
      [`%${key}%`]
    );
    if (!rows.length || !rows[0].values.length) return { results: [], total: 0, name, type };
    const verseIds = rows[0].values.map(r => r[0]);
    const total = verseIds.length;
    const stmt = engAdapter.prepare(
      'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number FROM scriptures WHERE verse_id = ?'
    );
    const results = verseIds.slice(0, 20).map(vid => stmt.get(vid)).filter(Boolean);
    return { results, total, name, type };
  } catch { return { results: [], total: 0, name, type }; }
}

export function searchSermonTopics(query, limit = 15) {
  const tagsDb = getDb('tags');
  const engAdapter = resolveAdapter('en');
  if (!tagsDb || !engAdapter) return [];
  try {
    const term = query.trim().toLowerCase();
    const rows = tagsDb.exec(
      `SELECT chapter_id, book_id, chapter_num, summary_text, top_topics_json
       FROM chapter_summaries
       WHERE lower(summary_text) LIKE ? OR lower(top_topics_json) LIKE ?
       LIMIT ?`,
      [`%${term}%`, `%${term}%`, limit]
    );
    if (!rows.length || !rows[0].values.length) return [];
    const stmt = engAdapter.prepare('SELECT book_title FROM scriptures WHERE book_id = ? LIMIT 1');
    return rows[0].values.map(([chapterId, bookId, chapterNum, summaryText, topTopicsJson]) => {
      const meta = stmt.get(bookId);
      return {
        chapter_id:   chapterId,
        book_id:      bookId,
        chapter_num:  chapterNum,
        book_title:   meta?.book_title || '',
        summary_text: summaryText || '',
        top_topics:   JSON.parse(topTopicsJson || '[]').slice(0, 5),
      };
    });
  } catch { return []; }
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export {
  segmentVerseText,
  segmentVerseTextDual,
  parseScriptureReference,
  getVersionCitation,
  LANGUAGE_NAMES,
  VOTD_POOL,
  getLoadedLanguages,
};
