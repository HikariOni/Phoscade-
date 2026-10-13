const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ditherStudio', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  saveSequence: (payload) => ipcRenderer.invoke('save-png-sequence', payload)
});