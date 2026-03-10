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

  if (language === 'en') {
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
  return getAdjacentVerse(adapter, verse, direction);
}

// ── Verse of the Day ────────────────────────────────────────────────────────

export function verseOfTheDay() {
  const adapter = resolveAdapter('en');
  if (!adapter) return null;
  return getVerseOfTheDay(adapter);
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
