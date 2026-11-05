'use strict';
// O que a janela "Estado da ponte" pode pedir ao programa: o estado de agora, uma das ações dos botões e o aviso de que o
// estado mudou (nada de Node na página).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ponte', {
  estado: () => ipcRenderer.invoke('ponte:estado'),
  acao: (acao) => ipcRenderer.invoke('ponte:acao', String(acao || '')),
  aoMudar: (fn) => ipcRenderer.on('ponte:mudou', (_e, v) => fn(v)),
});
