# Scriptures in View (scicp)

A real-time scripture projection engine for church and worship services. A **Presenter** operator searches and pushes verses live to a **Client** TV/display screen via WebSockets.

**Desktop app** (Electron) works fully offline with an embedded server. **Web app** runs on any browser. **Mobile app** (PWA/Android) works offline via bundled SQLite databases.

---

## Features

### Search
- **Exact scripture reference** — `John 3:16`, `1 Ne 1:1`, `D&C 76:4`, `1 ne 1 1` (space-separated)
- **Topical Guide search** — single words or phrases matching any of the 3,512 LDS Topical Guide topics (e.g. `faith`, `missionary work`, `baptism for the dead`) return the authoritative verse cluster
- **Phrase / keyword FTS5** — full-text search with BM25 ranking across all 41,995 verses
- **Multi-language search** — search in any of 9 languages; non-English uses FTS5 against that language's DB

### Presentation
- **Live push** — Presenter pushes the current verse to all connected Client screens in real time
- **Dual-language display** — show a primary and secondary language side by side
- **Segment navigation** — long verses auto-split into 200-word segments; Presenter navigates forward/back
- **Verse navigation** — previous/next verse within the same chapter
- **Highlight mode** — highlight a word or phrase on the Client screen
- **Clear screen** — blank the Client display between slides
- **Go Live toggle** — hold a verse in staging before pushing it live

### Context Modal
- **Chapter tab** — browse all verses in the same chapter
- **Related tab** — verses sharing Topical Guide topic clusters with the live verse, scored by overlap; powered by ML embeddings as a secondary signal
- **Translation tab** — same verse in any of the 9 supported languages

### Themes & Sets
- **Custom themes** — font, size, color, background, gradient, blur, overlay opacity — saved to SQLite
- **Set lists** — create ordered playlists of verses for a service; push any verse in the set with one click

### Session Management
- **Multi-client** — unlimited Client viewers per session
- **QR code** — scan to open the Client display URL on any device
- **Session grace period** — sessions survive presenter disconnections for 30 minutes
- **Presenter takeover protection** — a second Presenter gets a confirmation prompt before taking over

### Platforms
- **Web** — hosted on Railway, served as a static SPA + WebSocket backend
- **Desktop** — Electron app with embedded server; auto-updates via GitHub Releases; dual-monitor support (Presenter on primary, Client on secondary)
- **Mobile / PWA** — offline-capable Android APK and installable PWA; all 9 scripture databases bundled; Topical Guide included

---

## Web App Quick Start

```bash
# Install all dependencies (backend + frontend workspaces)
npm install

# Run each in a separate terminal:
npm run dev --workspace=backend    # port 3000
npm run dev --workspace=frontend   # port 5173
```

Open the Presenter at `http://localhost:5173/presenter` and the Client display at `http://localhost:5173/client`.

For production:

```bash
npm run build
npm start
```

The backend serves the built frontend on port 3000.

---

## Desktop App (Electron)

### Development

```bash
npm run electron:dev
```

Builds the frontend and launches the Electron app with the embedded server. The Presenter opens on the primary display; if a second monitor is connected, the Client projection window opens there automatically.

### Build Installers

```bash
npm run electron:build           # Current platform
npm run electron:build:win       # Windows (NSIS installer)
npm run electron:build:mac       # macOS (DMG)
npm run electron:build:linux     # Linux (AppImage + .deb)
```

Installers are written to `dist-electron/`.

### Auto-Updates

The desktop app checks for updates on startup. Updates are published to [GitHub Releases](https://github.com/chainuser1/scicp/releases). On Linux AppImage, the app directs you to the releases page instead.

**Release workflow:**
1. Bump `version` in `package.json`
2. Commit and tag: `git tag v1.1.0`
3. Push the tag: `git push origin v1.1.0`
4. GitHub Actions builds all platforms and publishes to Releases

---

## Mobile App

```bash
cd mobile
npm install
npm run build          # copies DBs + builds Vite bundle
npx cap sync android   # sync to Android project
npx cap open android   # open in Android Studio
```

The mobile app is a fully offline PWA/Android app. All 9 scripture databases and the Topical Guide are bundled as static assets loaded via sql.js WASM.

---

## Deployment

### Docker

```bash
docker build -t scicp .
docker run -p 8080:8080 scicp
```

### Railway

The repository includes `railway.toml` using the Dockerfile. Push to your Railway project — it builds automatically. Health check: `/health`.

> **Note:** `REBUILD_FTS_ON_START` is set to `false` in both `railway.toml` and the `Dockerfile`. All FTS5 indexes are pre-built in the committed database files — Railway starts instantly without rebuilding indexes.

---

## Supported Languages

| Code | Language | Database |
|---|---|---|
| `en` | English (KJV / LDS) | lds-scriptures-sqlite.db |
| `nrsvue` | English (NRSVUE) | nrsvue-scriptures-sqlite.db |
| `tl` | Tagalog | tagalog-scriptures-sqlite.db |
| `ceb` | Cebuano | cebuano-scriptures-sqlite.db |
| `ilo` | Ilocano | ilocano-scriptures-sqlite.db |
| `war` | Waray | waray-scriptures-sqlite.db |
| `es` | Spanish | spanish-scriptures-sqlite.db |
| `el` | Greek (interlinear) | greek-scriptures-sqlite.db |
| `ja` | Japanese | japanese-scriptures-sqlite.db |

---

## LDS Topical Guide

The app includes the complete [LDS Topical Guide](https://www.churchofjesuschrist.org/study/scriptures/tg) as a separate SQLite database (`topical-guide.db`):

- **3,512 topics** covering doctrinal, historical, and thematic subjects
- **62,878 verse-topic mappings** — 100% of verses mapped
- Used for search (authoritative topic clusters), related-verse scoring, and offline mobile search
- Queries like `faith`, `repentance`, `missionary work`, `baptism for the dead` resolve directly to the canonical verse list for that topic

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Fastify 5, Socket.IO 4 |
| Database | SQLite via better-sqlite3 (server/Electron), sql.js WASM (mobile) |
| Frontend | React 19, Vite 7, React Router 7 |
| Desktop | Electron 35, electron-builder |
| Mobile | Capacitor, sql.js, PWA |

---

## Project Structure

```
scicp/
├── backend/          # Fastify server, Socket.IO handlers, all routes (~2000 lines)
├── frontend/         # React SPA (Presenter, Client, About, Contact pages)
├── electron/         # Electron main process + preload script
├── mobile/           # Offline PWA/Android app (sql.js + Capacitor)
├── shared/           # scripture-engine.js + db-adapter.js shared by all platforms
│   └── data/         # book abbreviations, citations, language maps
├── resources/db/     # SQLite scripture databases (FTS5 pre-built)
├── Dockerfile
├── railway.toml
└── package.json      # npm workspaces: backend + frontend
```

For developer workspace details, see [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

---

## License

ISC

