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
2. structured multi-word phrase or totality match
3. cluster or semantic neighborhood match
4. topical relation
5. plain keyword fallback

### Bias-Free Retrieval Rules

The current search stack avoids handwritten topical steering inside retrieval and ranking.

- No manual theological synonym injection in the live search pipeline. Query expansion is limited to corpus-derived statistics such as PMI and embedding-space concept neighbors.
- Long-query fallback no longer depends on a static low-information word list. Distinctive terms are selected from corpus frequency and learned term-weight tables.
- Long-query recovery uses mathematical structure signals instead of keyword vocabularies: weighted lexical coverage, salient anchor windows, and ordered sequence compactness.
- Phrase promotion for long queries is restricted to rows that preserve statistically salient anchor structure. Generic scriptural scaffolding should not outrank denser lexical evidence.
- Normalization-only resources are still allowed where they preserve user intent rather than steer retrieval, such as scripture reference abbreviations and KJV spelling normalization.

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
If no early return, automatically run phrase + semantic + keyword in parallel:

- **Phrase Search** - Multi-word query phrase detection via FTS5, coverage scoring, anchor window analysis, sequence matching
- **Semantic Retrieval**
  - Query embedded via the active fine-tuned sentence encoder (dimension depends on the current model, e.g. 768D for BGE-base or nomic-768D )
  - HNSW approximate nearest neighbors (200 candidates, ef=150)
  - Filters score ≤ 0 (anti-correlated / irrelevant)
  - Assigns Tier 3–4 based on cosine similarity thresholds with sigmoid gating
- **Entity Resolution**
  - Named entity recognition via pre-baked entity indices (people, places)
  - Entity centroid embedding similarity
  - Speaker detection from verse_doctrine_tags
- **Graph Propagation**
  - Query-personalized PageRank (PPR) with intent-aware depth and capped influence
  - kNN verse similarity graph for semantic neighbors
  - Spectral embeddings (50D) for topic-based diversity reranking
  - Cross-reference graph: LDS cross-ref relationships ("See also...")
  - Topical guide integration (3,512 topics, 21,991 linked verses)
  - Random Walk with Restart (RWR) for graph-based expansion
  - Weak structure prior for broad conceptual/situational reranking only (max 0.07)

**Step 4: Semantic Expansion & Injection**
- For low-confidence or short queries, inject semantic neighbors via PMI/concept expansion
- Co-occurrence penalty: verses missing queried term pairs receive score reduction
- Embedding phrase matching via Chamfer/Sinkhorn WMD distance for multi-word alignment

**Step 5: RRF Fusion & Propagation**
- Weighted Reciprocal Rank Fusion combining phrase, summary, entity, cross-ref, RWR sources
- Query-personalized PageRank (PPR) with intent-specific alpha (0.72-0.84), hops (1-2), and seed limits
- Random Walk with Restart (RWR) for graph-based neighbor scoring

**Step 6: Session Context & Diversity**
- Session filtering (exclude just-shown verses in live mode)
- Maximum Marginal Relevance (MMR) to avoid redundant high-similarity results
- Cluster-based diversity: verses from different topic clusters preferred

**Step 7: Specificity Scoring**
- Assign each result to exactly one Tier (1–5) based on match type
- Compute specificity score (Tier base + bonuses for phrase, FTS rank, entity confidence)
- T1 (reference): ~6.0, T2 (phrase): ~4.8, T3 (keyword): ~3.8, T4 (semantic): ~2.0, T5 (graph): ~0.5
- Apply isotonic regression deadzone gates to prevent score collapse

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

| Database | Purpose |
|----------|---------|
| `lds-scriptures-sqlite.db` | Primary: 41,995 English verses, themes, FTS5 index |
| `ylt-scriptures-sqlite.db` | Young's Literal Translation |
| `rotherham-scriptures-sqlite.db` | Rotherham's Emphasized Bible |
| `tagalog-scriptures-sqlite.db` | Tagalog translations |
| `cebuano-scriptures-sqlite.db` | Cebuano translations |
| `spanish-scriptures-sqlite.db` | Spanish translations |
| `greek-scriptures-sqlite.db` | Greek translations |
| `ilocano-scriptures-sqlite.db` | Ilocano translations |
| `japanese-scriptures-sqlite.db` | Japanese translations |
| `nrsvue-scriptures-sqlite.db` | NRSVUE translations |
| `waray-scriptures-sqlite.db` | Waray translations |
| `verse-embeddings.db` | Raw sentence embeddings (L2-normalized, no ZCA whitening), plus HNSW index |
| `verse-graph.db` | kNN similarity graph, spectral embeddings (50D), cluster labels, cross-ref edges |
| `user-data.db` | Runtime user data (bookmarks, highlights, reading analytics) |
| `search-graph.db` | Lightweight runtime copy for packaged/runtime support |
| `verse-tags.db` | Entity tags and topic annotations |
| `verse-summaries.db` | AI-generated verse summaries |
| `topical-guide.db` | LDS topical guide (3,512 topics, 21,991 verse links) |
| `verse-cross-refs.db` | Cross-reference pairs |
| `chapter-summaries-fts.db` | FTS5 index over chapter summaries |
| `concept-embeddings.db` | Concept-level embeddings for PMI/co-occurrence index |
| `triple-index.db` | Prebake intermediate (not opened at runtime) |
| `footnotes-lds-summaries.db` | LDS footnote summaries |

Key tables: `verses`, `chapters`, `books`, `scriptures` (view), `scriptures_fts` (FTS5), `themes`, `verse_knn`, `verse_spectral`

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

**Presenter → Server:** `create-session`, `join-session`, `leave-session`, `search`, `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `update-language`, `go-live`

**Client → Server:** `create-client-session`, `join-session`, `leave-session`

**Server → Room:** `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `viewer-count`, `presenter-joined`, `presenter-takeover-attempt`, `session-joined`, `session-left`, `session-created`, `client-session-created`, `session-error`, `search-results`

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
