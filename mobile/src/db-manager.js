/**
 * db-manager.js — Initializes sql.js (WASM) and loads all 9 scripture databases.
 *
 * Usage:
 *   import { getDb } from './db-manager';
 *   const db = await getDb('en');        // English (LDS)
 *   const db = await getDb('tl');        // Tagalog
 */
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

// Map language codes to DB filenames (matches resources/db/)
const DB_FILES = {
  en:     'lds-scriptures-sqlite.db',
  tl:     'tagalog-scriptures-sqlite.db',
  ceb:    'cebuano-scriptures-sqlite.db',
  es:     'spanish-scriptures-sqlite.db',
  el:     'greek-scriptures-sqlite.db',
  ilo:    'ilocano-scriptures-sqlite.db',
  ja:     'japanese-scriptures-sqlite.db',
  nrsvue: 'nrsvue-scriptures-sqlite.db',
  war:    'waray-scriptures-sqlite.db',
};

let SQL = null;
const databases = new Map();
let initPromise = null;
const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
const isFileScheme = typeof window !== 'undefined' && window.location?.protocol === 'file:';

function resolveAssetUrl(file) {
  if (isFileScheme) return new URL(file, window.location.href).toString();
  return `${baseUrl}${String(file).replace(/^\/+/, '')}`;
}

/**
 * Initialize sql.js WASM engine (once).
 */
async function initEngine() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    // Use Vite-managed URL so packaged mobile builds resolve the WASM reliably.
    locateFile: (file) => (file.endsWith('.wasm') ? sqlWasmUrl : resolveAssetUrl(file)),
  });
  return SQL;
}

/**
 * Load a single database from the bundled assets.
 * Returns a sql.js Database instance.
 */
async function loadDatabase(filename) {
  const url = resolveAssetUrl(`assets/db/${filename}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Failed to fetch DB: ${filename} (${response.status})`);
    return null;
  }
  const buffer = await response.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer));
}

/**
 * Initialize all databases. Call once at app startup.
 * Loads DBs in parallel for speed.
 */
export async function initAllDatabases() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await initEngine();
    const entries = Object.entries(DB_FILES);
    const results = await Promise.allSettled(
      entries.map(async ([lang, filename]) => {
        const db = await loadDatabase(filename);
        if (db) databases.set(lang, db);
        return { lang, ok: !!db };
      })
    );
    // Also load topical-guide.db (optional — graceful if absent)
    try {
      const tg = await loadDatabase('topical-guide.db');
      if (tg) databases.set('tg', tg);
    } catch (_) {}
    // Also load verse-tags.db (pre-baked NLP — optional, graceful if absent)
    try {
      const tags = await loadDatabase('verse-tags.db');
      if (tags) databases.set('tags', tags);
    } catch (_) {}
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value.ok);
    console.log(`db-manager: loaded ${loaded.length}/${entries.length} databases`);
    return databases;
  })();
  return initPromise;
}

/**
 * Get a loaded sql.js Database for a language code.
 * Falls back to English ('en') if the requested language isn't available.
 */
export function getDb(language) {
  return databases.get(language) || databases.get('en') || null;
}

/**
 * Get all loaded language codes.
 */
export function getLoadedLanguages() {
  return [...databases.keys()];
}

/**
 * Check if databases have been initialized.
 */
export function isReady() {
  return databases.size > 0;
}
