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

  // Auto-updater events — forward from main process to renderer.
  // removeAllListeners before re-binding so hot-reloads / StrictMode double-invocations
  // don't pile up duplicate listeners on the same IPC channel.
  onUpdateStatus: (cb) => {
    ipcRenderer.removeAllListeners('update-status');
    ipcRenderer.on('update-status', (_e, data) => cb(data));
  },
  onUpdateDownloadProgress: (cb) => {
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.on('update-download-progress', (_e, data) => cb(data));
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
