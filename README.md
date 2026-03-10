# Scriptures in View (scicp)

A real-time scripture projection engine for church and worship services. A Presenter operator searches and pushes scripture verses to a Client display screen via WebSockets.

**Desktop app** (Electron) works offline with an embedded server. **Web app** runs on any device with a browser.

---

## Web App Quick Start

```bash
# Install all dependencies (backend + frontend workspaces)
npm install

# Start the backend (port 3000) and frontend dev server (port 5173)
# Run each in a separate terminal:
npm run dev --workspace=backend
npm run dev --workspace=frontend
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

Builds the frontend and launches the Electron app with the embedded server. The Presenter opens on your primary display; if a second monitor is connected, the Client projection window opens there automatically.

### Build Installers

```bash
# Current platform
npm run electron:build

# Specific platform
npm run electron:build:win    # Windows (NSIS installer)
npm run electron:build:mac    # macOS (DMG)
npm run electron:build:linux  # Linux (AppImage + .deb)
```

Installers are written to `dist-electron/`.

### Auto-Updates

The desktop app checks for updates on startup. When a new version is available, a dialog prompts you to download and install it. The app restarts after the update is applied.

Updates are published to [GitHub Releases](https://github.com/chainuser1/scicp/releases). On Linux AppImage, auto-update is not supported; the app directs you to the releases page instead.

**Release workflow:**

1. Bump `version` in `package.json`
2. Commit and tag: `git tag v1.1.0`
3. Push the tag: `git push origin v1.1.0`
4. GitHub Actions builds all platforms and publishes to Releases

---

## Deployment

### Docker

```bash
docker build -t scicp .
docker run -p 8080:8080 scicp
```

The app listens on port 8080 with `NODE_ENV=production`.

### Railway

The repository includes a `railway.toml` that uses the Dockerfile for deployment. Push to your Railway project and it builds automatically. Health check endpoint: `/health`.

---

## Supported Languages

| Code | Language | Database |
|---|---|---|
| en | English (KJV) | lds-scriptures-sqlite.db |
| nrsvue | English (NRSVUE) | nrsvue-scriptures-sqlite.db |
| tl | Tagalog | tagalog-scriptures-sqlite.db |
| ceb | Cebuano | cebuano-scriptures-sqlite.db |
| ilo | Ilocano | ilocano-scriptures-sqlite.db |
| war | Waray | waray-scriptures-sqlite.db |
| es | Spanish | spanish-scriptures-sqlite.db |
| el | Greek | greek-scriptures-sqlite.db |
| ja | Japanese | japanese-scriptures-sqlite.db |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Fastify 5, Socket.IO 4 |
| Database | SQLite via better-sqlite3 |
| Frontend | React 19, Vite 7, React Router 7 |
| Desktop | Electron 34, electron-builder 25 |

---

## Project Structure

```
scicp/
├── backend/          # Fastify server, Socket.IO handlers, SQLite queries
├── frontend/         # React SPA (Presenter + Client pages)
├── electron/         # Electron main process + preload script
├── resources/db/     # SQLite scripture databases
├── Dockerfile
├── railway.toml
└── package.json      # npm workspaces: backend + frontend
```

For developer workspace details, see [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

---

## License

ISC
