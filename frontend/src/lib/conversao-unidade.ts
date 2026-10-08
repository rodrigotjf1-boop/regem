// Conversão de unidade do produto do estoque — a MESMA regra do servidor
// (`backend/src/common/conversao-unidade.ts`; mude os dois juntos).
//
// O produto tem uma unidade de estoque (kg, fardo…) e conversões ("1 kg = 72 unidade"). Ao ligar o
// produto numa ficha, a pessoa escolhe em qual unidade informa a quantidade; o servidor grava na
// unidade do estoque. Aqui a tela só precisa: listar as unidades do produto e mostrar a conta.

export type Conversao = { unidadeDe: string; fator: number | string; unidadePara: string };

/** Nome de unidade para COMPARAR: sem acento, minúsculo, sem o "s" do plural. */
export function chaveUnidade(u: unknown): string {
  const s = String(u ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return s.length > 2 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s;
}

/** Quanto cada unidade vale em unidades de estoque (nos dois sentidos e em cadeia). */
function valoresEmEstoque(unidadeDoEstoque: string, conversoes: Conversao[]): Map<string, number> {
  const valor = new Map<string, number>([[chaveUnidade(unidadeDoEstoque), 1]]);
  const arestas = conversoes
    .map((c) => ({ de: chaveUnidade(c.unidadeDe), para: chaveUnidade(c.unidadePara), fator: Number(c.fator) }))
    .filter((c) => c.de && c.para && c.de !== c.para && Number.isFinite(c.fator) && c.fator > 0);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const a of arestas) {
      const vDe = valor.get(a.de);
      const vPara = valor.get(a.para);
      if (vDe !== undefined && vPara === undefined) {
        valor.set(a.para, vDe / a.fator);
        mudou = true;
      } else if (vPara !== undefined && vDe === undefined) {
        valor.set(a.de, vPara * a.fator);
        mudou = true;
      }
    }
  }
  return valor;
}

/** Quantas unidades de ESTOQUE vale 1 `unidade` (1 = a própria; null = o produto não tem essa unidade). */
export function fatorParaEstoque(unidade: unknown, unidadeDoEstoque: string, conversoes: Conversao[]): number | null {
  const u = chaveUnidade(unidade);
  if (!u || u === chaveUnidade(unidadeDoEstoque)) return 1;
  return valoresEmEstoque(unidadeDoEstoque, conversoes).get(u) ?? null;
}

/** As unidades em que o produto pode ser usado: a do estoque primeiro, depois as das conversões. */
export function unidadesDoProduto(unidadeDoEstoque: string, conversoes: Conversao[]): { unidade: string; fator: number }[] {
  const valor = valoresEmEstoque(unidadeDoEstoque, conversoes);
  const nome = new Map<string, string>([[chaveUnidade(unidadeDoEstoque), unidadeDoEstoque]]);
  for (const c of conversoes)
    for (const u of [c.unidadeDe, c.unidadePara]) if (!nome.has(chaveUnidade(u))) nome.set(chaveUnidade(u), String(u).trim());
  return [...valor.entries()].map(([chave, fator]) => ({ unidade: nome.get(chave) ?? chave, fator }));
}

/** Valor na unidade informada, sem o resto da ida e volta (9 casas, como o servidor devolve). */
export function arredondarInformado(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(9)) : 0;
}
