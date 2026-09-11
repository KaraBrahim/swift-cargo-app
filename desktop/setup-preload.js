// Le pont entre la page de premier démarrage et le processus principal : une
// seule fonction, celle qui rend le pays choisi.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', {
  choose: (code) => ipcRenderer.invoke('setup:choose', code),
});
