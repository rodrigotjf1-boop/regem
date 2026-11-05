'use strict';
// A única coisa que a tela de pareamento pode pedir ao programa: trocar o código (nada de Node na página).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ponte', {
  parear: (codigo) => ipcRenderer.invoke('ponte:parear', String(codigo || '')),
});
