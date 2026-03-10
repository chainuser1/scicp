'use strict';

const { app, BrowserWindow, screen, shell } = require('electron');
const path = require('path');
const http = require('http');

const isDev = !app.isPackaged;

// ─── Path resolution ──────────────────────────────────────────────────────────
// Must be set BEFORE requiring the backend because the backend reads these
// paths at module-load time (SQLite connections, static file serving).
if (isDev) {
  process.env.DB_DIR             = path.resolve(__dirname, '../resources/db');
  process.env.FRONTEND_DIST_DIR  = path.resolve(__dirname, '../frontend/dist');
} else {
  // electron-builder copies resources into process.resourcesPath
  process.env.DB_DIR             = path.join(process.resourcesPath, 'db');
  process.env.FRONTEND_DIST_DIR  = path.join(process.resourcesPath, 'frontend-dist');
}
process.env.PORT = process.env.PORT || '3000';

// ─── Start embedded backend ───────────────────────────────────────────────────
const { startElectron } = require('../backend/index.js');

// ─── Poll until the Fastify server is accepting connections ───────────────────
function waitForServer(cb) {
  const attempt = () => {
    http.get('http://127.0.0.1:3000/', () => cb())
      .on('error', () => setTimeout(attempt, 200));
  };
  attempt();
}

// ─── Window management ────────────────────────────────────────────────────────
let presenterWin = null;
let clientWin    = null;

function createWindows() {
  const displays = screen.getAllDisplays();
  const primary  = screen.getPrimaryDisplay();
  const secondary = displays.find(d => d.id !== primary.id);

  const preload = path.join(__dirname, 'preload.js');
  const icon    = isDev
    ? path.resolve(__dirname, '../frontend/public/emblem.ico')
    : path.join(process.resourcesPath, 'emblem.ico');

  // ── Presenter window (control panel) ────────────────────────────────────
  presenterWin = new BrowserWindow({
    width:  1280,
    height: 820,
    x: primary.bounds.x + 40,
    y: primary.bounds.y + 40,
    title: 'Scriptures in View — Presenter',
    icon,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  presenterWin.setMenuBarVisibility(false);
  presenterWin.loadURL('http://127.0.0.1:3000/presenter?session=LOCAL');

  // Open external links in the system browser, not in Electron
  presenterWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  presenterWin.on('closed', () => { presenterWin = null; });

  // ── Client / display window (projected screen) ───────────────────────────
  const clientBounds = secondary
    ? secondary.bounds
    : { x: primary.bounds.x + 80, y: primary.bounds.y + 80, width: 1280, height: 720 };

  clientWin = new BrowserWindow({
    x:         clientBounds.x,
    y:         clientBounds.y,
    width:     clientBounds.width,
    height:    clientBounds.height,
    fullscreen: !!secondary,   // fullscreen only when a real second display exists
    title: 'Scriptures in View — Display',
    icon,
    frame:     !secondary,     // no chrome on secondary display
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  clientWin.setMenuBarVisibility(false);
  clientWin.loadURL('http://127.0.0.1:3000/client?electron=1');

  clientWin.on('closed', () => { clientWin = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await startElectron();
  } catch (err) {
    console.error('Backend failed to start:', err);
    app.quit();
    return;
  }
  waitForServer(createWindows);
});

app.on('window-all-closed', () => {
  // On macOS it is conventional to keep the app running, but for a
  // presentation tool "close last window = quit" is the right behaviour.
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    waitForServer(createWindows);
  }
});
