// Trechos copiados das páginas oficiais em 14/11/2026 (a data torta "July 29,2028" é da Meta mesmo). Usados pelos testes
// dos leitores e do serviço — este arquivo não é teste por si (não termina em `.spec.ts`) e não entra no build.

export const HTML_DA_META = `
<table><tbody>
<tr class="row_0"><td><p><a href="/docs/graph-api/changelog/version26.0">v26.0</a></p>
</td><td><p>July 29, 2026</p>
</td><td><p>TBD</p>
</td></tr><tr class="row_1 _5m29"><td><p><a href="/docs/graph-api/changelog/version25.0">v25.0</a></p>
</td><td><p>February 18, 2026</p>
</td><td><p>July 29,2028</p>
</td></tr><tr class="row_2"><td><p><a href="/docs/graph-api/changelog/version24.0">v24.0</a></p>
</td><td><p>October 8, 2025</p>
</td><td><p>February 18, 2028</p>
</td></tr></tbody></table>`;

export const LINHA_DO_HAIKU = '| claude-haiku-5-5           | Active        | N/A                | Not sooner than October 7, 2027    |';

export const MD_DA_ANTHROPIC = `
| API model name             | Current state | Deprecated         | Tentative retirement date          |
| :------------------------- | :------------ | :----------------- | :--------------------------------- |
| claude-opus-5-5            | Active        | N/A                | Not sooner than September 22, 2027 |
| claude-sonnet-5-5          | Active        | N/A                | Not sooner than September 28, 2027 |
| claude-sonnet-4-5-20250929 | Deprecated    | September 30, 2026 | November 30, 2026                  |
${LINHA_DO_HAIKU}
`;

/** O Haiku 5.5 deprecado (a mudança que a vigilância tem de pegar). */
export const MD_COM_O_HAIKU_DEPRECADO = MD_DA_ANTHROPIC.replace(
  LINHA_DO_HAIKU,
  '| claude-haiku-5-5           | Deprecated    | March 1, 2027      | May 1, 2027                        |',
);
