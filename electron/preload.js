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
  sendOnlineConnect: (url) => ipcRenderer.send('online-mode-connect', url),

  // Hot mode-switch: reload presenter URL preserving state via sessionStorage.
  // newMode: { mode: 'offline' } or { mode: 'online', serverUrl: '...' }
  switchConnectionMode: (newMode) => ipcRenderer.invoke('switch-connection-mode', newMode),
});
