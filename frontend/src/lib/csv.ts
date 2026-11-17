// Exporta linhas (objetos com as mesmas chaves) como CSV e dispara o download.
// Separador `;` e marca de UTF-8 no começo: é como o Excel em português abre sem trocar os acentos.

// Texto que começa com = + - @ (ou tabulação, ou retorno) o Excel e o LibreOffice EXECUTAM como fórmula ao abrir o
// arquivo — e os relatórios levam texto que outra pessoa escreveu (o nome que o cliente digita no cardápio, a
// observação do pedido). Esse texto ganha um apóstrofo na frente, como no escritor do servidor
// (`backend/src/common/escrever-planilha.ts`). O que é só número (com sinal, "R$" ou "%") fica como está: "-5,00" tem
// de continuar somando na planilha.
const COMECA_COMO_FORMULA = /^[=+\-@\t\r]/;
const SO_NUMERO = /^[+-]?(?:R\$[  ]?)?\d[\d.,]*(?:[  ]?%)?$/;

/** O texto de uma célula do CSV, sem virar fórmula ao abrir (ainda sem as aspas do CSV). */
export function celulaDeCsv(v: unknown): string {
  const texto = String(v ?? '');
  if (typeof v === 'number' || !COMECA_COMO_FORMULA.test(texto) || SO_NUMERO.test(texto)) return texto;
  return `'${texto}`;
}

/** O arquivo inteiro: cabeçalho com as chaves da primeira linha, tudo entre aspas, `;` de separador. */
export function montarCsv(linhas: Record<string, unknown>[]): string {
  if (!linhas.length) return '';
  const cols = Object.keys(linhas[0]);
  const esc = (v: unknown) => `"${celulaDeCsv(v).replace(/"/g, '""')}"`;
  return [cols.join(';'), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\n');
}

export function baixarCsv(nome: string, linhas: Record<string, unknown>[]): void {
  if (!linhas.length) return;
  const url = URL.createObjectURL(new Blob(['﻿' + montarCsv(linhas)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
