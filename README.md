# Scriptures in View (scicp)

Scriptures in View is a scripture presentation app for church worship, lessons, talks, and home study.  
One person controls the verses, and the congregation sees a clean display screen.

Built and maintained by **Dagami Ward Dev**.

---

## What the app can do

- Search scripture references quickly (example: `John 3:16`)
- Search by topic and related ideas
- Stage verses first, then send them live to the display
- Show primary and secondary language together
- Move to previous/next verse or segment for long passages
- Highlight words or phrases during teaching
- Save visual themes and prepared verse lists
- Run on Web, Desktop, and Android, including offline use

---

## Allowed Use

This software is for **non-commercial church use and home use only**.  
Users are responsible for using the app in accordance with applicable laws and regulations.

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

### Release Checksum Digests

- Windows SHA256: `4feeb9e6620197a8a3136aabcbb9fd849f482a8f4afc254b390225a7327d6ddd`
- Linux SHA256: `e6291127b52c1c3d025375361bb3e79544177da67a69c8552f9759a885b9c1b4`
- Mac SHA256: `ec5d380ce6200833887d8d5c5ae8403644b9829d62d80265d44bcd20453f77b2`

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

- Android SHA256: `11a670361a6426981391d5250895d06977a99b697480127ff1cd4b0c4463a604`

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
