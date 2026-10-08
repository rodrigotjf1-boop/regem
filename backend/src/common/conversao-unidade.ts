// CONVERSÃO DE UNIDADE DO PRODUTO DO ESTOQUE (decisão do dono, 08/10/2026).
//
// O produto tem UMA unidade de estoque (a do cadastro: kg, fardo, caixa…) — é nela que ficam o
// saldo, o custo médio e toda baixa. As conversões do cadastro dizem como ela se divide:
// "1 kg = 72 unidade" (fatias de bacon), "1 fardo = 12 unidade", "1 caixa = 10 pacote" e
// "1 pacote = 12 unidade". Na hora de LIGAR o produto (linha de ficha técnica, adicional, produto
// de revenda) a pessoa escolhe em qual dessas unidades vai informar a quantidade.
//
// A REGRA QUE PROTEGE O ESTOQUE E O CMV: quem baixa e quem custeia (venda, produção, custo da
// ficha) continua fazendo a conta NA UNIDADE DO ESTOQUE, como sempre. A conversão acontece uma
// vez, ao GRAVAR o vínculo: 2 fatias de um bacon em kg são gravadas como 0,02778 kg. Assim
// nenhuma rotina de baixa precisou mudar — e o servidor da loja, mesmo em versão mais antiga,
// baixa a quantidade certa.

export type Conversao = { unidadeDe: string; fator: number | string; unidadePara: string };

/** Nome de unidade para COMPARAR: sem acento, minúsculo, sem o "s" do plural ("pacotes" = "pacote"). */
export function chaveUnidade(u: unknown): string {
  const s = String(u ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return s.length > 2 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s;
}

/**
 * Quanto cada unidade vale EM UNIDADES DE ESTOQUE: { kg: 1, unidade: 1/72 }.
 * Segue as conversões nos dois sentidos e em cadeia (caixa → pacote → unidade). Conversão sem
 * fator positivo, ou de uma unidade para ela mesma, é ignorada. A chave do mapa é `chaveUnidade`.
 */
export function valoresEmEstoque(unidadeDoEstoque: string, conversoes: Conversao[]): Map<string, number> {
  const valor = new Map<string, number>([[chaveUnidade(unidadeDoEstoque), 1]]);
  const arestas = conversoes
    .map((c) => ({ de: chaveUnidade(c.unidadeDe), para: chaveUnidade(c.unidadePara), fator: Number(c.fator) }))
    .filter((c) => c.de && c.para && c.de !== c.para && Number.isFinite(c.fator) && c.fator > 0);
  // 1 `de` = fator `para`  ⇒  1 `para` = (1 / fator) `de`.
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

/**
 * Quantas unidades de ESTOQUE vale 1 `unidade`. A própria unidade do estoque (ou nenhuma
 * informada) vale 1. Unidade que as conversões do produto não alcançam → `null`: quem chama
 * trata a quantidade como já estando na unidade do estoque (o comportamento de sempre).
 */
export function fatorParaEstoque(unidade: unknown, unidadeDoEstoque: string, conversoes: Conversao[]): number | null {
  const u = chaveUnidade(unidade);
  if (!u || u === chaveUnidade(unidadeDoEstoque)) return 1;
  return valoresEmEstoque(unidadeDoEstoque, conversoes).get(u) ?? null;
}

/** Quantidade informada em `unidade` → quantidade na unidade do estoque (e o fator usado). */
export function paraEstoque(quantidade: number, unidade: unknown, unidadeDoEstoque: string, conversoes: Conversao[]) {
  const fator = fatorParaEstoque(unidade, unidadeDoEstoque, conversoes) ?? 1;
  return { fator, quantidade: arredondarEstoque(quantidade * fator) };
}

/**
 * As unidades em que o produto pode ser usado, com o nome como foi cadastrado: a do estoque
 * primeiro, depois as alcançadas pelas conversões. `fator` = unidades de estoque por 1 unidade.
 */
export function unidadesDoProduto(unidadeDoEstoque: string, conversoes: Conversao[]): { unidade: string; fator: number }[] {
  const valor = valoresEmEstoque(unidadeDoEstoque, conversoes);
  const nome = new Map<string, string>([[chaveUnidade(unidadeDoEstoque), unidadeDoEstoque]]);
  for (const c of conversoes)
    for (const u of [c.unidadeDe, c.unidadePara]) if (!nome.has(chaveUnidade(u))) nome.set(chaveUnidade(u), String(u).trim());
  return [...valor.entries()].map(([chave, fator]) => ({ unidade: nome.get(chave) ?? chave, fator }));
}

// DOIS ARREDONDAMENTOS, cada um com o seu papel:
//  • GRAVAR na unidade do estoque: 15 algarismos significativos — o que um número de ponto
//    flutuante garante. 2 fatias de 1/72 kg ficam 0,0277777777777778 kg.
//  • MOSTRAR na unidade que a pessoa informou: 9 casas decimais. A ida e volta (× fator, ÷ fator)
//    deixa um resto na 12ª casa; sem este corte, "2 fatias" voltava como 1,99999999998.
/** Quantidade ou custo na unidade do ESTOQUE, como vai para o banco. */
export function arredondarEstoque(n: number): number {
  return Number.isFinite(n) ? Number(n.toPrecision(15)) : 0;
}
/** Quantidade ou custo na unidade INFORMADA, como volta para a tela. */
export function arredondarInformado(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(9)) : 0;
}
/** Casas decimais do `arredondarInformado` — para a mesma conta feita em SQL. */
export const CASAS_INFORMADO = 9;
