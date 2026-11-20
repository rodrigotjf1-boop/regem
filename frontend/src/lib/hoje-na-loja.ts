// O "HOJE" DA LOJA no navegador (V46, ERR-551). `new Date().toISOString().slice(0, 10)` dá a data em UTC: em Brasília,
// depois das 21h já é o dia SEGUINTE — e a loja funciona de noite. O dia é o do fuso da operação (São Paulo), como o
// `hojeISO()` do servidor; a conta de dias parte do meio-dia em UTC (nenhum fuso vira o dia).

const FUSO_DA_LOJA = 'America/Sao_Paulo';

/** O dia de hoje na loja (AAAA-MM-DD). */
export function hojeNaLoja(agora: Date = new Date()): string {
  // en-CA formata AAAA-MM-DD
  return agora.toLocaleDateString('en-CA', { timeZone: FUSO_DA_LOJA });
}

/** O dia `n` dias antes de hoje na loja (AAAA-MM-DD); `n` negativo = depois. */
export function diasAtrasNaLoja(n: number, agora: Date = new Date()): string {
  return new Date(Date.parse(`${hojeNaLoja(agora)}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}
