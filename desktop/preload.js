// Preload mínimo e seguro (sandbox + contextIsolation). Só expõe um marcador para o
// app web saber que roda dentro da casca (ex.: esconder "instale o app"). Nada de
// Node/IPC sensível é exposto ao conteúdo.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('regemDesktop', {
  isDesktop: true,
  versao: '1.0.0',
});
