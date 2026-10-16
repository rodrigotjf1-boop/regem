// Conversão de unidade do produto do estoque — a MESMA regra do servidor
// (`backend/src/common/conversao-unidade.ts`; mude os dois juntos — `scripts/check-conversao.mjs`
// roda os mesmos casos nos dois arquivos e falha se as respostas diferirem).
//
// O produto tem uma unidade de estoque (kg, fardo…) e conversões ("1 kg = 72 unidade"). Ao ligar o
// produto numa ficha, a pessoa escolhe em qual unidade informa a quantidade; o servidor grava na
// unidade do estoque. Aqui a tela só precisa: listar as unidades do produto e mostrar a conta.
//
// MEDIDAS FIXAS (pedido do dono, 12/10/2026): quilo e grama, litro e mililitro o sistema converte
// sozinho — ninguém cadastra que 1 kg tem 1000 gramas. A conversão que o próprio produto informar
// entre duas dessas unidades vale no lugar da fixa.

export type Conversao = { unidadeDe: string; fator: number | string; unidadePara: string };

/** Nome de unidade para COMPARAR: sem acento, minúsculo, sem o "s" do plural. */
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

/** Completa com as medidas fixas o que o cadastro ainda não disse. Devolve se acrescentou algo. */
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

/** Quanto cada unidade vale em unidades de estoque (nos dois sentidos, em cadeia e pelas medidas fixas). */
export function valoresEmEstoque(unidadeDoEstoque: string, conversoes: Conversao[]): Map<string, number> {
  const valor = new Map<string, number>([[chaveUnidade(unidadeDoEstoque), 1]]);
  const arestas = conversoes
    .map((c) => ({ de: chaveUnidade(c.unidadeDe), para: chaveUnidade(c.unidadePara), fator: Number(c.fator) }))
    .filter((c) => c.de && c.para && c.de !== c.para && Number.isFinite(c.fator) && c.fator > 0);
  do propagar(valor, arestas);
  while (completarMedidasFixas(valor, arestas));
  return valor;
}

/** Quantas unidades de ESTOQUE vale 1 `unidade` (1 = a própria; null = o produto não tem essa unidade). */
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

/** As unidades em que o produto pode ser usado: a do estoque primeiro, depois as das conversões e as medidas fixas. */
export function unidadesDoProduto(unidadeDoEstoque: string, conversoes: Conversao[]): { unidade: string; fator: number }[] {
  const valor = valoresEmEstoque(unidadeDoEstoque, conversoes);
  const nome = new Map<string, string>([[chaveUnidade(unidadeDoEstoque), unidadeDoEstoque]]);
  for (const c of conversoes)
    for (const u of [c.unidadeDe, c.unidadePara]) if (!nome.has(chaveUnidade(u))) nome.set(chaveUnidade(u), String(u).trim());
  return [...valor.entries()].map(([chave, fator]) => ({ unidade: nome.get(chave) ?? chave, fator }));
}

/**
 * Só as unidades que o CADASTRO cita (a do estoque e as das conversões), sem a que existe só pela
 * medida fixa. É a lista das ligações "1 por venda" (produto de revenda, adicional): ali não há
 * quantidade a informar, e "1 grama por venda" não ajuda ninguém. `manter` = a unidade já gravada,
 * que continua na lista mesmo que tenha vindo da medida fixa.
 */
export function unidadesDoCadastro(unidadeDoEstoque: string, conversoes: Conversao[], manter?: unknown): { unidade: string; fator: number }[] {
  const citadas = new Set([unidadeDoEstoque, manter, ...conversoes.flatMap((c) => [c.unidadeDe, c.unidadePara])].map(chaveUnidade));
  return unidadesDoProduto(unidadeDoEstoque, conversoes).filter((u) => citadas.has(chaveUnidade(u.unidade)));
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

/** Valor na unidade informada, sem o resto da ida e volta (9 casas, como o servidor devolve). */
export function arredondarInformado(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(9)) : 0;
}

// ─── Só para MOSTRAR (o servidor não tem: não entra na comparação do `check:conversao`) ───

/** Número como se digita no cadastro: vírgula e sem zeros sobrando (3,5 · 30 · 1.000). */
function numeroDoCadastro(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

/**
 * A unidade dita como foi CADASTRADA (pedido do dono, 16/10/2026). Num molho em galão com
 * "1 porção = 30 ml", a porção aparece como "30 ml", e não como "0,0086 galão", que é a conta na
 * unidade do estoque. Essa conta continua sendo a que se grava e se baixa (`fatorParaEstoque`):
 * aqui é só o texto da tela.
 *  - a unidade é o lado esquerdo de uma conversão ("1 porção = 30 ml") → equivale "30 ml";
 *  - é medida fixa e o produto usa uma maior da mesma medida (ml com litro) → "1 litro = 1.000 ml";
 *  - é o lado direito de uma conversão ("1 galão = 3,5 litro") → "1 galão = 3,5 litro";
 *  - nada disso → null (a tela mostra a conta na unidade do estoque, como antes).
 * `frase` é sempre "1 A = N B"; `equivale` ("30 ml") só existe no primeiro caso.
 */
export function comoFoiCadastrada(
  unidade: unknown,
  unidadeDoEstoque: string,
  conversoes: Conversao[],
): { frase: string; equivale: string | null } | null {
  const u = chaveUnidade(unidade);
  if (!u) return null;
  const doProduto = unidadesDoProduto(unidadeDoEstoque, conversoes);
  const usa = (nome: string) => doProduto.some((x) => chaveUnidade(x.unidade) === chaveUnidade(nome));
  if (!usa(u)) return null;
  const nome = doProduto.find((x) => chaveUnidade(x.unidade) === u)?.unidade ?? String(unidade).trim();
  const linhas = conversoes
    .map((c) => ({ de: String(c.unidadeDe ?? '').trim(), para: String(c.unidadePara ?? '').trim(), fator: Number(c.fator) }))
    .filter((c) => chaveUnidade(c.de) && chaveUnidade(c.para) && chaveUnidade(c.de) !== chaveUnidade(c.para) && Number.isFinite(c.fator) && c.fator > 0);

  const esquerda = linhas.find((c) => chaveUnidade(c.de) === u && usa(c.para));
  if (esquerda) {
    const equivale = `${numeroDoCadastro(esquerda.fator)} ${esquerda.para}`;
    return { frase: `1 ${nome} = ${equivale}`, equivale };
  }
  const medida = MEDIDA_FIXA[u];
  const maior = medida
    ? doProduto.find((x) => {
        const m = MEDIDA_FIXA[chaveUnidade(x.unidade)];
        return !!m && m.familia === medida.familia && m.base > medida.base;
      })
    : undefined;
  if (maior && medida) {
    const vezes = MEDIDA_FIXA[chaveUnidade(maior.unidade)].base / medida.base;
    return { frase: `1 ${maior.unidade} = ${numeroDoCadastro(vezes)} ${nome}`, equivale: null };
  }
  const direita = linhas.find((c) => chaveUnidade(c.para) === u && usa(c.de));
  if (direita) return { frase: `1 ${direita.de} = ${numeroDoCadastro(direita.fator)} ${direita.para}`, equivale: null };
  return null;
}
