const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  run: () => ipcRenderer.invoke('job:run'),
  getDaily: () => ipcRenderer.invoke('daily:get'),
  setDaily: (on, time) => ipcRenderer.invoke('daily:set', on, time),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
});
