const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  confirmConfig: patch => ipcRenderer.invoke('confirm-config', patch),
});
