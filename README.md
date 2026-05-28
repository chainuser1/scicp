# Scriptures in View

Real-time scripture presentation engine for church and worship services. A Presenter operator searches and pushes scripture verses to Client display screens via WebSockets. A Reader mode provides personal scripture study with highlights, bookmarks, and reading analytics.

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
| Backend API + WebSocket | `backend/` | Node.js, Fastify 5, Socket.IO 4 | — |
| Desktop (Electron) | `electron/` | Electron 41, embedded backend | ✅ Full |
| Shared Logic | `shared/` | CommonJS, used by all platforms | — |

## Quick Start

```bash
# Install dependencies (root + all workspaces)
npm install

# Run development servers
npm run dev

# Build for production
npm run build

# Run tests
npm run test

# Production check (build + test + lint)
npm run check:prod
```

## Desktop (Electron)

```bash
# Development mode
npm run electron:dev

# Build installers
npm run electron:build:win   # Windows NSIS
npm run electron:build:mac   # macOS DMG
npm run electron:build:linux # Linux deb/AppImage

# Install native Electron dependencies
npm run electron:install
```

The Electron app supports offline mode (uses embedded SQLite databases) and online mode (connects to remote server).

## Search Pipeline

The backend implements a sophisticated multi-source search pipeline (`backend/index.js`):

1. **Input Normalization** — KJV spelling variants, book abbreviations, reference parsing
2. **Early Returns** — Exact references, quoted phrases, explicit semantic queries (~query)
3. **Multi-Source Fusion** — Phrase search, entity resolution, topical guide, cross-references, concepts
4. **Semantic Expansion** — HNSW ANN + PMI/concept expansion for low-confidence queries
5. **Graph Propagation** — Query-personalized PageRank, RWR, spectral diversity reranking
6. **Session Context** — MMR deduplication, session centroid boosting
7. **Specificity Scoring** — Tiers 1-5 with sigmoid gating and confidence modeling
8. **Final Ranking & Limits** — Adaptive cutoff based on result distribution

### Key Features

- **ONNX Runtime** for fast embedding inference (direct native binding, no Xenova overhead)
- **HNSW Index** (~64K nodes) for approximate nearest neighbors in embedding space
- **Intent Classification** via TF-IDF + cosine similarity (conceptual/situational/keyword/reference/phrase)
- **Adaptive Result Count** using semantic gap analysis and isotonic regression calibration
- **Reading Analytics Integration** - dwell time boosts for well-studied verses
- **Item2Vec Support** for collaborative filtering style recommendations
- **Session-Aware Search** - centroid-based drift for live presentation context

### Embedding Model

- **Base**: Nomic-BERT (768D embedding dimension) - directory named `scripture-bge` but uses Nomic-BERT architecture
- **Fine-tuning**: Retrieval-pair fine-tuning for scripture semantic search  
- **Storage**: L2-normalized raw embeddings (ZCA whitening disabled v2.0+)
- **Index**: HNSW (~64K nodes) for approximate nearest neighbors in embedding space

### Intent Classification (shared/intent-detector.js)

- **Reference** - Query parses as book:chapter:verse (e.g., "John 3:16")
- **Phrase** - Quoted query `"..."` triggers phrase-only search
- **Semantic-explicit** - Tilde-prefixed `~query` forces embedding-only search
- **Conceptual** - Long queries with low lexical quality → semantic expansion
- **Situational** - Queries seeking verses for specific contexts (e.g., "comfort in hardship")
- **Keyword** - Short queries relying on term matching
- **Mixed** - Queries combining multiple signals

### Scoring Model

- **Specificity Score**: (6 - tier) + tierScore + qpprBoost + structurePrior
- **Tier 1** (reference): ~6.0 - exact verse match
- **Tier 2** (phrase): ~4.8+ - high lexical coverage, anchor window matches
- **Tier 3** (semantic): ~2.0-4.0 - embedding similarity with sigmoid gating
- **Tier 4** (topical/graph): ~1.0-3.0 - topic/RWR propagated results
- **Tier 5** (fallback): ~0.5 - weak or low-confidence matches

### Adaptive Cutoff

Final results pruned using semantic gap analysis - verses below the inflection point where head/tail meaning weight difference drops below threshold are removed to prevent score collapse.

### Reading Analytics

- dwell time data stored in user-data.db
- verses with high dwell time receive small score boost
- Item2Vec vectors enable collaborative-style recommendations

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
| `verse-embeddings.db` | Raw sentence embeddings + HNSW index |
| `verse-graph.db` | kNN graph, spectral embeddings, clusters, cross-refs |
| `search-graph.db` | Lightweight runtime bundle |
| `verse-tags.db` | Entity tags and topic annotations |
| `verse-summaries.db` | AI-generated verse summaries |
| `topical-guide.db` | LDS topical guide (3,512 topics, 21,991 verse links) |
| `verse-cross-refs.db` | Cross-reference pairs |
| `chapter-summaries-fts.db` | FTS5 over chapter summaries |
| `concept-embeddings.db` | Concept-level embeddings for PMI |
| `triple-index.db` | Prebake intermediate |
| `user-data.db` | Runtime user data (bookmarks, highlights, reading analytics) |
| `footnotes-lds-summaries.db` | LDS footnote summaries |

## Directory Structure

```
scicp/
├── ARCHITECTURE.md          # Detailed architecture documentation
├── package.json             # Root npm workspaces config
├── Dockerfile               # Multi-stage Docker build
├── .github/workflows/       # CI/CD (ci.yml, deploy.yml, electron-build.yml)
├── backend/                 # Node.js Fastify + Socket.IO server
│   ├── index.js             # ~3775 lines: all server code
│   └── __tests__/           # Backend tests (157 tests)
├── frontend/                # React 19 SPA (Vite 7)
│   ├── src/
│   │   ├── pages/           # Presenter, Client, Reader, static pages
│   │   ├── components/      # Reusable UI components
│   │   └── __tests__/       # Frontend tests (37 tests)
│   └── public/              # PWA assets, fonts, backgrounds
├── shared/                  # Platform-agnostic CommonJS modules
│   ├── db-adapter.js        # SQLite abstraction (better-sqlite3 / sql.js)
│   ├── scripture-engine.js   # Query/parse logic (~926 lines)
│   ├── intent-detector.js    # TF-IDF + cosine intent classifier
│   └── __tests__/           # Shared tests (23 tests)
├── electron/                # Electron 41 desktop app
│   ├── main.js              # App lifecycle, splash, tray, IPC (~807 lines)
│   ├── preload.js           # contextBridge → window.electronAPI
│   └── loading.html         # Splash screen
├── resources/
│   ├── db/                  # 22 SQLite databases
│   └── onnx/scripture-bge/  # Fine-tuned Nomic-BERT ONNX model
└── scripts/                 # Prebake + ML pipeline scripts
```

## Test Coverage

| Suite | Framework | Tests | Location |
|-------|-----------|-------|----------|
| Backend | Jest 29 | 157 | `backend/__tests__/index.test.js` |
| Shared | Jest 29 | 23 | `shared/__tests__/` |
| Frontend | Vitest | 37 | `frontend/src/__tests__/` |

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend (nodemon) and frontend (Vite dev server) |
| `npm run build` | Build frontend for production |
| `npm run test` | Run all test suites |
| `npm run check:prod` | Production readiness (build + test + lint) |
| `npm run electron:dev` | Run Electron in development mode |
| `npm run electron:build` | Build all platform installers |
| `npm run lint:frontend` | Run ESLint on frontend code |
| `npm run export:training-pairs` | Export training data for model tuning |
| `npm run prepare:training-hard-negatives` | Prepare hard negatives for retraining |

## Environment Variables

Create `.env` from `.env.example`:

```bash
NVIDIA_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
```

## Deployment

- **Web**: Docker image → Railway (health check at `/health`)
- **Desktop**: Electron Builder → GitHub Releases (NSIS, DMG, deb, AppImage)
- **CI**: GitHub Actions (`main` branch) runs `npm run check:prod`

## License

UNLICENSED — Private/proprietary project by Scriptures in View (Dagami Ward Dev)