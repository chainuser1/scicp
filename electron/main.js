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
    const dest = path.join(destDbDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(srcDbDir, file), dest);
    }
  }
  process.env.DB_DIR             = destDbDir;
  process.env.FRONTEND_DIST_DIR  = path.join(process.resourcesPath, 'frontend-dist');
  process.env.USER_DATA_DIR      = app.getPath('userData');
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

// ─── Window management ────────────────────────────────────────────────────────
let presenterWin = null;
let clientWin    = null;

function getIcon() {
  return isDev
    ? path.resolve(__dirname, '../frontend/public/emblem.ico')
    : path.join(process.resourcesPath, 'emblem.ico');
}

function openClientWindow(display) {
  if (clientWin) { clientWin.focus(); return; }

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
  clientWin.loadURL('http://127.0.0.1:3000/client?electron=1');
  clientWin.on('closed', () => { clientWin = null; });
}

async function createWindows() {
  const preload = path.join(__dirname, 'preload.js');
  const primary = screen.getPrimaryDisplay();

  // ── Presenter window ──────────────────────────────────────────────────────
  presenterWin = new BrowserWindow({
    width:  1280,
    height: 820,
    x: primary.bounds.x + 40,
    y: primary.bounds.y + 40,
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
  presenterWin.loadURL('http://127.0.0.1:3000/presenter?session=LOCAL');

  presenterWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  presenterWin.on('closed', () => { presenterWin = null; });

  // ── Client / projection window ────────────────────────────────────────────
  const chosen = await resolveClientDisplay();
  openClientWindow(chosen);
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

// ─── Auto-updater (only in packaged builds) ─────────────────────────────────
function setupAutoUpdater() {
  if (isDev || !autoUpdater) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });

  autoUpdater.on('update-available', (info) => {
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
  });

  autoUpdater.on('update-downloaded', () => {
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
  }, 5000);
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
  waitForServer(() => {
    createWindows();
    setupAutoUpdater();
  });
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    waitForServer(createWindows);
  }
});
