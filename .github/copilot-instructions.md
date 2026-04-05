# scicp — Workspace Instructions

**Scriptures in View (scicp)** is a real-time scripture presentation engine for church/worship services. A "Presenter" searches and pushes verses live to a "Client" TV display via WebSockets. A "Reader" mode supports personal scripture study. A desktop app (Electron) supports fully-offline use.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for system diagrams, search pipeline details, and benchmark status.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20, CommonJS (`require`) |
| HTTP framework | Fastify v5 |
| Real-time | Socket.IO v4 |
| Database | SQLite via `better-sqlite3` (synchronous API) |
| Frontend framework | React 19 (JSX, no TypeScript) |
| Frontend bundler | Vite 7 (tests via Vitest) |
| Routing | React Router v7 |
| Desktop | Electron 35 |
| Shared logic | `shared/` workspace (CommonJS, runs in Node + WASM/browser) |
| Linting | ESLint 9 (flat config) |
| Testing | Jest 29 (backend + shared); Vitest (frontend) |

---

## Project Structure

```
scicp/
├── backend/
│   ├── index.js          # ALL server code — Fastify + Socket.IO (~2500 lines)
│   └── __tests__/        # Jest tests — index.test.js
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Router + Home page
│   │   ├── socket.js     # Shared Socket.IO singleton (import, don't recreate)
│   │   ├── pages/        # About, Client, Contact, Download, Presenter, Reader, Privacy, Terms
│   │   └── components/   # ConnectionStatus, ErrorBoundary, Footer, LoadingSpinner, SEO, Toast
│   ├── vite.config.js    # also configures Vitest
│   └── eslint.config.js
├── shared/               # npm workspace — pure functions, DB adapters, scripture engine
│   ├── db-adapter.js     # BetterSqliteAdapter + SqlJsAdapter (same API for both runtimes)
│   ├── scripture-engine.js # parseScriptureReference, segmentVerseText, expandBookName, etc.
│   └── __tests__/
├── electron/             # Electron main process (embedded backend, auto-update)
│   ├── main.js
│   └── preload.js
├── scripts/              # Prebake + ML pipeline scripts — see scripts/README.md
├── resources/
│   └── db/               # SQLite databases (20+ files — see ARCHITECTURE.md for full schema)
├── Dockerfile
├── railway.toml
└── package.json          # Root npm workspaces: backend + frontend + shared
```

---

## Build, Dev, and Test Commands

### Root (run from project root)
```bash
npm run dev           # Backend (nodemon) then frontend (Vite) — SEQUENTIAL, not concurrent
npm run build         # Build frontend (vite build)
npm start             # Start backend in production mode
npm test              # Run all suites: backend + shared + frontend
npm run test:backend  # Jest — backend/__tests__/
npm run test:shared   # Jest — shared/__tests__/
npm run test:frontend # Vitest — frontend/src/__tests__/
npm run lint:frontend # ESLint on frontend
npm run check:prod    # Build + all tests + lint (CI gate)
```

### Backend / Shared / Frontend only
```bash
npm run dev --workspace=backend      # nodemon index.js
npm test --workspace=backend         # jest
npm test --workspace=shared          # jest
npm run dev --workspace=frontend     # vite dev server on :5173
npm run build --workspace=frontend   # vite build → frontend/dist/
npm run lint --workspace=frontend    # eslint .
```

### Electron
```bash
npm run electron:dev            # Build frontend + launch Electron (dev)
npm run electron:build:linux    # Build AppImage (Linux)
npm run electron:build:win      # Build Windows installer
npm run electron:build:mac      # Build macOS DMG
```

### ML / Prebake pipeline
```bash
scripts/post-train-rebuild.sh   # Full rebuild after model update (see scripts/README.md)
npm run capture:search-baseline # Save search results snapshot
npm run evaluate:search-benchmark   # Score against judged queries
npm run prepare:training-hard-negatives  # Export + mine hard negatives
```

### Pushing rebuilt analysis DBs
**Always use `scripts/push-data.sh`** — never `git push` directly after a rebuild.

```bash
scripts/push-data.sh                        # auto-generated commit message
scripts/push-data.sh "bgE-base v2 retrain"  # optional message suffix
scripts/push-data.sh --no-amend             # force a fresh commit instead of amending
```

The script stages only changed LFS-tracked DBs, amends the previous `data:` commit in-place (so LFS stores exactly one version of each DB — no quota bloat), then force-with-lease pushes. The `deploy.yml` workflow detects the `data:` commit prefix and pulls fresh from LFS before baking a new GHCR image. CI and Electron builds then pull from that updated GHCR image automatically.

---

## Architecture Decisions

### Single-file backend
All server code lives in `backend/index.js` (~2500 lines). This is intentional — do not extract into multiple files without discussion. The file covers: Fastify setup, DB connections, ONNX model loading, FTS index initialization, all HTTP routes, all Socket.IO event handlers, and the 41-component search pipeline.

### Shared workspace
Pure helper functions that must work in both Node.js and WASM/browser (e.g. Electron renderer, future PWA) live in `shared/`:
- `shared/db-adapter.js` — normalizes `better-sqlite3` (Node) and `sql.js` (WASM) to the same `.prepare().all/get/run()` API
- `shared/scripture-engine.js` — `parseScriptureReference`, `segmentVerseText`, `expandBookName`, etc.

**New query helpers go in `shared/`, not `backend/index.js`**, unless they require server-only deps (ONNX, HNSW).

### Testability guard
`backend/index.js` uses `if (require.main === module)` to guard `start()` and `registerSocketHandlers()`. This lets Jest `require('../index')` and test exported functions without binding a port.

**Exported functions must appear at the bottom of `backend/index.js` and be documented in tests.**

### Frontend socket singleton
`frontend/src/socket.js` exports a single Socket.IO client instance. **Never instantiate `new Socket()` in a component.** Always:
```js
import socket from '../socket'
```

### Development vs production URLs
- **Dev:** `socket.js` connects to `http://localhost:3000`; API calls use `API_URL = 'http://localhost:3000'`
- **Production:** Socket uses `undefined` (resolves to origin); API calls use relative URLs (`''`)
- Backend serves `frontend/dist/` as static files with SPA fallback via `setNotFoundHandler`

### Electron ABI isolation
`electron/main.js` patches `require('better-sqlite3')` at startup to route to the Electron-ABI build in `electron/node_modules/`. **Never `npm install better-sqlite3` inside `electron/` directly** — use `npm run electron:install` which calls `scripts/sync-electron-deps.js` first.

---

## Database

**Engine:** `better-sqlite3` — synchronous. **No `async/await` on DB calls, ever.**

**Primary DB:** `lds-scriptures-sqlite.db` — owns `themes` table and `scriptures_fts` FTS5 index.

**Translation DBs** (queried by `verse_id`): `tagalog`, `cebuano`, `spanish`, `greek`, `ilocano`, `japanese` (optional), `waray` (optional), `ylt` (optional).

**Analysis DBs** (large, tracked via Git LFS or pulled from GHCR in CI):
`verse-embeddings.db`, `verse-graph.db`, `search-graph.db`, `verse-tags.db`, `verse-summaries.db`, `topical-guide.db`, `verse-cross-refs.db`, `triple-index.db`, `concept-embeddings.db`, `chapter-summaries-fts.db`, `footnotes-lds-summaries.db`

See [ARCHITECTURE.md](../ARCHITECTURE.md#database-schema) for full schema.

**FTS index** builds lazily at startup unless `REBUILD_FTS_ON_START=true`. Use `porter ascii` tokenizer for all FTS queries.

---

## Search Pipeline (v2.0, Apr 2026)

The backend runs an 8-step, 41-component pipeline. See [ARCHITECTURE.md](../ARCHITECTURE.md#search-pipeline) for the full spec.

**Do not short-circuit or reorder steps. Do not inject topical synonyms manually** — use corpus-derived stats (PMI, embedding neighbors) only.

Key rules:
- **ZCA whitening is DISABLED** (`prebake-whitening.js` is deprecated). Use raw L2-normalized embeddings only.
- Semantic threshold `SEM_THRESHOLD_BASE=0.28`, floor `SIM_FLOOR=0.15` (tuned for raw cosine scale).
- Specificity tiers: T1 reference ~6.0, T2 phrase ~4.8, T3 keyword ~3.8, T4 semantic ~2.0, T5 graph ~0.5.
- `_specificity_score` is exposed on every API result — use it to verify ranking correctness.

---

## Socket.IO Events

**Presenter → Server:** `create-session`, `join-session`, `leave-session`, `search`, `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `update-language`, `go-live`

**Client (TV) → Server:** `create-client-session`, `join-session`, `leave-session`

**Server → Room:** `update-verse`, `update-theme`, `highlight-text`, `clear-screen`, `viewer-count`, `presenter-joined`, `presenter-takeover-attempt`, `session-joined`, `session-left`, `session-created`, `client-session-created`, `session-error`, `search-results`

---

## Session Model

- Stored in **in-memory Map** — server restart clears all sessions.
- **One presenter** per session; second attempt emits `presenter-takeover-attempt`.
- Grace periods: 30 min (presenter), 5 min (client).
- Max **50 concurrent sessions**.
- Long verses segmented at 200 words via `segmentVerseText()` (in `shared/`).

---

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` dev / `8080` Docker | Server listen port |
| `NODE_ENV` | `development` | Affects static serving and `SKIP_RECOMPUTE` |
| `PUBLIC_ORIGIN` | Derived from `Host` header | Required behind reverse proxies/Cloudflare Tunnel |
| `REBUILD_FTS_ON_START` | `false` | Set `true` to force FTS5 index rebuild |
| `SESSION_GRACE_MS` | `1800000` (30 min) | Session keep-alive after disconnect |
| `DB_DIR` | `resources/db/` | Override DB directory (Electron uses extraResources) |
| `USER_DATA_DIR` | Same as `DB_DIR` | Writable dir for user data (themes, reader state) |
| `FRONTEND_DIST_DIR` | `frontend/dist/` | Override built frontend path |
| `SENTRY_DSN` | unset | Enable Sentry crash reporting (backend + Electron main) |

No `.env` file — set in shell or deployment platform.

---

## Deployment

- **Docker/Railway:** `docker build .` → port 8080, `NODE_ENV=production`. Health check at `/health`. See `railway.toml`.
- **Desktop:** `npm run electron:build:*` → GitHub Actions CI builds signed installers. Electron auto-update enabled if `SENTRY_DSN` configured.
- **CI gate:** `npm run check:prod` — build + all tests + lint. Analysis DBs resolved from GHCR image first (fallback: `git lfs pull`).

---

## Coding Conventions

- **JavaScript only** — no TypeScript anywhere
- **CommonJS** in backend + shared (`require`/`module.exports`); **ES Modules** in frontend (`import`/`export`)
- **No async DB calls** — `better-sqlite3` is synchronous; keep it that way
- **Fastify v5 API** — `fastify.get(path, handler)` pattern; no Express-style middleware
- **React function components with hooks only** — no class components
- **Shared helpers** — pure query/parse functions belong in `shared/`, not `backend/index.js`
- ESLint errors block CI; fix before committing

---

## Common Pitfalls

- **`client/` is not a workspace** — no `package.json`, not in `npm install`. Changes there have no effect.
- **Dev script is sequential**, not concurrent — `npm run dev` runs backend first; frontend only starts after backend exits. Use separate terminals: `npm run dev --workspace=backend` + `npm run dev --workspace=frontend`.
- **FTS index is only in the English DB.** Multi-language search: find English verse first, then fetch translation by `verse_id`.
- **Analysis DBs are large.** They are NOT committed as regular git blobs — they're tracked via Git LFS or pulled from GHCR in CI. Running scripts that depend on them locally requires `git lfs pull` or a manual download.
- **ZCA whitening is permanently disabled.** Do not re-enable `prebake-whitening.js` — it inverts cosine similarity rankings (see ARCHITECTURE.md for root cause).
- **Electron `better-sqlite3` ABI mismatch** — the version in `node_modules/` (hoisted from backend) is compiled for system Node, not Electron. `electron/main.js` patches module resolution at boot. Do not remove this patch.
- **Session state is ephemeral** — server restart clears all in-memory sessions.
- **Do not add a `proxy` to `vite.config.js`** for production — API calls must use relative URLs when bundled, as the backend serves the built frontend.
- **Never `git push` directly after a rebuild** — always use `scripts/push-data.sh`. It amends the `data:` commit in-place so LFS stores only one version of each DB. A plain push bypasses this and bloats LFS quota.
