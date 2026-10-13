// Embalagem na ficha técnica — a MESMA regra do servidor (`backend/src/common/embalagem-da-ficha.ts`;
// mude os dois juntos — `scripts/check-embalagem.mjs` roda os mesmos casos nos dois arquivos).
//
// Cada linha da ficha é: ingrediente (entra em toda venda), embalagem do DELIVERY (`somenteDelivery`)
// ou embalagem do BALCÃO (`somenteBalcao`). A empresa diz, numa chave só, se usa a MESMA embalagem
// no balcão e no delivery: ligada, fica um cadastro só — o do delivery — valendo para as duas
// vendas, e a embalagem de balcão que houver fica guardada, sem contar.

/** Para que venda o custo está sendo calculado. `nenhum` = só os ingredientes. */
export type CanalDaFicha = 'balcao' | 'delivery' | 'nenhum';

export type LinhaDeCanal = { somenteDelivery?: boolean | null; somenteBalcao?: boolean | null };

/** A linha da ficha entra nesta venda? */
export function linhaEntra(linha: LinhaDeCanal, canal: CanalDaFicha, mesmaEmbalagem: boolean): boolean {
  if (linha.somenteDelivery) return canal === 'delivery' || (canal === 'balcao' && mesmaEmbalagem);
  if (linha.somenteBalcao) return canal === 'balcao' && !mesmaEmbalagem;
  return true;
}

/** Número como a pessoa digitaria: sem os zeros que o banco devolve ("2.000" → "2", "1.250" → "1.25"). */
export function semZerosFinais(valor: unknown, vazio = ''): string {
  if (valor == null || valor === '') return vazio;
  const n = Number(valor);
  return Number.isFinite(n) ? String(n) : String(valor);
}
