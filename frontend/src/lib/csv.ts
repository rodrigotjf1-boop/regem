// Exporta linhas (objetos com as mesmas chaves) como CSV e dispara o download.
// Separador `;` e marca de UTF-8 no começo: é como o Excel em português abre sem trocar os acentos.
export function baixarCsv(nome: string, linhas: Record<string, unknown>[]): void {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(';'), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
