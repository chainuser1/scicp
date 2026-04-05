# Scriptures in View

A free, real-time scripture presentation tool for worship services, seminary, family study, and personal devotion.

---

## Overview

- **Real-time projection** of scripture verses via WebSocket
- **Intelligent search** — FTS5 full-text retrieval, semantic embeddings, and graph propagation
- **Multi-language support** — English, Tagalog, Cebuano
- **Reader mode** for personal study with highlights, bookmarks, and analytics
- **Cross-platform** — Web and Desktop (Electron)

---

## Platforms

| Platform | Directory | Technology | Offline |
|----------|-----------|------------|---------|
| Web | `frontend/` | React 19, Vite 7 | No |
| Backend | `backend/` | Node.js 20, Fastify 5, Socket.IO 4 | — |
| Desktop | `electron/` | Electron 35, embedded backend | ✅ Full |
| Shared | `shared/` | CommonJS utilities | — |

---

## Features

### Presenter Mode

- Search by reference, topic, keyword, or concept
- Stage verses before sending live to displays
- Set lists with verse ordering and private notes
- Dual-language display (primary + secondary)
- Real-time theme customization (background, font, colors)
- Session system with PIN protection and QR code connection
- Highlight text on-screen for emphasis

### Reader Mode

- Personal scripture study with continuous prose reading
- 5 visual themes (Night, Dim, Sepia, Day, AMOLED)
- Font size, line height, and font family customization
- 4-color verse highlighting (long-press)
- Bookmarks with search and categorization
- Reading analytics (dwell time, pace, coverage)
- Chapter and verse context sheets (summary, people, related)
- Offline chapter caching (last 10 chapters)

### Search Intelligence

Comprehensive 41-component mathematical pipeline optimized for scriptural semantic understanding:

1. **Input normalization** — KJV spelling variants (neighbor↔neighbour, color↔colour, etc.), reference detection, abbreviation expansion, doctrine alias expansion (50+ theological topics)
2. **Multi-source retrieval** — FTS5 (BM25 ranking, AND/OR queries), phrase detection, scripture reference parsing
3. **Semantic scoring (v2.0)** — fine-tuned sentence embeddings (current rebuilds may use 768D models such as BGE-base), raw L2-normalized vectors, HNSW approximate nearest neighbors, cosine similarity with proactive injection for multi-word queries
4. **Entity resolution** — named entity recognition with polynomial feature scoring (people, places, themes)
5. **Graph propagation** — kNN verse similarity graph, spectral features, cross-reference boosting, topical guide integration
6. **Fusion** — Reciprocal Rank Fusion (RRF) combining FTS + semantic + graph signals with learned weights
7. **Re-ranking** — Maximum Marginal Relevance (MMR) diversity, session context, learned weight optimization (Adam)
8. **Tier calibration** — 5-tier specificity scoring with sigmoid soft-gates, per-intent weighting, deadzone isolation

Search ranking is now intentionally specificity-first:

1. direct references
2. structured multi-word phrase or totality matches
3. cluster and semantic neighborhood matches
4. topical related verses
5. plain keyword matches


### Latest Improvements (Apr 2026)

**Search Engine v2.0 Overhaul:**
- ✅ **Disabled ZCA whitening** — was inverting cosine similarity rankings; now uses raw L2-normalized embeddings
- ✅ **KJV spelling normalization** — 18 rules (neighbor→neighbour, savior→saviour, etc.) applied at query parse time
- ✅ **Exposed `_specificity_score`** — all results show their 5-tier specificity (T1 ≈ 6.0, T2 ≈ 4.8, T3 ≈ 3.8, etc.)
- ✅ **Raw HNSW index** — rebuilt from raw embeddings, fixes negative similarity scores
- ✅ **Proactive semantic injection** — multi-word queries (N≥2) automatically inject non-keyword-overlapping semantic matches
- ✅ **Semantic thresholds tuned** — SEM_THRESHOLD_BASE=0.28, SIM_FLOOR=0.15 for raw vectors

**Prior work:**
- Training corpus: **460,979 pairs** (~461k)
- LDS ↔ Rotherham, Strong's lexicon, Kaggle fine-tuning pipeline
- One-command rebuild: `scripts/post-train-rebuild.sh`
- Hard-negative prep workflow: `npm run prepare:training-hard-negatives`

### Current Audit State (Apr 2026, Pre-Retrain)

- backend tests: **159 / 159 passing**
- judged benchmark top1 accuracy: **100.0%**
- Recall@3 / Recall@5: **100.0% / 100.0%**
- exact-reference top1: **100.0%**
- phrase-fragment top3: **100.0%**
- false-positive rate: **0.0%**
- judged benchmark status: **all current judged queries pass**

### Goal Progress

The search engine is already well past the baseline overhaul stage.

- Phase 1 (measurement and benchmark discipline): mostly complete
- Phase 2 (query-aware fusion): materially advanced, not fully complete
- Phase 3 (query-personalized graph propagation): materially implemented
- Phase 4 (embedding-space sharpening): dataset preparation complete enough to retrain, retrain itself still pending
- Phase 5 (weak structural priors): partially implemented, still being validated

In plain terms: the system is already strong and mathematically serious, and the current judged benchmark is green. The next major step is not mandatory retraining; it is preserving this specificity-first ranking discipline while deciding whether any future model change genuinely improves the current baseline.


---

## Supported Scriptures

- Holy Bible (King James Version)
- Book of Mormon
- Doctrine and Covenants
- Pearl of Great Price
- **41,995 verses** across all volumes

---

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
git clone https://github.com/your-org/scicp.git
cd scicp
npm install
```

### Development

```bash
# Start backend (port 3000) + frontend (port 5173)
# Run in separate terminals:
npm run dev --workspace=backend
npm run dev --workspace=frontend

```

### Build

```bash
npm run build                        # Build frontend
npm run build --workspace=frontend   # Frontend only
```

### Test

```bash
npm test --workspace=backend         # Backend tests (Jest)
npm test --workspace=frontend        # Frontend tests (Vitest)
npm run lint --workspace=frontend    # Frontend lint (ESLint)
npm run check:prod                   # Full CI: build + test + lint
```

---

## Project Structure

```
scicp/
├── backend/
│   ├── index.js              # All server code (Fastify + Socket.IO)
│   ├── package.json
│   └── __tests__/
│       └── index.test.js     # 119 tests
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Router + Home
│   │   ├── socket.js         # Socket.IO singleton
│   │   ├── pages/            # About, Client, Contact, Download, Presenter, Privacy, Terms
│   │   └── components/       # Footer, ScriptureReader
│   ├── vite.config.js
│   └── eslint.config.js
├── electron/                 # Electron main process
├── shared/                   # Common utilities
├── resources/db/             # SQLite databases
├── Dockerfile
├── railway.toml
└── package.json              # Root workspaces: backend + frontend
```

---

## Database

SQLite via `better-sqlite3` (synchronous API).

| Database | Purpose |
|----------|---------|
| `lds-scriptures-sqlite.db` | English scriptures, themes, FTS5 index |
| `ylt-scriptures-sqlite.db` | Young's Literal Translation alignment source |
| `rotherham-scriptures-sqlite.db` | Rotherham's Emphasized Bible alignment source |
| `tagalog-scriptures-sqlite.db` | Tagalog translations |
| `cebuano-scriptures-sqlite.db` | Cebuano translations |
| `verse-embeddings.db` | Raw sentence embeddings plus HNSW index (embedding dimensionality depends on the active model) |
| `verse-graph.db` | kNN, spectral, clusters, and graph features |
| `search-graph.db` | Bundled lightweight search graph for runtime support |

---

## Session Model

- Sessions stored in-memory (not persisted)
- Client (TV) creates session → Presenter joins via QR code or session code
- One presenter per session; second presenter triggers takeover prompt
- Grace period: 30 min (presenter), 5 min (client)
- Max 50 concurrent sessions

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` / `8080` (Docker) | Server listen port |
| `NODE_ENV` | `development` | Controls static file serving |
| `PUBLIC_ORIGIN` | from Host header | For QR code URLs behind proxies |
| `REBUILD_FTS_ON_START` | `false` | Force FTS5 index rebuild |
| `SESSION_GRACE_MS` | `1800000` | Session keep-alive after disconnect |

---

## Deployment

- **Docker:** `docker build .` → serves on port 8080
- **Railway:** Auto-deploy via `railway.toml`, health check at `/health`
- **Desktop:** Electron Builder → Windows/macOS/Linux installers

---

## License

See LICENSE file.
