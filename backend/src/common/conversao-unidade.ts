// CONVERSÃO DE UNIDADE DO PRODUTO DO ESTOQUE (decisão do dono, 08/10/2026).
//
// O produto tem UMA unidade de estoque (a do cadastro: kg, fardo, caixa…) — é nela que ficam o
// saldo, o custo médio e toda baixa. As conversões do cadastro dizem como ela se divide:
// "1 kg = 72 unidade" (fatias de bacon), "1 fardo = 12 unidade", "1 caixa = 10 pacote" e
// "1 pacote = 12 unidade". Na hora de LIGAR o produto (linha de ficha técnica, adicional, produto
// de revenda) a pessoa escolhe em qual dessas unidades vai informar a quantidade.
//
// MEDIDAS FIXAS (pedido do dono, 12/10/2026): quilo e grama, litro e mililitro o sistema converte
// SOZINHO — ninguém cadastra que 1 kg tem 1000 gramas. Elas completam o que o cadastro diz: o
// produto guardado em caixa, com "1 caixa = 6 kg" e "1 porção = 30 grama", passa a ter a porção
// ligada à caixa (30 g = 0,03 kg = 0,005 caixa). A conversão que o PRÓPRIO produto informar entre
// duas dessas unidades vale no lugar da fixa.
//
// A REGRA QUE PROTEGE O ESTOQUE E O CMV: quem baixa e quem custeia (venda, produção, custo da
// ficha) continua fazendo a conta NA UNIDADE DO ESTOQUE, como sempre. A conversão acontece uma
// vez, ao GRAVAR o vínculo: 2 fatias de um bacon em kg são gravadas como 0,02778 kg. Assim
// nenhuma rotina de baixa precisou mudar — e o servidor da loja, mesmo em versão mais antiga,
// baixa a quantidade certa.
//
// ⚠️ A MESMA regra vive em `frontend/src/lib/conversao-unidade.ts` (a tela lista as unidades e mostra
//    a conta). Mude os dois juntos: `frontend/scripts/check-conversao.mjs` roda os mesmos casos nos
//    dois arquivos e falha se as respostas diferirem.

export type Conversao = { unidadeDe: string; fator: number | string; unidadePara: string };

/** Nome de unidade para COMPARAR: sem acento, minúsculo, sem o "s" do plural ("pacotes" = "pacote"). */
export function chaveUnidade(u: unknown): string {
  const s = String(u ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return s.length > 2 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s;
}

type Familia = 'massa' | 'volume';
/** Quanto cada nome vale na MENOR unidade da família (grama, ml). A chave é a de `chaveUnidade`. */
const MEDIDA_FIXA: Record<string, { familia: Familia; base: number }> = {
  kg: { familia: 'massa', base: 1000 },
  k: { familia: 'massa', base: 1000 },
  kilo: { familia: 'massa', base: 1000 },
  quilo: { familia: 'massa', base: 1000 },
  kilograma: { familia: 'massa', base: 1000 },
  quilograma: { familia: 'massa', base: 1000 },
  grama: { familia: 'massa', base: 1 },
  g: { familia: 'massa', base: 1 },
  gr: { familia: 'massa', base: 1 },
  litro: { familia: 'volume', base: 1000 },
  l: { familia: 'volume', base: 1000 },
  ml: { familia: 'volume', base: 1 },
  mililitro: { familia: 'volume', base: 1 },
};
/** O nome da lista de unidades para cada medida de cada família (o que a tela oferece). */
const NOMES_DA_LISTA: Record<Familia, string[]> = { massa: ['kg', 'grama'], volume: ['litro', 'ml'] };

/**
 * "1 `de` = quanto de `para`" quando as duas são medidas fixas da mesma família (1 kg = 1000 grama,
 * 1 ml = 0,001 litro); senão `null`. O cadastro usa para recusar a conversão que contradiz a medida.
 */
export function proporcaoFixa(de: unknown, para: unknown): number | null {
  const a = MEDIDA_FIXA[chaveUnidade(de)];
  const b = MEDIDA_FIXA[chaveUnidade(para)];
  return a && b && a.familia === b.familia ? a.base / b.base : null;
}

type Aresta = { de: string; para: string; fator: number };

/** Segue as conversões do cadastro, nos dois sentidos, até não achar unidade nova. */
function propagar(valor: Map<string, number>, arestas: Aresta[]): void {
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
}

/**
 * Completa com as medidas fixas: se o produto alcança uma unidade de massa (ou de volume), as outras
 * da mesma família passam a valer pela proporção fixa. Só preenche o que ainda NÃO tem valor — a
 * conversão do próprio produto, que `propagar` já aplicou, não é trocada. Devolve se acrescentou algo.
 */
function completarMedidasFixas(valor: Map<string, number>, arestas: Aresta[]): boolean {
  let acrescentou = false;
  for (const familia of Object.keys(NOMES_DA_LISTA) as Familia[]) {
    const daFamilia = (k: string) => MEDIDA_FIXA[k]?.familia === familia;
    const referencia = [...valor.keys()].find(daFamilia);
    if (!referencia) continue;
    // Multiplica e divide por inteiros (1 ou 1000): uma conta só, sem o resto de multiplicar por 0,001.
    const pela = (k: string) => ((valor.get(referencia) as number) * MEDIDA_FIXA[k].base) / MEDIDA_FIXA[referencia].base;
    // (a) o nome como o cadastro escreveu ("g" numa conversão): é por ele que a conversão se liga;
    const citados = new Set(arestas.flatMap((a) => [a.de, a.para]).filter(daFamilia));
    for (const k of citados) {
      if (valor.has(k)) continue;
      valor.set(k, pela(k));
      acrescentou = true;
    }
    // (b) o nome da lista, quando nenhum outro nome da mesma medida já está lá (não oferecer "g" e "grama").
    for (const k of NOMES_DA_LISTA[familia]) {
      const jaTem = [...valor.keys()].some((v) => daFamilia(v) && MEDIDA_FIXA[v].base === MEDIDA_FIXA[k].base);
      if (jaTem) continue;
      valor.set(k, pela(k));
      acrescentou = true;
    }
  }
  return acrescentou;
}

/**
 * Quanto cada unidade vale EM UNIDADES DE ESTOQUE: { kg: 1, unidade: 1/72, grama: 0,001 }.
 * Segue as conversões nos dois sentidos e em cadeia (caixa → pacote → unidade) e completa com as
 * medidas fixas (kg ↔ grama, litro ↔ ml). Conversão sem fator positivo, ou de uma unidade para ela
 * mesma, é ignorada. A chave do mapa é `chaveUnidade`.
 */
export function valoresEmEstoque(unidadeDoEstoque: string, conversoes: Conversao[]): Map<string, number> {
  const valor = new Map<string, number>([[chaveUnidade(unidadeDoEstoque), 1]]);
  const arestas = conversoes
    .map((c) => ({ de: chaveUnidade(c.unidadeDe), para: chaveUnidade(c.unidadePara), fator: Number(c.fator) }))
    .filter((c) => c.de && c.para && c.de !== c.para && Number.isFinite(c.fator) && c.fator > 0);
  // O cadastro primeiro; a medida fixa completa; e a unidade nova pode ligar outra conversão do
  // cadastro ("1 porção = 30 grama") — por isso as duas se repetem até não haver novidade.
  do propagar(valor, arestas);
  while (completarMedidasFixas(valor, arestas));
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
  const valor = valoresEmEstoque(unidadeDoEstoque, conversoes);
  const direto = valor.get(u);
  if (direto !== undefined) return direto;
  // Outro jeito de escrever uma medida fixa ("g" quando o mapa tem "grama", "l" para um produto em litro).
  const medida = MEDIDA_FIXA[u];
  if (medida)
    for (const [k, v] of valor) {
      const outra = MEDIDA_FIXA[k];
      if (outra && outra.familia === medida.familia) return (v * medida.base) / outra.base;
    }
  return null;
}

/** Quantidade informada em `unidade` → quantidade na unidade do estoque (e o fator usado). */
export function paraEstoque(quantidade: number, unidade: unknown, unidadeDoEstoque: string, conversoes: Conversao[]) {
  const fator = fatorParaEstoque(unidade, unidadeDoEstoque, conversoes) ?? 1;
  return { fator, quantidade: arredondarEstoque(quantidade * fator) };
}

/**
 * As unidades em que o produto pode ser usado, com o nome como foi cadastrado: a do estoque
 * primeiro, depois as alcançadas pelas conversões e pelas medidas fixas. `fator` = unidades de
 * estoque por 1 unidade.
 */
export function unidadesDoProduto(unidadeDoEstoque: string, conversoes: Conversao[]): { unidade: string; fator: number }[] {
  const valor = valoresEmEstoque(unidadeDoEstoque, conversoes);
  const nome = new Map<string, string>([[chaveUnidade(unidadeDoEstoque), unidadeDoEstoque]]);
  for (const c of conversoes)
    for (const u of [c.unidadeDe, c.unidadePara]) if (!nome.has(chaveUnidade(u))) nome.set(chaveUnidade(u), String(u).trim());
  return [...valor.entries()].map(([chave, fator]) => ({ unidade: nome.get(chave) ?? chave, fator }));
}

/**
 * As conversões do cadastro que NÃO se ligam à unidade do estoque (nem pelas medidas fixas): a
 * unidade delas não aparece em lugar nenhum. O cadastro avisa na própria linha. Devolve os índices.
 */
export function conversoesSoltas(unidadeDoEstoque: string, conversoes: Conversao[]): number[] {
  const valor = valoresEmEstoque(unidadeDoEstoque, conversoes);
  const soltas: number[] = [];
  conversoes.forEach((c, i) => {
    const de = chaveUnidade(c.unidadeDe);
    const para = chaveUnidade(c.unidadePara);
    const fator = Number(c.fator);
    if (!de || !para || de === para || !Number.isFinite(fator) || fator <= 0) return; // linha incompleta: não é "solta"
    if (!valor.has(de) && !valor.has(para)) soltas.push(i);
  });
  return soltas;
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
