# scicp — Workspace Instructions

**Sacred Scripture Projector (scicp)** is a real-time, web-based scripture presentation engine for church/worship services. A "Presenter" operator searches and pushes scripture verses live to a "Client" TV/display screen via WebSockets.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20, CommonJS (`require`) |
| HTTP framework | Fastify v5 |
| Real-time | Socket.IO v4 |
| Database | SQLite via `better-sqlite3` (synchronous API) |
| Frontend framework | React 19 (JSX, no TypeScript) |
| Frontend bundler | Vite 7 |
| Routing | React Router v7 |
| Linting | ESLint 9 (flat config) |
| Testing | Jest 29 (backend only) |

---

## Project Structure

```
scicp/
├── backend/
│   ├── index.js          # ALL server code — Fastify + Socket.IO (2000+ lines)
│   ├── package.json
│   ├── logs/
│   └── __tests__/
│       └── index.test.js
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Router + Home page
│   │   ├── socket.js     # Shared Socket.IO singleton (import, don't recreate)
│   │   ├── pages/        # About, Client, Contact, Presenter, Privacy, Terms
│   │   └── components/   # Footer
│   ├── vite.config.js
│   └── eslint.config.js
├── client/               # NOT in workspaces; standalone display-client variant
├── resources/
│   └── db/
│       ├── lds-scriptures-sqlite.db       # English (primary, owns `themes` table)
│       ├── tagalog-scriptures-sqlite.db
│       └── cebuano-scriptures-sqlite.db
├── Dockerfile
├── railway.toml
└── package.json          # Root npm workspaces: backend + frontend
```

---

## Build, Dev, and Test Commands

### Root (run from project root)
```bash
npm run dev           # Start backend (nodemon) + frontend (Vite) — runs sequentially
npm run build         # Build backend (no-op) + frontend (vite build)
npm start             # Start backend in production mode
npm run test:backend  # Run Jest tests for backend
npm run lint:frontend # Run ESLint on frontend
npm run check:prod    # Build + test + lint (full CI check)
```

### Backend only
```bash
npm run dev --workspace=backend    # nodemon index.js
npm start --workspace=backend      # node index.js
npm test --workspace=backend       # jest
```

### Frontend only
```bash
npm run dev --workspace=frontend   # vite (dev server on :5173)
npm run build --workspace=frontend # vite build → frontend/dist/
npm run lint --workspace=frontend  # eslint .
npm run preview --workspace=frontend
```

---

## Architecture Decisions

### Single-file backend
All server code lives in `backend/index.js` (~2000+ lines). This is intentional — do not extract into multiple files without discussion. The file covers: Fastify setup, DB connections, FTS index initialization, all HTTP routes, and all Socket.IO event handlers.

### Testability guard
`backend/index.js` uses `if (require.main === module)` to wrap `start()` and `registerSocketHandlers()`. This allows Jest to `require('../index')` and test exported functions without binding a port or spinning up sockets.

**Add all exported functions at the bottom of `backend/index.js` and document them in tests.**

### Frontend socket singleton
`frontend/src/socket.js` exports a single Socket.IO client instance. **Never create a `new Socket()` in a component.** Always import from `socket.js`:
```js
import socket from '../socket'
```

### Development vs production URLs
- **Dev:** `socket.js` connects to `http://localhost:3000`; API calls use `API_URL = 'http://localhost:3000'`
- **Production:** Socket uses `undefined` (resolves to origin); API calls use relative URLs (`''`)
- The backend serves `frontend/dist/` as static files and handles SPA fallback via `setNotFoundHandler`

---

## Database

**Engine:** SQLite via `better-sqlite3` (synchronous — no async/await on DB calls).

**Databases:**
- `lds-scriptures-sqlite.db` — Primary. Owns `themes` table and `scriptures_fts` FTS5 index.
- `tagalog-scriptures-sqlite.db`, `cebuano-scriptures-sqlite.db` — Translation DBs, queried by `verse_id`.

**Schema:**
```sql
verses(id, scripture_text, chapter_id, verse_number)
chapters(id, book_id, chapter_number)
books(id, book_title)
scriptures          -- view: verse_id, scripture_text, verse_title, book_title
themes(id, name TEXT UNIQUE, data TEXT)  -- JSON-serialized theme objects
scriptures_fts      -- FTS5 virtual table, porter ascii tokenizer, BM25-ranked
```

**FTS index** is built at startup (lazily unless `REBUILD_FTS_ON_START=true`). Use `porter ascii` tokenizer for all FTS queries.

---

## Search Pipeline (backend)

Queries go through these steps in order:
1. Doctrine alias expansion (`DOCTRINE_ALIASES` map — 50+ theological topics)
2. Exact scripture reference parse (e.g., "John 3:16")
3. Book abbreviation expansion (`BOOK_ABBREVIATIONS`)
4. FTS5 AND query (BM25 ranked)
5. FTS5 OR fallback if AND returns zero results

Do not short-circuit or reorder these steps.

---

## Socket.IO Event Reference

**Presenter → Server:**
`create-session`, `join-session`, `leave-session`, `search`, `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `update-language`, `go-live`

**Client (TV) → Server:**
`create-client-session`, `join-session`, `leave-session`

**Server → All room members:**
`update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `viewer-count`, `presenter-joined`, `presenter-takeover-attempt`, `session-joined`, `session-left`, `session-created`, `client-session-created`, `session-error`, `search-results`

---

## Session Model

- Sessions are stored in an **in-memory Map** (not persisted to DB).
- Only **one presenter** per session. A second attempt emits `presenter-takeover-attempt` to the existing presenter.
- Sessions survive disconnections for `SESSION_GRACE_MS` (default 30 min). Client sessions: `CLIENT_SESSION_GRACE_MS` (default 5 min).
- Max **50 concurrent sessions**.
- Long verses are segmented at 200 words via `segmentVerseText(text, 200)`.

---

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` dev / `8080` Docker | Server listen port |
| `NODE_ENV` | `development` | Affects static file serving and Vite mode |
| `PUBLIC_ORIGIN` | Derived from `Host` header | Needed behind reverse proxies/Cloudflare Tunnel for QR codes |
| `REBUILD_FTS_ON_START` | `false` | Set `true` to force drop + rebuild of FTS5 index |
| `SESSION_GRACE_MS` | `1800000` (30 min) | Session keep-alive after last socket disconnect |

No `.env` file — set variables in shell or deployment platform (Railway, Docker).

---

## Deployment

- **Docker:** `docker build .` → serves on port 8080 with `NODE_ENV=production`
- **Railway:** `railway.toml` uses Dockerfile deploy, health check at `/health`, auto-restart on failure
- **DigitalOcean:** See `DEPLOY_DIGITALOCEAN.md`

---

## Coding Conventions

- **JavaScript only** — no TypeScript anywhere (frontend or backend)
- **CommonJS** for backend (`require`/`module.exports`); **ES Modules** for frontend (`import`/`export`)
- **No async DB calls** — `better-sqlite3` is synchronous; keep it that way
- Backend follows **Fastify v5 API** — use `fastify.get(path, handler)` pattern; avoid Express-style middleware
- React components use **function components with hooks** only; no class components
- ESLint errors are enforced in CI (`check:prod`); fix lint errors before committing
- Frontend has **no test suite** — backend tests live in `backend/__tests__/index.test.js`

---

## Common Pitfalls

- **`client/` directory is NOT a workspace.** It has no `package.json` and is not included in `npm install` or builds. Changes there are not reflected in the running app.
- **Don't run `npm run dev` from root expecting a concurrent dev server.** The root dev script runs backend and frontend sequentially (backend first), so the frontend Vite server only starts after the backend exits. Run each workspace dev command in separate terminals.
- **FTS index is only in the English DB.** Multi-language search is done by finding the English verse first, then fetching the translated text by `verse_id`.
- **Session state is ephemeral.** Server restarts clear all sessions. The `themes` table in SQLite is the only persisted state.
- **Do not add a `proxy` to `vite.config.js`** for production — API calls must use relative URLs when bundled, as the backend serves the built frontend.
