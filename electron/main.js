// ─── Redirect require('better-sqlite3') to electron/node_modules ────────────
// backend/index.js resolves better-sqlite3 from root/node_modules (hoisted from
// the backend workspace, compiled for system Node ABI). This override ensures the
// Electron-ABI build in electron/node_modules is used instead — in both dev mode
// (electron/ dir) and the packaged app (app.asar root where node_modules lives).
;(function patchBetterSqlite3() {
  const Module = require('module');
  const path   = require('path');
  const fs     = require('fs');
  const orig   = Module._resolveFilename.bind(Module);
  Module._resolveFilename = (req, ...rest) => {
    if (req !== 'better-sqlite3') return orig(req, ...rest);

    const candidates = [
      path.join(__dirname, 'node_modules/better-sqlite3'),
      path.join(__dirname, '../node_modules/better-sqlite3'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked/electron/node_modules/better-sqlite3'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked/node_modules/better-sqlite3'),
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return orig(candidate, ...rest);
      }
    }
    return orig(req, ...rest);
  };
})();

'use strict';

const { app, BrowserWindow, screen, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs   = require('fs');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('electron-updater unavailable; auto-update disabled:', err.message);
}

// ─── Global error handlers ────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  dialog.showErrorBox('Unexpected Error', `${err.message}\n\nThe application will restart.`);
  app.relaunch();
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

function logLifecycle(msg) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'app.log');
    // Rotate if > 5MB
    try {
      const stats = fs.statSync(logFile);
      if (stats.size > 5 * 1024 * 1024) {
        fs.renameSync(logFile, path.join(logDir, 'app.log.1'));
      }
    } catch { /* file doesn't exist yet */ }
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `[${ts}] ${msg}\n`);
  } catch { /* logging must never crash the app */ }
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const isDev = !app.isPackaged;

// ─── Path resolution ──────────────────────────────────────────────────────────
if (isDev) {
  process.env.DB_DIR             = path.resolve(__dirname, '../resources/db');
  process.env.FRONTEND_DIST_DIR  = path.resolve(__dirname, '../frontend/dist');
  process.env.USER_DATA_DIR      = path.resolve(__dirname, '../resources/db');
} else {
  // AppImage / packaged builds: extraResources live on a read-only squashfs.
  // SQLite needs journal/WAL access, so copy DBs to writable userData on first run.
  const srcDbDir  = path.join(process.resourcesPath, 'db');
  const destDbDir = path.join(app.getPath('userData'), 'db');
  if (!fs.existsSync(destDbDir)) fs.mkdirSync(destDbDir, { recursive: true });
  for (const file of fs.readdirSync(srcDbDir)) {
    const src = path.join(srcDbDir, file);
    const dest = path.join(destDbDir, file);
    const srcStat = fs.statSync(src);
    const needsCopy = !fs.existsSync(dest) || fs.statSync(dest).mtimeMs < srcStat.mtimeMs;
    if (needsCopy) {
      try {
        fs.copyFileSync(src, dest);
      } catch (err) {
        console.error(`[DB] Failed to copy ${file}:`, err.message);
      }
    }
  }
  // Verify copied DBs are valid SQLite files
  const mainDb = path.join(destDbDir, 'lds-scriptures-sqlite.db');
  if (fs.existsSync(mainDb)) {
    const header = Buffer.alloc(6);
    const fd = fs.openSync(mainDb, 'r');
    fs.readSync(fd, header, 0, 6, 0);
    fs.closeSync(fd);
    if (header.toString('utf8') !== 'SQLite') {
      console.error('[DB] Main database is corrupt — re-copying from source');
      fs.copyFileSync(path.join(srcDbDir, 'lds-scriptures-sqlite.db'), mainDb);
    }
  }
  process.env.DB_DIR             = destDbDir;
  process.env.FRONTEND_DIST_DIR  = path.join(process.resourcesPath, 'frontend-dist');
  process.env.USER_DATA_DIR      = app.getPath('userData');
}
// Find an available port (default 3000, try up to 3010)
function findAvailablePort(start, max) {
  const net = require('net');
  return new Promise((resolve) => {
    const tryPort = (port) => {
      if (port > max) return resolve(start); // fallback to default
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
      server.once('listening', () => { server.close(() => resolve(port)); });
      server.listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

// ─── Start embedded backend ───────────────────────────────────────────────────
const { startElectron } = require('../backend/index.js');

// ─── Poll until the Fastify server is accepting connections ───────────────────
function waitForServer(cb) {
  const attempt = () => {
    http.get(`http://127.0.0.1:${process.env.PORT}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'ok') return cb();
        } catch {}
        setTimeout(attempt, 300);
      });
    }).on('error', () => setTimeout(attempt, 300));
  };
  attempt();
}

// ─── Display preferences ──────────────────────────────────────────────────────
const PREFS_PATH = path.join(app.getPath('userData'), 'display-prefs.json');

function loadDisplayPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')); }
  catch { return {}; }
}

function saveDisplayPrefs(prefs) {
  try { fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs), 'utf8'); }
  catch { /* ignore */ }
}

// Show a dialog letting the user pick which display to project to.
// Returns the chosen display object, or null if cancelled.
async function pickProjectionDisplay(displays) {
  const primary  = screen.getPrimaryDisplay();
  const buttons  = displays.map((d, i) => {
    const tag = d.id === primary.id ? ' (this screen)' : '';
    return `Display ${i + 1}${tag}  —  ${d.bounds.width}×${d.bounds.height}`;
  });
  buttons.push('Cancel');

  // Default to the first non-primary display, or 0 if only one display
  const defaultId = displays.findIndex(d => d.id !== primary.id);

  const { response, checkboxChecked } = await dialog.showMessageBox({
    type:          'question',
    title:         'Choose Projection Display',
    message:       'Which screen should show the projected scripture?',
    detail:        'The Presenter controls will always open on this screen.',
    buttons,
    defaultId:     defaultId >= 0 ? defaultId : 0,
    cancelId:      buttons.length - 1,
    checkboxLabel: 'Remember my choice',
    checkboxChecked: true,
  });

  if (response === buttons.length - 1) return null;  // cancelled — no client window

  const chosen = displays[response];
  if (checkboxChecked) saveDisplayPrefs({ clientDisplayId: chosen.id });
  return chosen;
}

// Resolve which display the client window should use.
// Shows a picker if there are multiple displays and no saved preference.
async function resolveClientDisplay(forceAsk = false) {
  const displays = screen.getAllDisplays();
  const primary  = screen.getPrimaryDisplay();

  if (!forceAsk) {
    const prefs = loadDisplayPrefs();
    if (prefs.clientDisplayId) {
      const saved = displays.find(d => d.id === prefs.clientDisplayId);
      if (saved) return saved;
    }
  }

  // Single display — no choice to make
  if (displays.length === 1) return null;

  return pickProjectionDisplay(displays);
}

// ─── Mode selection: offline (local backend) or online (remote server) ────────
async function selectConnectionMode() {
  const { response } = await dialog.showMessageBox({
    type:      'question',
    title:     'Scriptures in View',
    message:   'How would you like to present?',
    detail:    'Offline: Use local scripture database — no internet needed.\n'
             + 'Online: Connect to a remote server and join a TV session.',
    buttons:   ['Offline (Local)', 'Online (Remote Server)'],
    defaultId: 0,
    cancelId:  0,
    icon:      getIcon(),
  });

  if (response === 0) return { mode: 'offline' };

  // Online — ask for server URL
  const urlWin = new BrowserWindow({
    width: 440, height: 280,
    resizable: false,
    title: 'Connect to Server',
    icon: getIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  urlWin.setMenuBarVisibility(false);

  return new Promise((resolve) => {
    ipcMain.once('online-mode-connect', (_e, serverUrl) => {
      if (!urlWin.isDestroyed()) urlWin.close();
      const cleaned = String(serverUrl).replace(/\/+$/, '');
      if (!/^https?:\/\/.+/.test(cleaned)) {
        dialog.showErrorBox('Invalid URL', 'Please enter a valid HTTP or HTTPS URL.');
        resolve({ mode: 'offline' });
        return;
      }
      resolve({ mode: 'online', serverUrl: cleaned });
    });
    urlWin.on('closed', () => {
      ipcMain.removeAllListeners('online-mode-connect');
      resolve({ mode: 'offline' }); // fallback if window closed
    });

    urlWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a24; color: #e8e0d0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
  h3 { margin: 0 0 6px; color: #c9a84c; font-size: 1.1rem; }
  p { margin: 0 0 16px; font-size: 0.82rem; color: #888; }
  select { width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #e8e0d0;
    font-size: 0.95rem; box-sizing: border-box; outline: none; margin-bottom: 8px; }
  select:focus { border-color: #c9a84c; }
  input { width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #e8e0d0;
    font-size: 0.95rem; box-sizing: border-box; outline: none; }
  input:focus { border-color: #c9a84c; }
  button { margin-top: 12px; padding: 10px 28px; background: #c9a84c; color: #1a1a24;
    border: none; border-radius: 8px; font-weight: 700; font-size: 0.95rem; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
</style></head><body>
  <h3>🌐 Connect to Server</h3>
  <p>Select or enter the server URL</p>
  <select id="preset" onchange="document.getElementById('url').value = this.value">
    <option value="https://cap-teyyko.live">cap-teyyko.live (Primary)</option>
    <option value="https://backend-production-9a27.up.railway.app">Railway (backend-production-9a27)</option>
    <option value="">Custom URL…</option>
  </select>
  <input id="url" type="url" placeholder="https://your-server.com"
    value="${'https://cap-teyyko.live'}" />
  <button id="go" onclick="submit()">Connect</button>
  <script>
    const inp = document.getElementById('url');
    const btn = document.getElementById('go');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    inp.addEventListener('input', () => { btn.disabled = !inp.value.trim(); });
    function submit() {
      const v = inp.value.trim();
      if (!v) return;
      if (window.electronAPI) window.electronAPI.sendOnlineConnect(v);
    }
  </script>
</body></html>`)}`);
  });
}

// ─── Window management ────────────────────────────────────────────────────────
let presenterWin = null;
let clientWin    = null;
let _clientWinCreating = false;

function getIcon() {
  return isDev
    ? path.resolve(__dirname, '../frontend/public/emblem.ico')
    : path.join(process.resourcesPath, 'emblem.ico');
}

function openClientWindow(display) {
  if (clientWin) { clientWin.focus(); return; }
  if (_clientWinCreating) return;
  _clientWinCreating = true;
  const primary = screen.getPrimaryDisplay();
  const isSecondary = display && display.id !== primary.id;
  const shouldFullscreen = Boolean(isSecondary);
  const bounds = display
    ? display.bounds
    : { x: primary.bounds.x + 80, y: primary.bounds.y + 80, width: 1280, height: 720 };

  clientWin = new BrowserWindow({
    x:         bounds.x,
    y:         bounds.y,
    width:     bounds.width,
    height:    bounds.height,
    show:      false,
    fullscreen: shouldFullscreen,
    title:     'Scriptures in View — Display',
    icon:      getIcon(),
    frame:     !shouldFullscreen,
    fullscreenable: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      backgroundThrottling: false, // keep CSS animations running when presenter window has focus
    },
  });
  clientWin.setMenuBarVisibility(false);
  clientWin.once('ready-to-show', () => {
    if (!clientWin || clientWin.isDestroyed()) return;
    if (shouldFullscreen) clientWin.setFullScreen(true);
    else clientWin.setFullScreen(false);
    clientWin.show();
  });
  clientWin.loadURL(`http://127.0.0.1:${process.env.PORT}/client?electron=1`);
  clientWin.on('closed', () => { clientWin = null; });
  _clientWinCreating = false;
}

async function createWindows(connectionMode) {
  logLifecycle('Creating windows, mode: ' + connectionMode?.mode);
  const preload = path.join(__dirname, 'preload.js');
  const primary = screen.getPrimaryDisplay();
  const isOnline = connectionMode?.mode === 'online';

  // Load saved window bounds
  const boundsPath = path.join(app.getPath('userData'), 'window-bounds.json');
  let savedBounds = {};
  try { savedBounds = JSON.parse(fs.readFileSync(boundsPath, 'utf8')); } catch { /* first run */ }

  // ── Presenter window ──────────────────────────────────────────────────────
  presenterWin = new BrowserWindow({
    width:  savedBounds.width || 1280,
    height: savedBounds.height || 820,
    x: savedBounds.x !== undefined ? savedBounds.x : primary.bounds.x + 40,
    y: savedBounds.y !== undefined ? savedBounds.y : primary.bounds.y + 40,
    title: 'Scriptures in View — Presenter',
    icon:  getIcon(),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });
  presenterWin.setMenuBarVisibility(false);

  if (isOnline) {
    // Online: load presenter from local server but point socket at remote
    const serverUrl = encodeURIComponent(connectionMode.serverUrl);
    presenterWin.loadURL(`http://127.0.0.1:${process.env.PORT}/presenter?mode=online&server=${serverUrl}`);
  } else {
    presenterWin.loadURL(`http://127.0.0.1:${process.env.PORT}/presenter?session=LOCAL`);
  }

  presenterWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  presenterWin.on('close', () => {
    try {
      const bounds = presenterWin.getBounds();
      fs.writeFileSync(boundsPath, JSON.stringify(bounds));
    } catch { /* ignore */ }
  });
  presenterWin.on('closed', () => { presenterWin = null; });
  presenterWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Crash] Presenter renderer gone:', details.reason);
    if (details.reason !== 'clean-exit') {
      dialog.showMessageBox({
        type: 'error',
        title: 'Renderer Crashed',
        message: 'The presenter window crashed unexpectedly.',
        detail: `Reason: ${details.reason}\nThe window will reload.`,
        buttons: ['Reload'],
      }).then(() => {
        if (presenterWin && !presenterWin.isDestroyed()) presenterWin.reload();
      });
    }
  });

  // ── Client / projection window (offline mode only) ────────────────────────
  if (!isOnline) {
    const chosen = await resolveClientDisplay();
    openClientWindow(chosen);
  }
}

// ─── IPC: presenter can ask to change the projection display ─────────────────
ipcMain.handle('change-projection-display', async () => {
  const chosen = await resolveClientDisplay(true);  // force the picker
  if (!chosen) return { cancelled: true };

  if (clientWin) {
    clientWin.destroy();
    clientWin = null;
  }
  openClientWindow(chosen);
  return { displayId: chosen.id, bounds: chosen.bounds };
});

ipcMain.handle('get-displays', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id:        d.id,
    index:     i + 1,
    primary:   d.id === primary.id,
    width:     d.bounds.width,
    height:    d.bounds.height,
    label:     `Display ${i + 1}${d.id === primary.id ? ' (this screen)' : ''}  —  ${d.bounds.width}×${d.bounds.height}`,
  }));
});

// ─── IPC: hot mode-switch (offline ↔ online) without losing presenter state ──
ipcMain.handle('switch-connection-mode', async (_e, newMode) => {
  // newMode: { mode: 'offline' } or { mode: 'online', serverUrl: '...' }
  if (!presenterWin || presenterWin.isDestroyed()) return { error: 'no-presenter' };

  const isNowOnline = newMode?.mode === 'online';
  selectedMode = newMode;

  // Reload the presenter URL — the page saves state to sessionStorage before calling this
  if (isNowOnline) {
    const serverUrl = encodeURIComponent(newMode.serverUrl || '');
    presenterWin.loadURL(`http://127.0.0.1:${process.env.PORT}/presenter?mode=online&server=${serverUrl}&restored=1`);
  } else {
    presenterWin.loadURL(`http://127.0.0.1:${process.env.PORT}/presenter?session=LOCAL&restored=1`);
  }

  // Open or close the client projection window as appropriate
  if (!isNowOnline && !clientWin) {
    const chosen = await resolveClientDisplay();
    openClientWindow(chosen);
  } else if (isNowOnline && clientWin) {
    clientWin.destroy();
    clientWin = null;
  }

  return { ok: true, mode: newMode.mode };
});

ipcMain.handle('get-app-version', () => app.getVersion());

function setupAutoUpdater() {
  if (isDev || !autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let _updateDownloadTimer = null;

  autoUpdater.on('error', (err) => {
    if (_updateDownloadTimer) { clearTimeout(_updateDownloadTimer); _updateDownloadTimer = null; }
    console.error('Auto-updater error:', err);
  });

  autoUpdater.on('update-available', (info) => {
    _updateDownloadTimer = setTimeout(() => {
      logLifecycle('Auto-update download timed out after 5 minutes');
    }, 5 * 60 * 1000);
    if (presenterWin && !presenterWin.isDestroyed()) {
      presenterWin.webContents.send('update-status', { status: 'available', version: info.version });
    }
    if (process.platform === 'linux' && process.env.APPIMAGE) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available.`,
        detail: 'Auto-update is not supported for AppImage builds.\n'
             + 'Please download the latest version from GitHub Releases.',
        buttons: ['Open Downloads Page', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) {
          shell.openExternal('https://github.com/chainuser1/scicp/releases/latest');
        }
      });
      return;
    }

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available.`,
      detail: 'Would you like to download and install it now?\n'
           + 'The app will restart after the update is installed.',
      buttons: ['Download & Install', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('Auto-updater: app is up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Auto-updater: downloading ${Math.round(progress.percent)}%`);
    if (presenterWin && !presenterWin.isDestroyed()) {
      presenterWin.webContents.send('update-download-progress', {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (_updateDownloadTimer) { clearTimeout(_updateDownloadTimer); _updateDownloadTimer = null; }
    if (presenterWin && !presenterWin.isDestroyed()) {
      presenterWin.webContents.send('update-status', { status: 'downloaded' });
    }
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'The update has been downloaded.',
      detail: 'The application will restart to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Auto-updater check failed:', err);
    });
  }, 30000);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
let selectedMode = null;

app.whenReady().then(async () => {
  logLifecycle('App starting...');
  const port = await findAvailablePort(3000, 3010);
  process.env.PORT = String(port);
  try {
    await startElectron();
  } catch (err) {
    console.error('Backend failed to start:', err);
    dialog.showErrorBox('Backend Failed to Start',
      `The local server could not start.\n\n${err.message}\n\nCheck that database files exist in:\n${process.env.DB_DIR}`);
    app.quit();
    return;
  }
  logLifecycle('Backend started on port ' + process.env.PORT);

  // CSP headers for all renderer windows
  const { session: electronSession } = require('electron');
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' http://localhost:* https://cap-teyyko.live; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: blob: https:; " +
          "connect-src 'self' http://localhost:* https://cap-teyyko.live wss://cap-teyyko.live ws://localhost:*; " +
          "media-src 'self' blob:; " +
          "frame-src 'none'"
        ]
      }
    });
  });

  waitForServer(async () => {
    selectedMode = await selectConnectionMode();
    createWindows(selectedMode);
    setupAutoUpdater();
  });
});

app.on('window-all-closed', () => { logLifecycle('All windows closed, quitting.'); app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    waitForServer(() => createWindows(selectedMode));
  }
});
