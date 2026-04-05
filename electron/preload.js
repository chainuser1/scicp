const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron:   true,
  localSession: 'LOCAL',

  // Returns array of { id, index, primary, width, height, label }
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Opens the display picker (always shows the dialog) and moves the
  // projection window to the chosen display. Returns { displayId, bounds }
  // or { cancelled: true } if the user dismissed the dialog.
  changeProjectionDisplay: () => ipcRenderer.invoke('change-projection-display'),

  // Online mode: send chosen server URL back to main process
  sendOnlineConnect: (url) => {
    if (typeof url === 'string' && url.trim()) ipcRenderer.send('online-mode-connect', url.trim());
  },

  // Hot mode-switch: reload presenter URL preserving state via sessionStorage.
  // newMode: { mode: 'offline' } or { mode: 'online', serverUrl: '...' }
  switchConnectionMode: (newMode) => {
    if (newMode && typeof newMode === 'object' && typeof newMode.mode === 'string') {
      return ipcRenderer.invoke('switch-connection-mode', newMode);
    }
    return Promise.reject(new Error('Invalid mode'));
  },

  // Auto-updater events — forward from main process to renderer
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update-status', (_e, data) => cb(data));
  },
  onUpdateDownloadProgress: (cb) => {
    ipcRenderer.on('update-download-progress', (_e, data) => cb(data));
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Opens the mode-switcher dialog from the renderer at any time.
  // Resolves with { mode, serverUrl? } once the user confirms, or the
  // current mode if they cancelled.
  openModeSwitcher: () => ipcRenderer.invoke('open-mode-switcher'),

  // Subscribe to mode changes triggered from the tray or main process.
  // cb receives { mode: 'offline' } or { mode: 'online', serverUrl: '…' }.
  onModeChanged: (cb) => {
    ipcRenderer.on('mode-changed', (_e, data) => cb(data));
  },
});
