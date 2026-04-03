# Scriptures in View

A free, real-time scripture presentation tool for worship services, seminary, family study, and personal devotion.

---

## Overview

- **Real-time projection** of scripture verses via WebSocket
- **Intelligent search** — FTS5 full-text retrieval, semantic embeddings, and graph propagation
- **Multi-language support** — English, Tagalog, Cebuano
- **Reader mode** for personal study with highlights, bookmarks, and analytics
- **Cross-platform** — Web, Desktop (Electron), and Mobile (Android)

---

## Platforms

| Platform | Directory | Technology | Offline |
|----------|-----------|------------|---------|
| Web | `frontend/` | React 19, Vite 7 | No |
| Backend | `backend/` | Node.js 20, Fastify 5, Socket.IO 4 | — |
| Desktop | `electron/` | Electron 35, embedded backend | ✅ Full |
| Mobile | `mobile/` | Capacitor 7, Vite, React | No |
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
3. **Semantic scoring (v2.0)** — fine-tuned MiniLM-L6 embeddings (384D raw, L2-normalized), HNSW approximate nearest neighbors, cosine similarity with proactive injection for multi-word queries
4. **Entity resolution** — named entity recognition with polynomial feature scoring (people, places, themes)
5. **Graph propagation** — kNN verse similarity graph, spectral features, cross-reference boosting, topical guide integration
6. **Fusion** — Reciprocal Rank Fusion (RRF) combining FTS + semantic + graph signals with learned weights
7. **Re-ranking** — Maximum Marginal Relevance (MMR) diversity, session context, learned weight optimization (Adam)
8. **Tier calibration** — 5-tier specificity scoring with sigmoid soft-gates, per-intent weighting, deadzone isolation


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

# Mobile dev
cd mobile && npx vite dev
```

### Build

```bash
npm run build                        # Build frontend
npm run build --workspace=frontend   # Frontend only
cd mobile && npx vite build          # Mobile
```

### Test

```bash
npm test --workspace=backend         # Backend: 119 tests (Jest)
cd mobile && npx vitest run          # Mobile: 73 tests (Vitest)
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
├── mobile/
│   ├── src/
│   │   ├── App.jsx           # 4-tab root navigation (Home, Read, Present, More)
│   │   ├── pages/
│   │   │   ├── reader/       # ReaderApp, ChapterReader, ReaderHome, ReaderBrowse, etc.
│   │   │   ├── info/         # AboutPage, ContactPage, PrivacyPage, TermsPage
│   │   │   ├── HomePage.jsx  # Landing page with mode cards
│   │   │   ├── Preview.jsx   # Presenter staging/preview
│   │   │   └── MorePage.jsx  # Settings hub
│   │   ├── hooks/            # useSocket, useSearch, useHighlights, useReaderBookmarks, etc.
│   │   ├── components/       # StatusHeader, RootTabBar, QrScanner, reader/
│   │   └── styles/           # reader.css, info.css
│   ├── __tests__/            # 73 tests across 15 files
│   └── vite.config.js
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
| `verse-embeddings.db` | 384D MiniLM embeddings (raw + whitened) |
| `verse-graph.db` | kNN, spectral, clusters, and graph features |
| `search-graph.db` | Bundled lightweight search graph for runtime/mobile |

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
- **Mobile:** Capacitor → Android APK

---

## License

See LICENSE file.
