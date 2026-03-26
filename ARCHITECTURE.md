# Architecture Overview

Sacred Scripture Projector (scicp) is a real-time scripture presentation engine. A Presenter operator searches and pushes scripture verses to Client display screens via WebSockets. A Reader mode provides personal scripture study with highlights, bookmarks, and reading analytics.

## System Architecture

```
┌─────────────┐    Socket.IO     ┌──────────────────┐    Socket.IO    ┌─────────────┐
│  Presenter   │ ◄─────────────► │   Node.js Server │ ◄────────────► │   Client TV  │
│  (React SPA) │                 │   (Fastify 5 +   │                │  (React SPA) │
└─────────────┘                  │    Socket.IO 4)   │                └─────────────┘
                                 └───────┬──────────┘
┌─────────────┐    REST + WS             │
│   Mobile    │ ◄────────────►           │
│ (Capacitor) │                  ┌───────┴──────────┐
└─────────────┘                  │   SQLite DBs      │
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
| Mobile (Capacitor) | `mobile/` | Capacitor 7, Vite, React | No (caches chapters) |
| Shared Logic | `shared/` | CommonJS, used by all platforms | — |

## Application Modes

### Presenter Mode
Session-based real-time projection. Presenter searches, stages, and pushes verses to connected displays. Features: set lists, dual language, theme customization, text highlighting, verse notes.

### Reader Mode
Personal scripture study. Features: continuous prose chapter reading, 5 visual themes, 4-color highlights, bookmarks, reading analytics (dwell time, pace, coverage), chapter/verse context sheets, offline chapter caching.

### Client (TV Display)
Passive display that receives verses from the Presenter. Auto-formats text, supports themes, shows highlighted text. Creates sessions via QR code or manual code.

## Mobile Architecture

The mobile app uses a 4-tab root navigation:

| Tab | Component | Purpose |
|-----|-----------|---------|
| Home | `HomePage.jsx` | Landing page with mode cards (Present / Read) |
| Read | `ReaderApp.jsx` | Personal study: browse, read, bookmarks, reading stats |
| Present | Presenter flow | QR scan → session → search → stage → go live |
| More | `MorePage.jsx` | About, Contact, Privacy, Terms, settings |

### Reader Sub-Navigation
Within the Read tab, ReaderApp manages internal screens:
- **ReaderHome** — search bar, topic chips, book grid, continue reading
- **ReaderBrowse** — search results, chapter/verse browse
- **ChapterReader** — immersive reading with highlights, long-press menu
- **ReaderBookmarks** — search, categories, grouped by book
- **ReadingTab** — history, stats, spaced review

### Key Hooks (mobile)
- `useSocket` — Socket.IO connection, reconnection, offline queue
- `useSearch` — debounced search with result management
- `useHighlights` — 4-color verse highlighting (localStorage)
- `useReaderBookmarks` — bookmarks with metadata, categories
- `useReaderPrefs` — theme, font size, line height, font family, language
- `useReadingAnalytics` — IntersectionObserver-based dwell tracking
- `useNotes` — private verse notes (localStorage)

## Search Pipeline

The backend implements a 41-component mathematical search pipeline in `backend/index.js`. Query flow:

1. **Input parsing** — Scripture reference detection, abbreviation expansion, doctrine alias expansion (50+ topics)
2. **FTS5 retrieval** — Full-text search with BM25 ranking (AND query, OR fallback)
3. **Semantic scoring** — MiniLM-L6 embeddings with ZCA whitening, cosine similarity
4. **Entity resolution** — Named entity recognition with polynomial feature scoring
5. **Graph propagation** — kNN verse graph, spectral features, cross-reference boosting
6. **Fusion** — Reciprocal Rank Fusion (RRF) combining FTS + semantic + graph signals
7. **Re-ranking** — MMR diversity, session context, learned weight optimization (Adam)
8. **Calibration** — Isotonic regression (PAV), soft sigmoid tier gating

Multi-language search finds English verses first, then fetches translations by `verse_id`.

## Database Schema

| Database | Purpose |
|----------|---------|
| `lds-scriptures-sqlite.db` | English scriptures, themes table, FTS5 index |
| `tagalog-scriptures-sqlite.db` | Tagalog translations |
| `cebuano-scriptures-sqlite.db` | Cebuano translations |
| `verse-embeddings.db` | 384D MiniLM embeddings (raw + whitened) |
| `search-graph.db` | kNN graph, spectral features, training pairs |

Key tables: `verses`, `chapters`, `books`, `scriptures` (view), `scriptures_fts` (FTS5), `themes`, `verse_embeddings_white`, `verse_knn`, `verse_spectral`

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
| Mobile | Vitest | 73 | `mobile/src/__tests__/` |
| Frontend | ESLint | lint only | `frontend/eslint.config.js` |

## Deployment

- **Production:** Docker image → Railway (health check at `/health`)
- **Desktop:** Electron Builder via GitHub Actions → Windows/macOS/Linux installers
- **Mobile:** Capacitor build → Android APK
- **CI:** `npm run check:prod` — build + test + lint

See `README.md` for build commands.
