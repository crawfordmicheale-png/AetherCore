// Sandboxed preloads must be CommonJS. Exposes a narrow persistence API to the game.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aetherPlatform', {
  load: (name) => ipcRenderer.invoke('platform:load', name),
  save: (name, text) => ipcRenderer.invoke('platform:save', name, text),
  remove: (name) => ipcRenderer.invoke('platform:remove', name),
  quit: () => ipcRenderer.send('platform:quit'),
});
