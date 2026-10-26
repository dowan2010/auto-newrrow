const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  run: () => ipcRenderer.invoke('job:run'),
  getDaily: () => ipcRenderer.invoke('daily:get'),
  setDaily: (on, time) => ipcRenderer.invoke('daily:set', on, time),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
});
