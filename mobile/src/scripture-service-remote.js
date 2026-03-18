/**
 * scripture-service-remote.js — Server-backed scripture service for online mode.
 *
 * Mirrors the same API as scripture-service.js (local/offline) but fetches
 * everything from the backend HTTP API, giving the mobile app the same
 * intelligence (embeddings, MMR, semantic search) as Electron/web.
 */

let _baseUrl = '';

/** Set the server base URL (called once when switching to online mode). */
export function setServerUrl(url) {
  _baseUrl = (url || '').replace(/\/+$/, '');
}

export function getServerUrl() { return _baseUrl; }

async function api(path, fallback) {
  if (!_baseUrl) return fallback;
  try {
    const res = await fetch(`${_baseUrl}${path}`);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function search(query, page = 0, pageSize = 10, language = 'en') {
  return api(
    `/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&language=${language}`,
    { results: [], total: 0, page, pageSize }
  );
}
// Note: actual search goes through socket.emit('search') — this is a fallback.

// ── Browse ──────────────────────────────────────────────────────────────────

export async function browse(type, params = {}, language = 'en') {
  if (type === 'books') {
    return api(`/browse/books?language=${language}`, []);
  }
  if (type === 'chapters') {
    return api(`/browse/chapters?book_id=${params.bookId}&language=${language}`, []);
  }
  if (type === 'verses') {
    return api(`/browse/verses?chapter_id=${params.chapterId}&language=${language}`, []);
  }
  return [];
}

// ── Adjacent ────────────────────────────────────────────────────────────────

export async function getAdjacent(source, direction, language = 'en') {
  const qs = new URLSearchParams({
    verse_id: String(source.verse_id || ''),
    direction,
    language,
    ...(source.book_id ? { book_id: String(source.book_id) } : {}),
    ...(source.chapter_number ? { chapter_number: String(source.chapter_number) } : {}),
    ...(source.verse_number ? { verse_number: String(source.verse_number) } : {}),
  });
  return api(`/verse/adjacent?${qs}`, null);
}

// ── Chapter Summary (includes footnotes) ────────────────────────────────────

export async function getChapterSummary(chapterId) {
  const data = await api(
    `/chapter/${chapterId}/summary`,
    { summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false }
  );
  return {
    summary_text:    data.summary_text ?? null,
    summary_method:  data.summary_method ?? 'extractive',
    key_verses:      data.key_verses ?? [],
    top_topics:      data.top_topics ?? [],
    nabre_footnotes: data.nabre_footnotes ?? null,
    net_footnotes:   data.net_footnotes ?? null,
    ready:           data.ready ?? false,
  };
}

// ── Chapter Footnotes (standalone — backend bundles into summary, but keep parity) ──

export async function getChapterFootnotes(chapterId) {
  const data = await api(
    `/chapter/${chapterId}/summary`,
    { nabre_footnotes: null, net_footnotes: null }
  );
  return { nabre_footnotes: data.nabre_footnotes ?? null, net_footnotes: data.net_footnotes ?? null };
}

// ── Chapter Entities ────────────────────────────────────────────────────────

export async function getChapterEntities(chapterId) {
  return api(
    `/chapter/${chapterId}/entities`,
    { people: [], places: [], ready: false }
  );
}

// ── Verse Summary + Cross References ────────────────────────────────────────

export async function getVerseSummary(verseId) {
  return api(
    `/verse/${verseId}/summary`,
    { summary: null, cross_references: [], ready: false }
  );
}

// ── Related Verses ──────────────────────────────────────────────────────────

export async function getRelated(verseId, language = 'en') {
  const data = await api(
    `/verse/${verseId}/related?language=${language}&pageSize=20`,
    { results: [], matchedConcept: null, total: 0 }
  );
  return {
    results:        data.results ?? [],
    matchedConcept: data.matchedConcept ?? null,
    total:          data.total ?? 0,
  };
}

// ── Verse Tags ──────────────────────────────────────────────────────────────

export async function getVerseTags(verseId) {
  return api(
    `/verse/${verseId}/tags`,
    { pov: null, labels: [], speaker: null, ready: false }
  );
}

// ── Verse by ID (for language switching) ────────────────────────────────────

export async function getVerse(params, language = 'en') {
  if (!params?.verse_id) return null;
  return api(
    `/verse/${params.verse_id}/translation?language=${language}`,
    null
  );
}

// ── Entity Search (disambiguated) ───────────────────────────────────────────

export async function searchEntityDisambiguated(name, type = 'person', verseId = null, entityId = null, page = 0, pageSize = 10) {
  const qs = new URLSearchParams({
    name,
    type,
    page: String(page),
    pageSize: String(pageSize),
    ...(verseId ? { verse_id: String(verseId) } : {}),
    ...(entityId ? { entity_id: entityId } : {}),
  });
  return api(
    `/entity/search?${qs}`,
    { results: [], total: 0, name, type, groups: [] }
  );
}

// ── Sermon / Topic Search ───────────────────────────────────────────────────

export async function searchSermonTopics(query, limit = 12) {
  const data = await api(
    `/sermon-search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { results: [] }
  );
  return data.results ?? [];
}

// ── Verse of the Day ────────────────────────────────────────────────────────

export async function verseOfTheDay() {
  return api('/verse/of-the-day', null);
}

// ── Language helpers (passthrough — these are always local) ──────────────────

export function getLoadedLanguages() {
  // Online mode has all server languages available
  return ['en', 'tl', 'ceb', 'es', 'el', 'ilo', 'ja', 'nrsvue', 'war'];
}
