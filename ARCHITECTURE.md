# Architecture Overview

Sacred Scripture Projector (scicp) is a real-time scripture presentation engine. A Presenter operator searches and pushes scripture verses to Client display screens via WebSockets. A Reader mode provides personal scripture study with highlights, bookmarks, and reading analytics.

## System Architecture

```
┌─────────────┐    Socket.IO     ┌──────────────────┐    Socket.IO    ┌─────────────┐
│  Presenter   │ ◄─────────────► │   Node.js Server │ ◄────────────► │   Client TV  │
│  (React SPA) │                 │   (Fastify 5 +   │                │  (React SPA) │
└─────────────┘                  │    Socket.IO 4)   │                └─────────────┘
                                 └───────┬──────────┘
                                 ┌───────┴──────────┐
                                 │   SQLite DBs      │
                                 │  (better-sqlite3) │
┌─────────────┐                  └──────────────────┘
│   Desktop   │    Embedded
│  (Electron) │ ◄── backend
└─────────────┘
```

## Platforms

| Platform | Directory | Runtime | Offline |
|----------|-----------|---------|---------|
| Web (Presenter + Client + Reader) | `frontend/` | React 19, Vite 7 | No |
| Backend API + WebSocket | `backend/` | Node.js 20, Fastify 5, Socket.IO 4 | — |
| Desktop (Electron) | `electron/` | Electron 41, embedded backend | ✅ Full |
| Shared Logic | `shared/` | CommonJS, used by all platforms | — |

## Electron Architecture

```
electron/
├── main.js        # App lifecycle, splash, tray, IPC handlers, auto-updater
├── preload.js     # contextBridge → window.electronAPI (getDisplays, openModeSwitcher, etc.)
├── loading.html   # Splash screen; receives live status via ipcRenderer
└── backend-deps/  # Transitive backend runtime deps (sync’d by scripts/sync-electron-deps.js)
```

**Startup sequence:**
1. `createSplashWindow()` — splash shown immediately
2. `setSplashStatus('Opening databases…')` → `require('../backend/index.js')` (synchronous DB open)
3. `setSplashStatus('Starting local server…')` → `startElectron()` (Fastify listen)
4. `setSplashStatus('Loading search index…')` → `waitForServer()`
5. `setSplashStatus('Ready!')` → 400 ms pause → defaults to offline mode
6. `createWindows(selectedMode)` + `setupTray()` + `setupAutoUpdater()`

**Mode system:**
- `selectConnectionMode()` — offline/online dialog at startup
- `setupTray()` — system-tray icon; `buildTrayMenu()` shows current mode; “Switch Mode…” re-opens dialog at any time
- `open-mode-switcher` IPC — renderer can trigger dialog without relaunch
- `mode-changed` IPC event — tray-triggered switch notifies renderer to save state then call `switchConnectionMode`

**ABI isolation:** `electron/main.js` patches `Module._resolveFilename` at startup to route `better-sqlite3` to the Electron-ABI build in `electron/node_modules/`. Never `npm install better-sqlite3` inside `electron/` directly — use `npm run electron:install`.



| Version | Date | Key Changes |
|---------|------|-------------|
| **v2.1-audit** | Apr 2026 | Query-personalized graph propagation, weak structural prior, judged benchmark metrics, hard-negative prep workflow, versioned candidate-model rebuild support |
| **v2.0** | Apr 2026 | **Disabled ZCA whitening** (was inverting similarity); **raw embeddings** (L2-normalized); **KJV spelling normalization**; **proactive semantic injection**; **_specificity_score API field**; **raw HNSW rebuild** |
| v1.5 | Jan 2026 | Fine-tuning pipeline, Kaggle notebook, 460k training pairs |
| v1.0 | Jul 2025 | Initial search pipeline with 41 components, ZCA whitening, HNSW indexing |

### Why v2.0?: The Whitening Bug

ZCA (Zero-Component Analysis) whitening was mathematically corrupting cosine similarity rankings. A concrete failure case:

- **Query**: "love thy neighbor" (searching for Matthew 22:39, the Great Commandment)
- **Expected**: High similarity to 1 Corinthians 13:13 ("faith, hope, charity" — theological parallels) ✓
- **Raw cosine similarity**: 0.72 (correct)
- **After ZCA whitening** (ε=1e-5): **-0.087** (INVERTED ranking) ✗
- **Result**: Verse ranked at #50+, far below low-quality matches like "Love is patient..." (Jer 25:36)

**Root cause**: ZCA's covariance inversion with small regularization (ε=1e-5) amplified low-variance noise dimensions while suppressing high-variance semantic dimensions. This caused a complete inversion of the learned semantic structure from fine-tuning.

**Impact**: 
- Semantic search returning incorrect top results
- Proactive semantic injection failing (HNSW all-negative scores)
- Explicit semantic mode (~query) producing empty results

**Fix**: 
- Disabled ZCA whitening entirely
- Use raw embeddings (L2-normalized only)
- Rebuilt HNSW index from raw vectors
- Retuned thresholds for raw cosine scale (SEM_THRESHOLD_BASE: 0.35 → 0.28, SIM_FLOOR: 0.20 → 0.15)

---

## Application Modes

### Presenter Mode
Session-based real-time projection. Presenter searches, stages, and pushes verses to connected displays. Features: set lists, dual language, theme customization, text highlighting, verse notes.

### Reader Mode
Personal scripture study. Features: continuous prose chapter reading, 5 visual themes, 4-color highlights, bookmarks, reading analytics (dwell time, pace, coverage), chapter/verse context sheets, offline chapter caching.

### Client (TV Display)
Passive display that receives verses from the Presenter. Auto-formats text, supports themes, shows highlighted text. Creates sessions via QR code or manual code.

## Search Pipeline (v2.0 – Apr 2026)

The backend implements a 41-component mathematical search pipeline in `backend/index.js` (~3775 lines).

### Query Flow: 8 Sequential Steps

Current ranking priority is specificity-first rather than topic-first:

1. direct reference
2. structured multi-word phrase (fts-phrase) or totality match
3. cluster or semantic neighborhood match (HNSW retrieval)
4. topical relation (topical-guide, cross-ref)
5. plain keyword fallback (FTS5 AND/OR)

**Step 1: Input Normalization**
- KJV spelling variants (neighbor↔neighbour, savior↔saviour, honor↔honour, etc.) — 18 regex rules applied at query parse
- Scripture reference parsing (e.g., "John 3:16", "D&C 76:22")
- Abbreviation expansion ("1Ne" → "1 Nephi", "JSH" → "Joseph Smith History")
- Doctrine alias expansion (50+ theological topics: "plan of salvation" → includes all related verses)

**Step 2: Early Returns (High Confidence)**
- Exact scripture reference match → Tier 1, intent=`reference`
- Quoted phrase ("faith without works") → Tier 2, intent=`phrase` (phrase-only search)
- Explicit semantic mode (~query) → Tier 1–2, intent=`semantic-explicit` (embedding-only search)

**Step 3: Unified Pipeline (Auto-Detect)**
Phased execution:
- **Phrase Search** - Multi-word query phrase detection via FTS5, coverage scoring, anchor window analysis, sequence matching
- **Semantic Retrieval**
  - Query embedded via ONNX Runtime (768D)
  - HNSW approximate nearest neighbors (200 candidates, ef=150)
  - Filters score ≤ 0 (anti-correlated / irrelevant)
  - Assigns Tier 3–4 based on cosine similarity thresholds
- **Entity Resolution**
  - Named entity recognition via pre-baked entity indices (people, places) in `verse-entity-cache`
  - Speaker detection from `verse_doctrine_tags`
- **Graph Propagation**
  - Query-personalized PageRank (PPR) via `queryPPR()` function
  - kNN verse similarity graph for semantic neighbors via `verse_knn` table
  - Spectral embeddings (50D) for topic-based diversity reranking via `verse_spectral`
  - Cross-reference graph via `verse_cross_references`
  - Topical guide integration (3,512 topics, 21,991 linked verses) via `topical_guide` table
  - Random Walk with Restart (RWR) via `verse_rwr` table
  - **Weak structure prior** for broad conceptual/situational reranking only (max 0.07)

**Step 4: Semantic Expansion & Injection**
- For low-confidence or short queries: injection via PMI/concept expansion
- Co-occurrence penalty: verses missing queried term pairs receive score reduction (lines 1605-1630, 2553-2566, 2606-2614)
- Embedding phrase matching via Chamfer/Sinkhorn WMD distance for multi-word alignment (lines 1340-1390, 2933-2947)

**Step 5: RRF Fusion & Propagation**
- Weighted Reciprocal Rank Fusion combining phrase, summary, entity, cross-ref, RWR sources
- Query-personalized PPR (intent-specific alpha 0.72-0.84, hops 1-2, seed limits)

**Step 6: Session Context & Diversity**
- Session filtering (exclude just-shown verses in live mode)
- Maximum Marginal Relevance (MMR) to avoid redundant high-similarity results
- Cluster-based diversity: verses from different topic clusters preferred

**Step 7: Specificity Scoring**
- Assign each result to exactly one Tier (1–5) based on match type
- Compute specificity score (Tier base + bonuses for phrase, FTS rank, entity confidence)
- T1 (reference): ~4.0, T2 (phrase): ~3.5, T3 (keyword): ~2.8, T4 (semantic): ~2.4, T5 (graph): ~1.1
- Apply calibration curves via PAV (Pool-Adjacent-Violators) algorithm

**Step 8: Final Ranking & Limits**
- Sort by specificity score (descending) + RRF score (tiebreaker)
- Segment long verses at 200 words for readability
- Return top N results (typically 10–50 paginated)
- API response includes: intent, confidence, tiers, specificity scores, per-verse semantics

### Multi-Language Support

All search conducted in English first (fastest, most accurate). After retrieving verse IDs:
- Fetch translations by `verse_id` from language-specific DBs (Tagalog, Cebuano, YLT, Rotherham, Spanish, Greek, Ilocano, Japanese, NRSVUE, Waray)
- Display both English + selected translation side-by-side

### Embedding Model

- **Base**: Nomic-BERT (768D embedding dimension) - directory named `scripture-bge` but uses Nomic-BERT architecture
- **Fine-tuning**: Retrieval-pair fine-tuning for scripture semantic search
- **Storage**: Raw embeddings (L2-normalized, NO ZCA whitening)
- **Index**: HNSW (hierarchical navigable small world, M=16, ef=200; ~64K nodes, built from raw vectors)

## Database Schema

| Database | Purpose | Key Tables/Indices |
|----------|---------|-----------------|
| `lds-scriptures-sqlite.db` | Primary: 41,995 English verses | `verses`, `chapters`, `books`, `scriptures` (view), `scriptures_fts` (FTS5), `scriptures_fts_vocab` |
| `verse-embeddings.db` | Raw sentence embeddings (768D L2-normalized) + HNSW index | `verse_embeddings`, `hnsw_index` (serialized) |
| `verse-graph.db` | kNN graph, spectral embeddings (50D), clusters, cross-refs | `verse_knn`, `verse_spectral`, `verse_clusters`, `cluster_labels`, `verse_cross_references`, `verse_rwr`, `verse_pagerank` |
| `verse-tags.db` | Entity tags, topic annotations, doctrine tags | `verse_doctrine_tags`, `entity_person_index`, `entity_place_index`, `ai_entity_centroids`, `verse_entity_cache` |
| `topical-guide.db` | LDS topical guide (3,512 topics, 21,991 verse links) | `topics`, `topical_guide`, `verse_topics`, `topic_verse_index`, `topic_ppr` (query-personalized) |
| `chapter-summaries-fts.db` | FTS5 index over chapter summaries | `chapter_summaries`, `chapter_summaries_fts`, `chapter_footnotes` |
| `verse-summaries.db` | AI-generated verse summaries + cross-refs | `verse_summaries`, `verse_cross_references` |
| `concept-embeddings.db` | Concept-level embeddings for PMI/co-occurrence | `concepts` (phrase, vec) |
| `user-data.db` | Runtime user data | `search_feedback`, `learned_weights`, `intent_weights`, `spaced_reviews`, `reading_events` |
| Translation DBs | Multi-language scriptures | `tagalog-scriptures-sqlite.db`, `cebuano-scriptures-sqlite.db`, `spanish-scriptures-sqlite.db`, `greek-scriptures-sqlite.db`, `ilocano-scriptures-sqlite.db`, `japanese-scriptures-sqlite.db`, `ylt-scriptures-sqlite.db`, `rotherham-scriptures-sqlite.db`, `nrsvue-scriptures-sqlite.db`, `waray-scriptures-sqlite.db` |

**Pre-baked statistical tables:**
- `term_idf` / `term_llr` - corpus statistics in lds-scriptures-sqlite.db
- `topic_ppr` - query-personalized PageRank scores in topical-guide.db

## Post-Training Operations

After fine-tuning a candidate model, all embedding-derived artifacts must be rebuilt.

Recommended single command:

```bash
scripts/post-train-rebuild.sh
```

This script installs the latest model zip and regenerates: embeddings, concept index, kNN, spectral, clusters, cluster labels, entity centroids, HNSW, and the search graph bundle. Whitening is intentionally excluded.

It can also rebuild from a versioned candidate model directory without overwriting the default active model path first:

```bash
scripts/post-train-rebuild.sh --zip /path/to/scripture-bge.zip --install-dir resources/models/scripture-bge-vNext
scripts/post-train-rebuild.sh --model-dir resources/models/scripture-bge-vNext --skip-install
```

This is the preferred pre-promotion workflow for evaluating a newly trained model against the current baseline.

## Current Audit State (Apr 2026)

- backend tests: 157 / 157 passing
- shared tests: 23 / 23 passing
- frontend tests: 37 / 37 passing
- judged benchmark top1 accuracy: 100.0%
- exact-reference top1: 100.0%
- phrase-fragment top3: 100.0%
- judged benchmark status: all current judged queries pass

Interpretation:

- search is already strong on exact references and most phrase retrieval
- the retrieval stack is disciplined enough to support a real model comparison
- the next milestone is not architectural invention; it is preserving this specificity-first behavior and only accepting future model changes if they beat this baseline

## Session Model

- Sessions stored in an **in-memory Map** (not persisted to DB — server restart clears all)
- **Client (TV)** creates sessions via `create-client-session` event
- **Presenter** joins by scanning QR code or entering session code
- Only **one presenter** per session; second attempt emits `presenter-takeover-attempt`
- **Grace periods:** 30 min (presenter), 5 min (client) — session survives disconnection
- **Max 50** concurrent sessions
- PIN protection available per session
- Long verses segmented at 200 words via `segmentVerseText()`

## Socket.IO Events

**Presenter → Server:** `create-session`, `join-session`, `leave-session`, `search`, `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `update-language`, `go-live`, `go-custom`, `preload-background`, `now-reading`, `set-session-pin`, `clear-session-pin`

**Client → Server:** `create-client-session`, `join-session`, `leave-session`

**Server → Room:** `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `viewer-count`, `presenter-joined`, `presenter-takeover-attempt`, `session-joined`, `session-left`, `session-created`, `client-session-created`, `session-error`, `search-results`, `presenter-left`, `custom-text`, `preload-background`

## Test Coverage

| Suite | Framework | Tests | Location |
|-------|-----------|-------|----------|
| Backend | Jest 29 | 157 | `backend/__tests__/index.test.js` |
| Shared | Jest 29 | 23 | `shared/__tests__/` |
| Frontend | Vitest + ESLint | 37 | `frontend/src/__tests__/`, `frontend/eslint.config.js` |

## Deployment

- **Production:** Docker image → Railway (health check at `/health`)
- **Desktop:** Electron Builder via GitHub Actions → AppImage, deb, NSIS, DMG
- **Analysis DBs:** `deploy.yml` is the sole LFS ingestion point (detects `data:` commit prefix); CI and Electron builds consume from GHCR. Always push rebuilds via `scripts/push-data.sh`.
- **CI:** `npm run check:prod` — build + test + lint

See `README.md` for build commands.
