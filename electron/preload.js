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
});
