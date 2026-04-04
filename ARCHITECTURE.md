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
| Desktop (Electron) | `electron/` | Electron 35, embedded backend | ✅ Full |
| Shared Logic | `shared/` | CommonJS, used by all platforms | — |

## Search Engine Version History

| Version | Date | Key Changes |
|---------|------|-------------|
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

The backend implements a 41-component mathematical search pipeline in `backend/index.js` (~2500 lines). Focus on correct mathematical semantics without empirical hacks.

### Query Flow: 8 Sequential Steps

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

- **FTS5 (Full-Text Search)**
  - BM25 ranking on pre-indexed `scriptures_fts` (FTS5 virtual table, porter ascii tokenizer)
  - Phrase detection: multi-word queries checked against verse word sequences
  - Fallback OR query if AND finds no results
  - Assigns Tier 2 (phrase match) or Tier 3 (keyword match)

- **Semantic Retrieval**
  - Query embedded via the active fine-tuned sentence encoder (dimension depends on the current model, e.g. 768D for BGE-base)
  - HNSW approximate nearest neighbors (200 candidates, ef=150)
  - Filters score ≤ 0 (anti-correlated / irrelevant)
  - Assigns Tier 3–4 based on cosine similarity thresholds

- **Entity Resolution**
  - Named entity recognition (people: apostles, prophets, etc.; places: Jerusalem, Egypt, etc.)
  - Cross-matches verses mentioning queried entities
  - Polynomial feature scoring: entity frequency, proximity boost, topical clustering

- **Graph Propagation**
  - kNN verse similarity graph: finds semantically similar verses to top FTS/semantic results
  - Spectral embeddings (50D) for topic clustering and diversity re-ranking
  - Cross-reference graph: LDS cross-ref relationships ("See also...") for related verses
  - Topical guide integration (3512 topics, 21,991 linked verses)
  - PageRank scores (verse importance in citation graph)

**Step 4: Proactive Semantic Injection**
- For multi-word queries (N ≥ 2), inject high-similarity non-keyword-matching verses
- Weight increases with query length: N=2→0.48, N=5→0.72, N=8→0.95
- Prevents keyword-only results (e.g., "anger management" finds semantic anger/wrath matches even without word overlap)
- Threshold: SEM_THRESHOLD_BASE=0.28 (raw cosine), SIM_FLOOR=0.15

**Step 5: Reciprocal Rank Fusion (RRF)**
Combine FTS + semantic + graph scores via learned weighted RRF:
- Global weights (optimized via Adam): ~[3.0, 1.15, 0.05, 1.1, 0.3, 0.15]
- Per-intent weights: entity, keyword, reference, phrase
- Produces unified ranking and combined score

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
- Fetch translations by `verse_id` from language-specific DBs (Tagalog, Cebuano, YLT)
- Display both English + selected translation side-by-side

### Embedding Model

- **Base**: Configurable sentence encoder; current rebuilds may use models such as BGE-base-en-v1.5 (768D)
- **Fine-tuning**: retrieval-pair fine-tuning for scripture semantic search
- **Storage**: Raw embeddings (L2-normalized, NO ZCA whitening; dimensionality depends on the active model)
- **Index**: HNSW (hierarchical navigable small world, M=16, ef=200; ~600K edges, built from raw)

## Database Schema

| Database | Purpose |
|----------|---------|
| `lds-scriptures-sqlite.db` | Primary: 41,995 English verses, themes, FTS5 index |
| `ylt-scriptures-sqlite.db` | Young's Literal Translation (alignment pairs) |
| `rotherham-scriptures-sqlite.db` | Rotherham's Emphasized Bible (alignment pairs) |
| `tagalog-scriptures-sqlite.db` | Tagalog translations |
| `cebuano-scriptures-sqlite.db` | Cebuano translations |
| `verse-embeddings.db` | Raw sentence embeddings (L2-normalized, no ZCA whitening), plus HNSW index built from raw |
| `verse-graph.db` | kNN similarity graph, spectral embeddings (50D), cluster labels, cross-ref edges |
| `search-graph.db` | Lightweight runtime copy for packaged/runtime support |

Key tables: `verses`, `chapters`, `books`, `scriptures` (view), `scriptures_fts` (FTS5), `themes`, `verse_knn`, `verse_spectral`

## Post-Training Operations

After fine-tuning `resources/models/scripture-minilm`, all embedding-derived artifacts must be rebuilt.

Recommended single command:

```bash
scripts/post-train-rebuild.sh
```

This script installs the latest model zip and regenerates: embeddings, concept index, kNN, spectral, clusters, cluster labels, entity centroids, HNSW, and the search graph bundle. Whitening is intentionally excluded.

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
| Backend | Jest 29 | 119 | `backend/__tests__/index.test.js` |
| Frontend | Vitest + ESLint | UI tests + lint | `frontend/src/__tests__/`, `frontend/eslint.config.js` |

## Deployment

- **Production:** Docker image → Railway (health check at `/health`)
- **Desktop:** Electron Builder via GitHub Actions → Windows/macOS/Linux installers
- **CI:** `npm run check:prod` — build + test + lint

See `README.md` for build commands.
