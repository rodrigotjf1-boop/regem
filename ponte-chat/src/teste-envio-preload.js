'use strict';
// O que a janela "Teste de envio" pode pedir ao programa: o ensaio e o envio (o programa confere tudo de novo).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ponte', {
  ensaiar: (p) => ipcRenderer.invoke('ponte:ensaiar', { numero: String((p && p.numero) || ''), texto: String((p && p.texto) || '') }),
  enviar: (p) => ipcRenderer.invoke('ponte:enviar', { numero: String((p && p.numero) || ''), texto: String((p && p.texto) || '') }),
});
