// Ce que la page peut demander au poste. Une seule chose aujourd'hui :
// enregistrer un document en PDF sur le disque de CETTE machine — le serveur,
// lui, est ailleurs et n'a pas de disque à nous.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  // { html, title, widthMm } → { saved: boolean, path?: string }
  savePdf: (doc) => ipcRenderer.invoke('desk:save-pdf', doc),
});
