/**
 * db-manager.js — Initializes sql.js (WASM) and manages scripture databases.
 *
 * Core DBs (English + intelligence + context) are bundled in the APK.
 * Non-English scripture DBs are downloaded on demand and cached in IndexedDB.
 *
 * Usage:
 *   import { getDb, downloadLanguage } from './db-manager';
 *   const db = getDb('en');               // English — always available
 *   await downloadLanguage('tl');          // Download Tagalog on demand
 *   const db = getDb('tl');               // Now available
 */
import initSqlJs from 'fts5-sql-bundle/dist/sql-wasm.js';
import sqlWasmUrl from 'fts5-sql-bundle/dist/sql-wasm.wasm?url';

// All known language codes → DB filenames
const ALL_LANG_FILES = {
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

// Only English is bundled in the APK — other languages are on-demand
const BUNDLED_LANGS = new Set(['en']);

// IndexedDB store for cached downloaded databases
const IDB_NAME = 'scicp-db-cache';
const IDB_STORE = 'databases';
const IDB_VERSION = 1;

let SQL = null;
const databases = new Map();
let initPromise = null;
const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
const isFileScheme = typeof window !== 'undefined' && window.location?.protocol === 'file:';

// Download state tracking: lang → { status: 'idle'|'downloading'|'ready'|'error', progress: 0-100 }
const downloadState = new Map();
const downloadListeners = new Set();

function resolveAssetUrl(file) {
  if (isFileScheme) return new URL(file, window.location.href).toString();
  return `${baseUrl}${String(file).replace(/^\/+/, '')}`;
}

// ── IndexedDB helpers ───────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbKeys() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ── State notification ──────────────────────────────────────────────────────
function notifyListeners() {
  for (const fn of downloadListeners) {
    try { fn(getDownloadStates()); } catch {}
  }
}

function setLangState(lang, status, progress = 0) {
  downloadState.set(lang, { status, progress });
  notifyListeners();
}

/** Subscribe to download state changes. Returns unsubscribe function. */
export function onDownloadStateChange(fn) {
  downloadListeners.add(fn);
  return () => downloadListeners.delete(fn);
}

/** Get download states for all languages. */
export function getDownloadStates() {
  const states = {};
  for (const lang of Object.keys(ALL_LANG_FILES)) {
    if (databases.has(lang)) {
      states[lang] = { status: 'ready', progress: 100 };
    } else {
      states[lang] = downloadState.get(lang) || { status: 'idle', progress: 0 };
    }
  }
  return states;
}

// ── Engine & loading ────────────────────────────────────────────────────────

async function initEngine() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: (file) => (file.endsWith('.wasm') ? sqlWasmUrl : resolveAssetUrl(file)),
  });
  return SQL;
}

/** Load a DB from the bundled assets. */
async function loadDatabase(filename) {
  const url = resolveAssetUrl(`assets/db/${filename}`);
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    console.warn(`db-manager: fetch error for ${filename} (${url}):`, e.message);
    return null;
  }
  if (!response.ok) {
    console.warn(`db-manager: failed to fetch ${filename} (${url}) — HTTP ${response.status}`);
    return null;
  }
  const buffer = await response.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer));
}

/** Load a DB from an ArrayBuffer (e.g. from IndexedDB cache). */
function loadDatabaseFromBuffer(buffer) {
  return new SQL.Database(new Uint8Array(buffer));
}

/**
 * Initialize core databases at startup.
 * Loads bundled English + intelligence + context DBs.
 * Also restores any previously downloaded language DBs from IndexedDB.
 */
export async function initAllDatabases() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await initEngine();

    // Load bundled English DB
    const entries = Object.entries(ALL_LANG_FILES).filter(([lang]) => BUNDLED_LANGS.has(lang));
    const results = await Promise.allSettled(
      entries.map(async ([lang, filename]) => {
        const db = await loadDatabase(filename);
        if (db) databases.set(lang, db);
        return { lang, ok: !!db };
      })
    );

    // Load bundled intelligence & context DBs
    // Only load light DBs eagerly on mobile (Capacitor WebView has limited memory).
    // Heavy DBs (verse-summaries, verse-tags, search-graph, vxref, footnotes) are
    // lazy-loaded on first use to avoid OOM crashes on Android devices.
    const isCapacitorNative = typeof window !== 'undefined' &&
      window?.Capacitor?.isNativePlatform?.();
    const optionalBundled = isCapacitorNative
      ? [
          ['tg',        'topical-guide.db'],
          ['chsummary', 'chapter-summaries-fts.db'],
        ]
      : [
          ['tg',          'topical-guide.db'],
          ['tags',        'verse-tags.db'],
          ['chsummary',   'chapter-summaries-fts.db'],
          ['vsummary',    'verse-summaries.db'],
          ['vxref',       'verse-cross-refs.db'],
          ['searchgraph', 'search-graph.db'],
          ['footnotes',   'footnotes-lds-summaries.db'],
        ];
    await Promise.allSettled(optionalBundled.map(async ([key, filename]) => {
      try {
        const db = await loadDatabase(filename);
        if (db) databases.set(key, db);
      } catch (e) { console.warn(`db-manager: optional DB ${filename} failed:`, e.message); }
    }));

    // Restore previously downloaded language DBs from IndexedDB
    try {
      const cachedKeys = await idbKeys();
      const langKeys = cachedKeys.filter(k => typeof k === 'string' && k.startsWith('lang:'));
      await Promise.allSettled(langKeys.map(async (key) => {
        const lang = key.replace('lang:', '');
        if (databases.has(lang)) return; // already loaded (bundled)
        try {
          const buffer = await idbGet(key);
          if (buffer) {
            const db = loadDatabaseFromBuffer(buffer);
            databases.set(lang, db);
            setLangState(lang, 'ready', 100);
          }
        } catch (e) { console.warn(`db-manager: cached ${lang} restore failed:`, e.message); }
      }));
    } catch (e) { console.warn('db-manager: IDB restore failed:', e.message); }

    const loaded = results.filter(r => r.status === 'fulfilled' && r.value.ok);
    console.log(`db-manager: loaded ${loaded.length} bundled + ${databases.size - loaded.length} cached databases`);

    // English DB is mandatory — if it failed, throw so callers know init failed
    if (!databases.has('en')) {
      throw new Error('Failed to load English scripture database. The app cannot function without it.');
    }

    return databases;
  })();
  // If init fails, clear the cached promise so the next call retries
  initPromise.catch(() => { initPromise = null; });
  return initPromise;
}

// ── On-demand language download ─────────────────────────────────────────────

/** Get the server URL for downloading language DBs. */
function getDbDownloadUrl() {
  // Use the online server URL if available, otherwise fall back to bundled
  try {
    return (localStorage.getItem('scicp.server_url') || '').replace(/\/+$/, '');
  } catch { return ''; }
}

/**
 * Download a language database on demand.
 * Fetches from the server, caches in IndexedDB, and loads into sql.js.
 * @param {string} lang — language code (e.g. 'tl', 'ceb', 'es')
 * @param {string} [serverUrl] — override server URL
 * @returns {Promise<boolean>} true if successfully loaded
 */
export async function downloadLanguage(lang, serverUrl) {
  if (databases.has(lang)) return true; // already loaded
  const filename = ALL_LANG_FILES[lang];
  if (!filename) return false;

  // If bundled, just load from assets
  if (BUNDLED_LANGS.has(lang)) {
    await initEngine();
    const db = await loadDatabase(filename);
    if (db) { databases.set(lang, db); setLangState(lang, 'ready', 100); return true; }
    return false;
  }

  // Try loading from IndexedDB cache first
  try {
    const cached = await idbGet(`lang:${lang}`);
    if (cached && cached.byteLength > 1024) { // sanity check — must be non-trivial size
      await initEngine();
      const db = loadDatabaseFromBuffer(cached);
      databases.set(lang, db);
      setLangState(lang, 'ready', 100);
      return true;
    } else if (cached) {
      // Cached data is corrupt/truncated — delete it and re-download
      await idbDelete(`lang:${lang}`).catch(() => {});
    }
  } catch {}

  // Download from server (with retry)
  const base = serverUrl || getDbDownloadUrl();
  if (!base) {
    try {
      await initEngine();
      const db = await loadDatabase(filename);
      if (db) { databases.set(lang, db); setLangState(lang, 'ready', 100); return true; }
    } catch {}
    setLangState(lang, 'error');
    return false;
  }

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    setLangState(lang, 'downloading', 0);
    try {
      const url = `${base}/db/${filename}`;
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout
      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(fetchTimeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      let received = 0;
      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setLangState(lang, 'downloading', Math.round((received / contentLength) * 100));
        }
      }

      // Combine chunks — verify we got a reasonable amount of data
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      if (totalLength < 1024) throw new Error(`Downloaded DB too small (${totalLength} bytes) — likely truncated`);

      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }

      // Verify SQLite header before caching
      const magic = String.fromCharCode(...combined.slice(0, 6));
      if (magic !== 'SQLite') throw new Error('Downloaded file is not a valid SQLite database');

      // Cache in IndexedDB — failures here should not block loading
      try {
        await idbPut(`lang:${lang}`, combined.buffer);
      } catch (idbErr) {
        console.warn(`db-manager: IndexedDB cache write failed for ${lang}:`, idbErr.message);
        // Continue — the DB is still usable this session even without being cached
      }

      // Load into sql.js
      await initEngine();
      const db = new SQL.Database(combined);
      databases.set(lang, db);
      setLangState(lang, 'ready', 100);
      return true;
    } catch (err) {
      console.warn(`db-manager: download ${lang} attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 2s, 4s
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }

  setLangState(lang, 'error');
  return false;
}

/**
 * Remove a downloaded language from IndexedDB cache.
 * @param {string} lang — language code
 */
export async function removeLanguage(lang) {
  if (BUNDLED_LANGS.has(lang)) return; // can't remove bundled
  try {
    await idbDelete(`lang:${lang}`);
    if (databases.has(lang)) {
      databases.get(lang).close?.();
      databases.delete(lang);
    }
    setLangState(lang, 'idle', 0);
  } catch {}
}

/**
 * Check if a language is available (loaded in memory).
 */
export function isLanguageAvailable(lang) {
  return databases.has(lang);
}

/**
 * Check if a language is bundled (always available without download).
 */
export function isLanguageBundled(lang) {
  return BUNDLED_LANGS.has(lang);
}

/** Get all known language codes and their DB filenames. */
export function getAllLanguages() {
  return { ...ALL_LANG_FILES };
}

// ── Core exports ────────────────────────────────────────────────────────────

export function getDb(language) {
  return databases.get(language) || databases.get('en') || null;
}

export function getLoadedLanguages() {
  return [...databases.keys()];
}

export function isReady() {
  return databases.has('en');
}

let embeddingsPromise = null;
/**
 * Lazy-load verse-embeddings.db (~83MB). Called on first search that needs it.
 * Returns the sql.js Database or null.
 */
export async function loadEmbeddingsDb() {
  if (databases.has('embeddings')) return databases.get('embeddings');
  if (embeddingsPromise) return embeddingsPromise;
  embeddingsPromise = (async () => {
    try {
      await initEngine();
      const emb = await loadDatabase('verse-embeddings.db');
      if (emb) { databases.set('embeddings', emb); return emb; }
    } catch (err) {
      console.warn('db-manager: verse-embeddings.db load failed:', err.message);
    }
    return null;
  })();
  return embeddingsPromise;
}
