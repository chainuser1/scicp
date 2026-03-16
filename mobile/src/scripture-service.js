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

/**
 * Enhanced search using Reciprocal Rank Fusion (RRF) across multiple sources.
 * Sources: FTS5 (BM25), Topical Guide, Entity Index, Chapter Summaries
 * Falls back to simple FTS if search-graph.db unavailable.
 */
export function search(query, page = 0, pageSize = 10, language = 'en') {
  const adapter = resolveAdapter(language);
  if (!adapter) return { results: [], total: 0, page, pageSize };

  const log = { info: () => {}, warn: console.warn, error: console.error };

  // Non-English: basic FTS only (no search graph for translations)
  if (language !== 'en') {
    return searchScriptureInDb(query, page, pageSize, adapter, log);
  }

  const sgDb = getDb('searchgraph');
  const tgRaw = getDb('tg');

  // If no search graph, use legacy TG-first + FTS fallback
  if (!sgDb) {
    const words = query.trim().split(/\s+/);
    if (words.length >= 1 && words.length <= 7 && tgRaw) {
      const tgAdapter = new SqlJsAdapter(tgRaw);
      const tgResult = topicSearch(query, page, pageSize, tgAdapter, adapter);
      if (tgResult && tgResult.total > 0) return { ...tgResult, page, pageSize };
    }
    return searchScripture(query, page, pageSize, adapter, log);
  }

  // ── Enhanced RRF Pipeline ──

  // Detect significant phrases (n-grams) in query using LLR bigram chaining
  // Chains overlapping significant bigrams into longer phrases
  const detectedPhrases = [];
  try {
    const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    if (words.length >= 2) {
      // Find which adjacent bigrams are significant
      const sigBigrams = [];
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = words[i] + ' ' + words[i + 1];
        let sig = false;
        try {
          const llrRows = sgDb.exec('SELECT llr FROM term_llr WHERE term = ?', [bigram]);
          if (llrRows.length && llrRows[0].values.length && llrRows[0].values[0][0] > 10) sig = true;
        } catch {}
        sigBigrams.push(sig);
      }
      // Chain overlapping significant bigrams into longer phrases
      let chainStart = -1;
      for (let i = 0; i <= sigBigrams.length; i++) {
        if (i < sigBigrams.length && sigBigrams[i]) {
          if (chainStart === -1) chainStart = i;
        } else {
          if (chainStart !== -1) {
            const chainEnd = i;
            if (chainEnd - chainStart >= 2) {
              detectedPhrases.push(words.slice(chainStart, chainEnd + 1).join(' '));
            }
            for (let j = chainStart; j < chainEnd; j++) {
              detectedPhrases.push(words[j] + ' ' + words[j + 1]);
            }
            chainStart = -1;
          }
        }
      }
      // Always try full query as exact phrase for 2+ word queries
      const full = words.join(' ');
      if (!detectedPhrases.includes(full)) detectedPhrases.push(full);
    }
  } catch {}

  // PMI expansion: find statistically associated terms (unigrams + bigrams)
  let pmiExpandedQuery = query;
  try {
    const words = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').split(/\s+/).filter(t => t.length > 1);
    const pmiTerms = [];
    // Expand individual words
    for (const w of words) {
      const pmiRows = sgDb.exec(
        'SELECT assoc, pmi FROM term_pmi WHERE term = ? AND cooccur >= 5 AND pmi > 0.15 ORDER BY pmi DESC LIMIT 3',
        [w]
      );
      if (pmiRows.length && pmiRows[0].values.length) {
        for (const [assoc] of pmiRows[0].values) pmiTerms.push(assoc);
      }
    }
    // Expand bigrams (phrase-aware)
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = words[i] + ' ' + words[i + 1];
      const pmiRows = sgDb.exec(
        'SELECT assoc, pmi FROM term_pmi WHERE term = ? AND cooccur >= 3 AND pmi > 0.10 ORDER BY pmi DESC LIMIT 3',
        [bigram]
      );
      if (pmiRows.length && pmiRows[0].values.length) {
        for (const [assoc] of pmiRows[0].values) pmiTerms.push(assoc);
      }
    }
    if (pmiTerms.length > 0) {
      pmiExpandedQuery = [...new Set([...query.split(/\s+/), ...pmiTerms])].join(' ');
    }
  } catch {}

  // Source 1: FTS5 (BM25)
  const ftsResult = searchScripture(query, 0, 50, adapter, log);
  const ftsRanked = (ftsResult.results || []).map((r, i) => ({
    ...r, _source: 'fts', _ftsRank: i,
  }));

  // Source 1b: Exact phrase FTS — separate RRF lane for phrase matches
  const phraseRanked = [];
  if (detectedPhrases.length > 0) {
    const seen = new Set();
    for (const phrase of detectedPhrases) {
      try {
        const phraseQuery = '"' + phrase + '"';
        const phraseResult = searchScripture(phraseQuery, 0, 30, adapter, log);
        for (const r of (phraseResult.results || [])) {
          if (!seen.has(r.verse_id)) {
            phraseRanked.push({ ...r, _source: 'fts-phrase', _ftsRank: phraseRanked.length });
            seen.add(r.verse_id);
          }
        }
      } catch {}
    }
  }

  // PMI-expanded FTS search
  if (pmiExpandedQuery !== query) {
    try {
      const expResult = searchScripture(pmiExpandedQuery, 0, 30, adapter, log);
      const seen = new Set(ftsRanked.map(r => r.verse_id));
      for (const r of (expResult.results || [])) {
        if (!seen.has(r.verse_id)) {
          ftsRanked.push({ ...r, _source: 'fts', _ftsRank: ftsRanked.length });
          seen.add(r.verse_id);
        }
      }
    } catch {}
  }

  // Source 2: Topical Guide
  let tgRanked = [];
  if (tgRaw) {
    const tgAdapter = new SqlJsAdapter(tgRaw);
    const tgResult = topicSearch(query, 0, 30, tgAdapter, adapter);
    tgRanked = (tgResult?.results || []).map((r, i) => ({
      ...r, _source: 'tg', _tgRank: i,
    }));
  }

  // Source 3: Entity search (if query matches a person/place name)
  let entityRanked = [];
  const tagsDb = getDb('tags');
  if (tagsDb) {
    try {
      const key = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      // Check person index in verse-tags
      const personRows = tagsDb.exec(
        'SELECT verse_id FROM entity_person_index WHERE name_normalized LIKE ? LIMIT 15',
        [`%${key}%`]
      );
      if (personRows.length && personRows[0].values.length) {
        const stmt = adapter.prepare(
          'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
        );
        entityRanked = personRows[0].values.map(([vid], i) => {
          const row = stmt.get(vid);
          return row ? { ...row, _source: 'entity', _entityRank: i } : null;
        }).filter(Boolean);
      }
      // Also check places
      if (entityRanked.length === 0) {
        const placeRows = tagsDb.exec(
          'SELECT verse_id FROM entity_place_index WHERE name_normalized LIKE ? LIMIT 15',
          [`%${key}%`]
        );
        if (placeRows.length && placeRows[0].values.length) {
          const stmt = adapter.prepare(
            'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
          );
          entityRanked = placeRows[0].values.map(([vid], i) => {
            const row = stmt.get(vid);
            return row ? { ...row, _source: 'entity', _entityRank: i } : null;
          }).filter(Boolean);
        }
      }
    } catch {}
  }

  // ── Reciprocal Rank Fusion (with per-list weights) ──
  const RRF_K = 60;
  const rrfScores = new Map(); // verse_id → { score, row, sources }
  const allLists = [ftsRanked, phraseRanked, tgRanked, entityRanked];
  const listWeights = [1, 3, 1, 1]; // phraseRanked gets 3x weight

  for (let li = 0; li < allLists.length; li++) {
    const list = allLists[li];
    const w = listWeights[li] || 1;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const vid = item.verse_id;
      const rrf = w / (RRF_K + i + 1);
      if (rrfScores.has(vid)) {
        const entry = rrfScores.get(vid);
        entry.score += rrf;
        entry.sources.add(item._source);
      } else {
        rrfScores.set(vid, { score: rrf, row: item, sources: new Set([item._source]) });
      }
    }
  }

  // Identify matched topic slugs for PPR (phrase-aware)
  let queryTopicSlugs = [];
  if (tgRaw) {
    try {
      const tgAdapter2 = new SqlJsAdapter(tgRaw);
      const normQuery = query.toLowerCase().replace(/[^a-z0-9\-\s]/g, '').trim();
      const normWords = normQuery.split(/\s+/).filter(t => t.length > 1);
      const allTopics = tgAdapter2.prepare('SELECT slug, name FROM topics').all();

      // Phase 1: full query phrase match
      const querySlugified = normQuery.replace(/\s+/g, '-');
      for (const { slug, name } of allTopics) {
        const slugNorm = slug.replace(/-/g, ' ');
        if (slugNorm === normQuery || name.toLowerCase() === normQuery || slug === querySlugified) {
          queryTopicSlugs.push(slug);
        }
      }

      // Phase 2: bigram phrase match
      if (normWords.length >= 2) {
        for (let i = 0; i < normWords.length - 1 && queryTopicSlugs.length < 10; i++) {
          const bigram = normWords[i] + ' ' + normWords[i + 1];
          const bigramSlug = normWords[i] + '-' + normWords[i + 1];
          for (const { slug, name } of allTopics) {
            if (queryTopicSlugs.includes(slug)) continue;
            const slugNorm = slug.replace(/-/g, ' ');
            if (slugNorm.includes(bigram) || name.toLowerCase().includes(bigram) || slug.includes(bigramSlug)) {
              queryTopicSlugs.push(slug);
            }
          }
        }
      }

      // Phase 3: single word fallback (only if no phrase matches)
      if (queryTopicSlugs.length === 0) {
        for (const { slug, name } of allTopics) {
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
    } catch {}
  }

  // Multi-source bonus + PPR + PageRank boost
  for (const [vid, entry] of rrfScores) {
    if (entry.sources.size >= 3) entry.score *= 1.4;
    else if (entry.sources.size >= 2) entry.score *= 1.2;
    // Topic-Personalized PageRank boost
    if (queryTopicSlugs.length > 0) {
      try {
        let bestPpr = 0;
        for (const slug of queryTopicSlugs.slice(0, 5)) {
          const ppr = tgRaw ? tgRaw.exec('SELECT ppr FROM topic_ppr WHERE topic_slug = ? AND verse_id = ?', [slug, vid]) : [];
          if (ppr.length && ppr[0].values.length && ppr[0].values[0][0] > bestPpr) {
            bestPpr = ppr[0].values[0][0];
          }
        }
        if (bestPpr > 0) entry.score += bestPpr * 0.5;
      } catch {}
    }
    // Global PageRank boost
    try {
      const pr = sgDb.exec('SELECT pagerank FROM verse_pagerank WHERE verse_id = ?', [vid]);
      if (pr.length && pr[0].values.length) {
        entry.score += pr[0].values[0][0] * 1000;
      }
    } catch {}
  }

  // Sort by RRF score and apply cluster-based diversity
  const sorted = [...rrfScores.entries()]
    .sort((a, b) => b[1].score - a[1].score);

  // Cluster-based MMR approximation
  const diverseResults = [];
  const clusterCounts = new Map();
  const MAX_PER_CLUSTER = 4;
  for (const [vid, entry] of sorted) {
    if (diverseResults.length >= page * pageSize + pageSize * 3) break;
    try {
      const cl = sgDb.exec('SELECT cluster_id FROM verse_clusters WHERE verse_id = ?', [vid]);
      if (cl.length && cl[0].values.length) {
        const clusterId = cl[0].values[0][0];
        const count = clusterCounts.get(clusterId) || 0;
        if (count >= MAX_PER_CLUSTER) continue;
        clusterCounts.set(clusterId, count + 1);
      }
    } catch {}
    const { _source, _ftsRank, _tgRank, _entityRank, ...clean } = entry.row;
    diverseResults.push({ ...clean, similarity_score: +(entry.score).toFixed(4) });
  }

  const total = sorted.length;
  const paged = diverseResults.slice(page * pageSize, (page + 1) * pageSize);
  return { results: paged, total, page, pageSize, query, language };
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

// ── Related Verses (kNN graph + TG topic overlap, offline) ───────────────────

export function getRelated(verseId, language = 'en') {
  const engAdapter = resolveAdapter('en');
  if (!engAdapter) return { results: [], matchedConcept: null };

  const sgDb = getDb('searchgraph');
  const tgRaw = getDb('tg');
  const tgAdapter = tgRaw ? new SqlJsAdapter(tgRaw) : null;

  // Get topics for this verse
  let liveSlugs = new Set();
  let matchedConcept = null;
  if (tgAdapter) {
    const liveTopicRows = tgAdapter.prepare(
      'SELECT t.slug, t.name FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE tg.verse_id = ? AND tg.verse_id != -1'
    ).all(verseId);
    liveSlugs = new Set(liveTopicRows.map(r => r.slug));
    matchedConcept = liveTopicRows[0]?.name ?? null;
  }

  // ── Strategy 1: kNN + RWR fusion (instant, high quality) ──
  if (sgDb) {
    try {
      const knnRows = sgDb.exec(
        'SELECT neighbor_id, similarity FROM verse_knn WHERE verse_id = ? ORDER BY rank',
        [verseId]
      );
      if (knnRows.length && knnRows[0].values.length) {
        const neighbors = knnRows[0].values;

        // Load RWR neighbors (multi-hop structural connections)
        const rwrMap = new Map();
        try {
          const rwrRows = sgDb.exec(
            'SELECT neighbor_id, rwr_score FROM verse_rwr WHERE verse_id = ? ORDER BY rank',
            [verseId]
          );
          if (rwrRows.length && rwrRows[0].values.length) {
            for (const [nid, score] of rwrRows[0].values) rwrMap.set(nid, score);
          }
        } catch {}

        // Get chapter of the source verse for same-chapter filtering
        const srcMeta = engAdapter.prepare('SELECT chapter_id FROM scriptures WHERE verse_id = ? LIMIT 1').get(verseId);
        const srcChapter = srcMeta?.chapter_id;

        // Fuse kNN + RWR + topic overlap + PPR
        const allCandidates = new Map();
        for (const [nid, sim] of neighbors) {
          let topicBonus = 0;
          if (liveSlugs.size > 0) {
            try {
              const vt = sgDb.exec('SELECT topic_slugs FROM verse_topics WHERE verse_id = ?', [nid]);
              if (vt.length && vt[0].values.length) {
                const nSlugs = JSON.parse(vt[0].values[0][0]);
                const shared = nSlugs.filter(s => liveSlugs.has(s)).length;
                topicBonus = shared * 0.15;
              }
            } catch {}
          }
          let prBonus = 0;
          try {
            const pr = sgDb.exec('SELECT pagerank FROM verse_pagerank WHERE verse_id = ?', [nid]);
            if (pr.length && pr[0].values.length) prBonus = pr[0].values[0][0] * 2000;
          } catch {}
          // PPR boost
          let pprBonus = 0;
          if (liveSlugs.size > 0) {
            try {
              for (const slug of [...liveSlugs].slice(0, 5)) {
                const ppr = tgRaw ? tgRaw.exec('SELECT ppr FROM topic_ppr WHERE topic_slug = ? AND verse_id = ?', [slug, nid]) : [];
                if (ppr.length && ppr[0].values.length && ppr[0].values[0][0] > pprBonus) {
                  pprBonus = ppr[0].values[0][0];
                }
              }
            } catch {}
          }
          const rwrScore = rwrMap.get(nid) ?? 0;
          const score = sim * 1.0 + rwrScore * 2.0 + topicBonus + pprBonus * 0.5 + prBonus;
          allCandidates.set(nid, { verse_id: nid, embSim: sim, score });
        }
        // Add RWR-only candidates
        for (const [nid, rwrScore] of rwrMap) {
          if (allCandidates.has(nid)) continue;
          let prBonus = 0;
          try {
            const pr = sgDb.exec('SELECT pagerank FROM verse_pagerank WHERE verse_id = ?', [nid]);
            if (pr.length && pr[0].values.length) prBonus = pr[0].values[0][0] * 2000;
          } catch {}
          allCandidates.set(nid, { verse_id: nid, embSim: 0, score: rwrScore * 3.0 + prBonus });
        }

        const enhanced = [...allCandidates.values()].filter(r => {
          if (!srcChapter) return true;
          const m = engAdapter.prepare('SELECT chapter_id FROM scriptures WHERE verse_id = ? LIMIT 1').get(r.verse_id);
          return !m || m.chapter_id !== srcChapter;
        });
        enhanced.sort((a, b) => b.score - a.score);

        const stmt = engAdapter.prepare(
          'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
        );

        const results = enhanced.slice(0, 12).map(({ verse_id, embSim }) => {
          const row = stmt.get(verse_id);
          if (!row) return null;
          // Find shared topic
          let sharedConcept = null;
          if (tgAdapter && liveSlugs.size > 0) {
            try {
              const cTopics = tgAdapter.prepare(
                'SELECT t.name FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE tg.verse_id = ? AND t.slug IN (' +
                [...liveSlugs].map(() => '?').join(',') + ') LIMIT 1'
              ).get(verse_id, ...[...liveSlugs]);
              sharedConcept = cTopics?.name ?? null;
            } catch {}
          }
          return { ...row, similarity_score: +embSim.toFixed(4), matched_concept: sharedConcept };
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
        return { results, matchedConcept, total: enhanced.length };
      }
    } catch (err) {
      console.warn('[Related] kNN fallback:', err.message);
    }
  }

  // ── Strategy 2: Topic overlap (legacy fallback) ──
  if (!tgAdapter) {
    const meta = engAdapter.prepare('SELECT scripture_text FROM scriptures WHERE verse_id = ? LIMIT 1').get(verseId);
    if (!meta) return { results: [], matchedConcept: null };
    const phrase = meta.scripture_text.split(/\s+/).slice(0, 8).join(' ');
    const log = { info: () => {}, warn: () => {}, error: console.error };
    const { results } = phraseSearch(phrase, 0, 12, engAdapter, log);
    return { results: results.filter(r => r.verse_id !== verseId), matchedConcept: null, fallback: true };
  }

  // Topic overlap scoring
  const scoreMap = new Map();
  for (const slug of liveSlugs) {
    const peers = tgAdapter.prepare(
      'SELECT tg.verse_id FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE t.slug = ? AND tg.verse_id IS NOT NULL AND tg.verse_id != -1'
    ).all(slug);
    for (const { verse_id: vid } of peers) {
      if (vid === verseId) continue;
      scoreMap.set(vid, (scoreMap.get(vid) ?? 0) + 1);
    }
  }

  const sorted = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const stmt = engAdapter.prepare(
    'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
  );
  const results = sorted.map(([vid, overlap]) => {
    const row = stmt.get(vid);
    if (!row) return null;
    const shared = tgAdapter.prepare(
      'SELECT t.name FROM topical_guide tg JOIN topics t ON t.id = tg.topic_id WHERE tg.verse_id = ? AND t.slug IN (' + [...liveSlugs].map(() => '?').join(',') + ') LIMIT 1'
    ).get(vid, ...[...liveSlugs]);
    return { ...row, matched_concept: shared?.name ?? null, similarity_score: +(overlap / liveSlugs.size).toFixed(4) };
  }).filter(Boolean);

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

export function getVerseSummary(verseId) {
  const vsDb = getDb('vsummary');
  if (!vsDb) return { summary: null, cross_references: [], ready: false };
  try {
    const rows = vsDb.exec(
      "SELECT summary FROM verse_summaries WHERE verse_id = ?",
      [verseId]
    );
    if (!rows.length || !rows[0].values.length) return { summary: null, cross_references: [], ready: true };
    const summary = rows[0].values[0][0];
    let xrefs = [];
    const vxDb = getDb('vxref');
    if (vxDb) {
      try {
        const xr = vxDb.exec('SELECT cross_references FROM verse_cross_references WHERE verse_id = ?', [verseId]);
        if (xr.length && xr[0].values.length) xrefs = JSON.parse(xr[0].values[0][0] || '[]');
      } catch {}
    }
    return { summary: summary || null, cross_references: xrefs, ready: true };
  } catch { return { summary: null, cross_references: [], ready: false }; }
}

export function getChapterSummary(chapterId) {
  const chsDb = getDb('chsummary') || getDb('tags');
  if (!chsDb) return { summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false };
  try {
    const rows = chsDb.exec('SELECT summary_text, summary_method, key_verses_json, top_topics_json FROM chapter_summaries WHERE chapter_id = ?', [chapterId]);
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
  if (!tagsDb) return { people: [], places: [], ready: false };
  try {
    const rows = tagsDb.exec('SELECT entities_json FROM chapter_entities WHERE chapter_id = ?', [chapterId]);
    if (!rows.length || !rows[0].values.length) return { people: [], places: [], ready: true };
    const jsonStr = rows[0].values[0][0];
    if (!jsonStr) return { people: [], places: [], ready: true };
    const j = JSON.parse(jsonStr);
    return { people: j.people || [], places: j.places || [], ready: true };
  } catch { return { people: [], places: [], ready: false }; }
}

export function searchEntities(name, type = 'person') {
  const tagsDb = getDb('tags');
  const engAdapter = resolveAdapter('en');
  if (!tagsDb || !engAdapter) return { results: [], total: 0, name, type };
  try {
    const col = type === 'place' ? 'places' : 'people';
    const key = name.toLowerCase();
    // Search chapter_entities, then expand to verse_ids
    const rows = tagsDb.exec(
      `SELECT chapter_id FROM chapter_entities WHERE lower(${col}) LIKE ?`,
      [`%${key}%`]
    );
    if (!rows.length || !rows[0].values.length) return { results: [], total: 0, name, type };
    const chapterIds = rows[0].values.map(r => r[0]);
    const enDb = getDb('en');
    if (!enDb) return { results: [], total: 0, name, type };
    const allVerseIds = [];
    for (const cid of chapterIds) {
      const vRows = enDb.exec('SELECT id FROM verses WHERE chapter_id = ? ORDER BY verse_number', [cid]);
      if (vRows.length) vRows[0].values.forEach(r => allVerseIds.push(r[0]));
    }
    const total = allVerseIds.length;
    const stmt = engAdapter.prepare(
      'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number FROM scriptures WHERE verse_id = ?'
    );
    const results = allVerseIds.slice(0, 20).map(vid => stmt.get(vid)).filter(Boolean);
    return { results, total, name, type };
  } catch { return { results: [], total: 0, name, type }; }
}

/**
 * Disambiguated entity search using ai_entity_profiles + ai_entity_verse_map.
 * Resolves which specific entity (e.g., Nephi son of Lehi vs Nephi son of Helaman)
 * based on the verse context. Falls back to searchEntities if no disambiguation data.
 */
export function searchEntityDisambiguated(name, type = 'person', verseId = null, entityId = null, page = 0, pageSize = 10) {
  const sgDb = getDb('searchgraph');
  const engAdapter = resolveAdapter('en');
  if (!sgDb || !engAdapter) return searchEntities(name, type);
  try {
    const searchName = name.replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase();
    let resolvedEid = entityId || null;

    // Resolve entity_id from verse context via ai_entity_verse_map
    if (!resolvedEid && verseId) {
      const rows = sgDb.exec(
        `SELECT m.entity_id FROM ai_entity_verse_map m
         JOIN ai_entity_profiles p ON m.entity_id = p.entity_id
         WHERE m.verse_id = ? AND LOWER(p.name) = ? AND p.type = ?
         LIMIT 1`,
        [verseId, searchName, type]
      );
      if (rows.length && rows[0].values.length) resolvedEid = rows[0].values[0][0];
    }

    // Fallback: find candidate profiles by name+type, pick best match
    if (!resolvedEid) {
      const profRows = sgDb.exec(
        'SELECT entity_id, verse_count FROM ai_entity_profiles WHERE LOWER(name) = ? AND type = ?',
        [searchName, type]
      );
      if (profRows.length && profRows[0].values.length) {
        const profiles = profRows[0].values.map(r => ({ entity_id: r[0], verse_count: r[1] }));
        if (profiles.length === 1) {
          resolvedEid = profiles[0].entity_id;
        } else if (profiles.length > 1 && verseId) {
          // Try direct verse mapping first
          const directRows = sgDb.exec(
            `SELECT entity_id FROM ai_entity_verse_map WHERE verse_id = ? AND entity_id IN (${profiles.map(() => '?').join(',')})`,
            [verseId, ...profiles.map(p => p.entity_id)]
          );
          if (directRows.length && directRows[0].values.length) {
            resolvedEid = directRows[0].values[0][0];
          } else {
            // Fallback: find which profile has verses in the same chapter
            const engAdapter2 = resolveAdapter('en');
            if (engAdapter2) {
              const chRow = engAdapter2.prepare('SELECT chapter_id FROM scriptures WHERE verse_id = ?').get(verseId);
              if (chRow) {
                const chMatch = sgDb.exec(
                  `SELECT entity_id, COUNT(*) as cnt FROM ai_entity_verse_map WHERE chapter_id = ? AND entity_id IN (${profiles.map(() => '?').join(',')}) GROUP BY entity_id ORDER BY cnt DESC LIMIT 1`,
                  [chRow.chapter_id, ...profiles.map(p => p.entity_id)]
                );
                if (chMatch.length && chMatch[0].values.length) {
                  resolvedEid = chMatch[0].values[0][0];
                }
              }
            }
            // Ultimate fallback: most verses globally
            if (!resolvedEid) {
              profiles.sort((a, b) => b.verse_count - a.verse_count);
              resolvedEid = profiles[0].entity_id;
            }
          }
        }
      }
    }

    if (!resolvedEid) return searchEntities(name, type);

    // Get profile info
    const profRows = sgDb.exec('SELECT * FROM ai_entity_profiles WHERE entity_id = ?', [resolvedEid]);
    const profile = profRows.length && profRows[0].values.length
      ? Object.fromEntries(profRows[0].columns.map((c, i) => [c, profRows[0].values[0][i]]))
      : null;

    // Get all verse_ids for this entity
    const vidRows = sgDb.exec('SELECT verse_id FROM ai_entity_verse_map WHERE entity_id = ? ORDER BY verse_id', [resolvedEid]);
    const allVids = vidRows.length ? vidRows[0].values.map(r => r[0]) : [];
    const total = allVids.length;
    const offset = page * pageSize;
    const pageVids = allVids.slice(offset, offset + pageSize);

    const stmt = engAdapter.prepare(
      'SELECT verse_id, verse_title, scripture_text, book_title, volume_title, volume_id, chapter_number, verse_number FROM scriptures WHERE verse_id = ?'
    );
    const results = pageVids.map(vid => stmt.get(vid)).filter(Boolean);

    // Get sibling profiles
    const sibRows = profile ? sgDb.exec(
      'SELECT entity_id, qualifier, verse_count FROM ai_entity_profiles WHERE LOWER(name) = LOWER(?) AND type = ? AND entity_id != ?',
      [profile.name, profile.type, resolvedEid]
    ) : [];
    const siblings = sibRows.length && sibRows[0]?.values?.length
      ? sibRows[0].values.map(r => ({ entity_id: r[0], qualifier: r[1], verse_count: r[2] }))
      : [];

    return {
      results, total, name, type, page, pageSize,
      entity_id: resolvedEid,
      qualifier: profile?.qualifier || null,
      description: profile?.description || null,
      siblings,
    };
  } catch (e) {
    console.warn('searchEntityDisambiguated error:', e);
    return searchEntities(name, type);
  }
}

export function searchSermonTopics(query, limit = 15) {
  const chsDb = getDb('chsummary') || getDb('tags');
  const engAdapter = resolveAdapter('en');
  if (!chsDb || !engAdapter) return [];
  try {
    const term = query.trim().toLowerCase();
    // Try FTS5 first, fall back to LIKE if FTS table doesn't exist
    let rows;
    try {
      rows = chsDb.exec(
        `SELECT cs.chapter_id, cs.book_id, cs.chapter_num, cs.summary_text, cs.top_topics_json
         FROM chapter_summaries_fts fts
         JOIN chapter_summaries cs ON cs.chapter_id = fts.rowid
         WHERE chapter_summaries_fts MATCH ?
         ORDER BY fts.rank
         LIMIT ?`,
        [term, limit]
      );
    } catch (_) {
      rows = chsDb.exec(
        `SELECT chapter_id, book_id, chapter_num, summary_text, top_topics_json
         FROM chapter_summaries
         WHERE lower(summary_text) LIKE ? OR lower(top_topics_json) LIKE ?
         LIMIT ?`,
        [`%${term}%`, `%${term}%`, limit]
      );
    }
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
