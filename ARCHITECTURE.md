# Architecture Overview

Sacred Scripture Projector (scicp) is a real-time scripture presentation engine. A Presenter operator searches and pushes scripture verses to Client display screens via WebSockets.

## System Architecture

```
┌─────────────┐    Socket.IO     ┌──────────────────┐    Socket.IO    ┌─────────────┐
│  Presenter   │ ◄─────────────► │   Node.js Server │ ◄────────────► │   Client TV  │
│  (React SPA) │                 │   (Fastify +     │                │  (React SPA) │
└─────────────┘                  │    Socket.IO)    │                └─────────────┘
                                 └───────┬──────────┘
                                         │
                                 ┌───────┴──────────┐
                                 │   SQLite DBs      │
                                 │  (better-sqlite3) │
                                 └──────────────────┘
```

## Platforms

| Platform | Directory | Runtime |
|----------|-----------|---------|
| Web (Presenter + Client) | `frontend/` | React 19, Vite 7 |
| Backend API + WebSocket | `backend/` | Node.js 20, Fastify 5, Socket.IO 4 |
| Desktop (Electron) | `electron/` | Electron 35, embedded backend |
| Mobile (Capacitor) | `mobile/` | Capacitor 7, sql.js WASM |
| Shared Logic | `shared/` | CommonJS, used by all platforms |

## Search Pipeline

The backend implements a 41-component mathematical search pipeline in `backend/index.js`. Query flow:

1. **Input parsing** — Scripture reference detection, abbreviation expansion, doctrine alias expansion
2. **FTS5 retrieval** — Full-text search with BM25 ranking (AND query, OR fallback)
3. **Semantic scoring** — MiniLM-L6 embeddings with ZCA whitening, cosine similarity
4. **Entity resolution** — Named entity recognition with polynomial feature scoring
5. **Graph propagation** — kNN verse graph, spectral features, cross-reference boosting
6. **Fusion** — Reciprocal Rank Fusion (RRF) combining FTS + semantic + graph signals
7. **Re-ranking** — MMR diversity, session context, learned weight optimization (Adam)
8. **Calibration** — Isotonic regression (PAV), soft sigmoid tier gating

## Database Schema

- `lds-scriptures-sqlite.db` — English scriptures, themes table, FTS5 index
- `tagalog-scriptures-sqlite.db` — Tagalog translations
- `cebuano-scriptures-sqlite.db` — Cebuano translations
- `verse-embeddings.db` — 384D MiniLM embeddings (raw + whitened)
- `search-graph.db` — kNN graph, spectral features, training pairs

Key tables: `verses`, `chapters`, `books`, `scriptures` (view), `scriptures_fts` (FTS5), `themes`, `verse_embeddings_white`, `verse_knn`, `verse_spectral`

## Session Model

- In-memory Map (not persisted to DB)
- One presenter per session; second attempt triggers takeover flow
- Grace period on disconnect (30 min presenter, 5 min client)
- Max 50 concurrent sessions

## Deployment

- **Production:** Docker image built in GitHub Actions → pushed to GHCR → Railway pulls image
- **Desktop:** Electron Builder via GitHub Actions → Windows/macOS/Linux installers
- **Mobile:** Capacitor build → Android APK

See `README.md` for build commands, `.github/workflows/` for CI pipelines.
