# Scriptures in View — Frontend

React 19 + Vite 7 web interface for Scriptures in View.

## Pages

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Landing page |
| Presenter | `/presenter` | Search and push verses live to displays |
| Client | `/client` | Passive TV display |
| Reader | `/reader` | Personal immersive scripture study |
| Download | `/download` | Electron desktop app download |
| About / Contact / Privacy / Terms | `/about` etc. | Info pages |

## Key conventions

- **`src/socket.js`** — single Socket.IO client instance. Never recreate it in a component; always `import socket from '../socket'`.
- **`window.electronAPI`** — available only inside the Electron desktop app. Guards: `!!window.electronAPI?.isElectron`. Exposes: `openModeSwitcher`, `onModeChanged`, `switchConnectionMode`, `changeProjectionDisplay`, `getDisplays`, `getAppVersion`, `onUpdateStatus`.
- **Dev vs production URLs** — `API_URL = import.meta.env.MODE === 'production' ? '' : 'http://localhost:3000'`. Do not add a Vite proxy; the backend serves `frontend/dist/` in production.
- **ESLint** — errors block CI. Run `npm run lint --workspace=frontend` before committing.

## Run locally

```bash
npm run dev --workspace=backend      # backend on :3000 (start first)
npm run dev --workspace=frontend     # Vite on :5173
```

## Build

```bash
npm run build --workspace=frontend   # outputs to frontend/dist/
```

## Tests

```bash
npm test --workspace=frontend        # Vitest
npm run lint --workspace=frontend    # ESLint
```
