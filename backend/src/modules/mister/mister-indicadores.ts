import { somarDias } from '../../common/data';
import { linhaEntra, type CanalDaFicha } from '../../common/embalagem-da-ficha';
import { custoDaLinhaDaFicha } from '../../common/regras-negocio';
import { diaMes } from './mister-agente.regras';
import { emLista, semAcentoMinusculo } from './mister-analises';

// OS INDICADORES FINANCEIROS DO MISTER (versão 7, V7f; `docs/plano-mister.md` § "Versão 7", V7-8, V7-9 e V7-10; definições em
// `docs/logica-negocio.md` § 2.6; protótipo `mockups/regem-mister-v7.html`, aba "Financeiro"). Só o que é puro: o custo de uma
// ficha, a cobertura, cada indicador e o texto do que falta.
//
//  • A venda vem da conta OFICIAL (`linhasDaVendaOficial`). Nenhum faturamento nasce aqui.
//  • INGREDIENTE SEM CUSTO NÃO É CUSTO ZERO: um só ingrediente sem custo (também na sub-receita) tira o produto da conta. Por isso
//    a conta não usa `custoTotalFicha`, que soma essa linha como zero e daria margem de 100%.
//  • Sem dado, o indicador volta nulo com o que falta e o caminho do menu (V7-10). Nunca R$ 0, nunca média do setor.
//  • Dinheiro em centavos ao somar.

export const FOCOS_DOS_INDICADORES = ['margem', 'inadimplencia', 'prazo_pagamento', 'caixa', 'margem_liquida', 'giro_de_recebiveis', 'roi_campanha'] as const;
export type FocoDoIndicador = (typeof FOCOS_DOS_INDICADORES)[number];

/** Abaixo disto, a margem sai marcada como parcial e não se compara com outro período. */
export const COBERTURA_MINIMA_PCT = 50;
/** O ROI só sai com o custo de toda a venda de produto da campanha (a folga é só do arredondamento). */
export const COBERTURA_DO_ROI_PCT = 99.5;
export const MINIMO_DE_TITULOS_PAGOS = 3;
export const VALIDADE_DO_SALDO_DIAS = 7;
export const MAX_DIAS_DOS_INDICADORES = 92;
export const DIAS_PADRAO_DO_PRAZO = 90;
const PRODUTOS_NA_LISTA = 5;
const INSUMOS_NA_LISTA = 8;

// Os caminhos conferidos nas telas (V65): `shell.tsx`, `abas-estoque.tsx`, `recebimento-secao.tsx`, `fichas/page.tsx`,
// `produto-form.tsx`, `financeiro/page.tsx` e `marketing/page.tsx`.
export const ONDE_CUSTO_DO_INSUMO = 'Estoque › aba "Recebimento", botão "Nota avulsa" (ou "Conferir", no pedido que chegou), com o custo de cada item';
export const ONDE_CUSTO_NA_FICHA = 'Estoque › aba "Fichas técnicas", na ficha, campo "Custo (R$)" do ingrediente';
export const ONDE_CRIAR_FICHA = 'Estoque › aba "Fichas técnicas", botão "Nova ficha"';
export const ONDE_PRECO_DE_CUSTO = 'Cadastros › Cardápio, no produto, em "Override manual (avançado)" do custo';
export const ONDE_CONTAS_A_RECEBER = 'Financeiro › Contas a pagar, no filtro "A receber"';
export const ONDE_LANCAR_CONTA = 'Financeiro › Contas a pagar, em "Nova conta" (Tipo "A pagar" ou "A receber"), botão "Cadastrar conta"';
export const ONDE_CAMPANHAS = 'Delivery › Marketing, aba "Campanhas"';

const reais = (centavos: number): number => Math.round(centavos) / 100;
const umaCasa = (n: number): number => Math.round(n * 10) / 10;
const pct = (parte: number, todo: number): number => (todo > 0 ? umaCasa((parte / todo) * 100) : 0);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Dias de `de` até `ate` (AAAA-MM-DD), sem fuso. */
export const diasEntreDatas = (de: string, ate: string): number => Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

// ───────────────────────────── o custo de uma ficha ─────────────────────────────

export interface LinhaDaFicha {
  nome: string;
  quantidade: number;
  fatorCorrecao: number;
  /** O custo gravado na linha (o que a pessoa escreveu ou a cópia de quando a ficha foi salva). */
  custoGravado: number;
  itemId: string | null;
  subFichaId: string | null;
  /** O item é feito na loja: esta é a ficha que o produz. */
  fichaDoItemId: string | null;
  somenteDelivery?: boolean | null;
  somenteBalcao?: boolean | null;
}

export interface FichaDoCusto {
  rendimento: number;
  margemPerda: number;
  linhas: LinhaDaFicha[];
}

export interface CustoDaFicha {
  /** Todo ingrediente que entra nesta venda tem custo. */
  completo: boolean;
  /** O custo da ficha inteira; só vale com `completo`. */
  custo: number;
  /** O custo de uma porção; só vale com `completo`. */
  porPorcao: number;
  /** Algum ingrediente tem custo (a ficha pela metade não usa o custo gravado no item feito na loja). */
  algumCusto: boolean;
  /** Os nomes dos ingredientes sem custo. */
  faltam: string[];
}

const rendimentoDe = (f: FichaDoCusto | undefined): number => (f && f.rendimento > 0 ? f.rendimento : 1);

/**
 * O calculador do custo das fichas de uma empresa. A conta é a de `custoTotalFicha` (quantidade × fator × custo, a margem de perda
 * sobre o total, a embalagem de cada venda) e o custo de cada linha é o mesmo da tela (`custoDaLinhaDaFicha`), com duas diferenças:
 * linha sem custo deixa a ficha INCOMPLETA, e ciclo de sub-receita não trava, deixa incompleta. Cada ficha é calculada uma vez por
 * venda e loja.
 */
export function calculadoraDeFichas(
  fichas: ReadonlyMap<string, FichaDoCusto>,
  custoDoItem: (itemId: string, unidadeId: string | null) => number,
  mesmaEmbalagem: boolean,
): (fichaId: string, canal: CanalDaFicha, unidadeId: string | null) => CustoDaFicha {
  const prontas = new Map<string, CustoDaFicha>();
  const INCOMPLETA: CustoDaFicha = { completo: false, custo: 0, porPorcao: 0, algumCusto: false, faltam: [] };

  const avaliar = (id: string, canal: CanalDaFicha, unidadeId: string | null, caminho: ReadonlySet<string>): CustoDaFicha => {
    // Ciclo: nunca fecha. `algumCusto` impede de cair no custo gravado do item.
    if (caminho.has(id)) return { ...INCOMPLETA, algumCusto: true };
    const chave = `${id}|${canal}|${unidadeId ?? ''}`;
    const pronta = prontas.get(chave);
    if (pronta) return pronta;
    const f = fichas.get(id);
    if (!f) return INCOMPLETA;
    const seguinte = new Set(caminho).add(id);
    let total = 0;
    let entraram = 0;
    let completo = true;
    let algumCusto = false;
    const faltam = new Set<string>();
    const faltou = (nomes: readonly string[]) => {
      completo = false;
      for (const n of nomes) faltam.add(n);
    };
    for (const l of f.linhas) {
      if (!linhaEntra(l, canal, mesmaEmbalagem)) continue;
      // Linha sem quantidade não consome nada.
      if (!(l.quantidade > 0)) continue;
      entraram++;
      if (!(l.fatorCorrecao > 0)) {
        faltou([l.nome]);
        continue;
      }
      let unitario: number | null = null;
      if (l.subFichaId) {
        const sub = avaliar(l.subFichaId, canal, unidadeId, seguinte);
        algumCusto ||= sub.algumCusto;
        if (!sub.completo) {
          faltou(sub.faltam.length ? sub.faltam : [l.nome]);
          continue;
        }
        unitario = sub.custo / rendimentoDe(fichas.get(l.subFichaId));
      } else if (l.fichaDoItemId) {
        // Feito na loja: só os ingredientes da ficha dele. Sem nenhum custo nela, vale o custo do item ou o gravado na linha.
        const feita = avaliar(l.fichaDoItemId, 'nenhum', unidadeId, seguinte);
        if (feita.completo && feita.custo > 0) unitario = feita.custo / rendimentoDe(fichas.get(l.fichaDoItemId));
        else if (feita.algumCusto) {
          algumCusto = true;
          faltou(feita.faltam.length ? feita.faltam : [l.nome]);
          continue;
        }
      }
      if (unitario === null) {
        // A mesma regra da tela de fichas (`custoDaLinhaDaFicha`).
        const daLinha = custoDaLinhaDaFicha(l.custoGravado, l.itemId ? custoDoItem(l.itemId, unidadeId) : 0);
        unitario = daLinha > 0 ? daLinha : null;
      }
      if (unitario === null || !(unitario > 0)) {
        faltou([l.nome]);
        continue;
      }
      algumCusto = true;
      total += l.quantidade * l.fatorCorrecao * unitario;
    }
    if (!entraram) completo = false;
    const custo = completo ? (f.margemPerda > 0 ? total * (1 + f.margemPerda / 100) : total) : 0;
    const fora: CustoDaFicha = { completo, custo, porPorcao: custo / rendimentoDe(f), algumCusto, faltam: [...faltam] };
    prontas.set(chave, fora);
    return fora;
  };
  return (fichaId, canal, unidadeId) => avaliar(fichaId, canal, unidadeId, new Set());
}

// ───────────────────────────── a venda com custo ─────────────────────────────

export interface ProdutoDoCusto {
  nome: string;
  tipo: string;
  fichaId: string | null;
  /** O custo informado à mão no produto. Zero ou vazio = não informado. */
  precoCusto: number | null;
}

/** As vendas de um produto, agrupadas (uma linha por produto, variação, loja, canal e "levou adicional"). */
export interface GrupoDeVenda {
  produtoId: string | null;
  variacaoId: string | null;
  unidadeId: string | null;
  canal: 'balcao' | 'delivery';
  comAdicional: boolean;
  descricao: string;
  quantidade: number;
  /** A parte da venda de produto (o desconto da loja já rateado). */
  centavos: number;
}

export interface CadastroDeCusto {
  produtos: ReadonlyMap<string, ProdutoDoCusto>;
  /** O fator da ficha de cada variação (grande = 1,5 da receita). */
  fatores: ReadonlyMap<string, number>;
  custoDaFicha: (fichaId: string, canal: CanalDaFicha, unidadeId: string | null) => CustoDaFicha;
}

export type MotivoSemCusto = 'ficha_incompleta' | 'sem_ficha' | 'combo' | 'variacao' | 'adicional' | 'sem_cadastro';

export interface ContaDoCusto {
  /** A venda de produto com custo completo. */
  cobertoCentavos: number;
  custoCentavos: number;
  /** A venda de produto sem custo completo. */
  semCustoCentavos: number;
  faltam: Array<{ nome: string; motivo: MotivoSemCusto; centavos: number }>;
  insumosSemCusto: string[];
}

export const contaVazia = (): ContaDoCusto => ({ cobertoCentavos: 0, custoCentavos: 0, semCustoCentavos: 0, faltam: [], insumosSemCusto: [] });

function custoDoGrupo(g: GrupoDeVenda, c: CadastroDeCusto): { unitario: number } | { motivo: MotivoSemCusto; insumos?: string[] } {
  // O preço do adicional está na linha e o custo dele não entra nesta conta: a linha inteira fica de fora.
  if (g.comAdicional) return { motivo: 'adicional' };
  const p = g.produtoId ? c.produtos.get(g.produtoId) : undefined;
  if (!p) return { motivo: 'sem_cadastro' };
  const fator = g.variacaoId ? (c.fatores.get(g.variacaoId) ?? null) : 1;
  if (fator === null || !(fator > 0)) return { motivo: 'variacao' };
  if (p.precoCusto !== null && p.precoCusto > 0) return fator === 1 ? { unitario: p.precoCusto } : { motivo: 'variacao' };
  if (p.tipo === 'combo') return { motivo: 'combo' };
  if (!p.fichaId) return { motivo: 'sem_ficha' };
  const r = c.custoDaFicha(p.fichaId, g.canal, g.unidadeId);
  if (!r.completo) return { motivo: 'ficha_incompleta', insumos: r.faltam };
  return { unitario: r.porPorcao * fator };
}

/** Separa a venda com custo completo da que não tem, e diz o que falta, da que mais vende para a que menos vende. */
export function contarCusto(grupos: ReadonlyArray<GrupoDeVenda>, cadastro: CadastroDeCusto): ContaDoCusto {
  let cobertoCentavos = 0;
  let custoCentavos = 0;
  let semCustoCentavos = 0;
  const faltam = new Map<string, { nome: string; motivo: MotivoSemCusto; centavos: number }>();
  const insumos = new Map<string, number>();
  for (const g of grupos) {
    const r = custoDoGrupo(g, cadastro);
    if ('unitario' in r) {
      cobertoCentavos += g.centavos;
      custoCentavos += Math.round(g.quantidade * r.unitario * 100);
      continue;
    }
    semCustoCentavos += g.centavos;
    const nome = g.produtoId ? (cadastro.produtos.get(g.produtoId)?.nome ?? g.descricao) : g.descricao;
    const chave = `${r.motivo}|${nome}`;
    const x = faltam.get(chave) ?? { nome, motivo: r.motivo, centavos: 0 };
    x.centavos += g.centavos;
    faltam.set(chave, x);
    for (const i of r.insumos ?? []) insumos.set(i, (insumos.get(i) ?? 0) + g.centavos);
  }
  return {
    cobertoCentavos,
    custoCentavos,
    semCustoCentavos,
    faltam: [...faltam.values()].sort((a, b) => b.centavos - a.centavos || a.nome.localeCompare(b.nome)),
    insumosSemCusto: [...insumos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n),
  };
}

/** O que falta lançar para a margem, com o caminho do menu. */
export function oQueFaltaNoCusto(c: ContaDoCusto): string[] {
  const doMotivo = (m: MotivoSemCusto) => c.faltam.filter((x) => x.motivo === m);
  const exemplos = (l: ReadonlyArray<{ nome: string }>) => emLista(l.slice(0, PRODUTOS_NA_LISTA).map((x) => x.nome));
  const fora: string[] = [];
  const incompletas = doMotivo('ficha_incompleta');
  if (incompletas.length) {
    const insumos = c.insumosSemCusto.slice(0, INSUMOS_NA_LISTA);
    const resto = c.insumosSemCusto.length - insumos.length;
    fora.push(
      `${plural(incompletas.length, 'produto com ficha tem', 'produtos com ficha têm')} ingrediente sem custo (${exemplos(incompletas)}). Ingrediente sem custo não é custo zero: esses produtos ficam fora da conta.`,
    );
    if (insumos.length) fora.push(`Ingredientes sem custo: ${emLista(insumos)}${resto > 0 ? ` e mais ${resto}` : ''}.`);
    fora.push(`Para lançar o custo: ${ONDE_CUSTO_DO_INSUMO}. Ingrediente escrito à mão: ${ONDE_CUSTO_NA_FICHA}.`);
  }
  const semFicha = doMotivo('sem_ficha');
  if (semFicha.length) fora.push(`${plural(semFicha.length, 'produto vendido não tem', 'produtos vendidos não têm')} ficha nem custo (${exemplos(semFicha)}). Crie a ficha em ${ONDE_CRIAR_FICHA}, ou informe o custo em ${ONDE_PRECO_DE_CUSTO}.`);
  const combos = doMotivo('combo');
  if (combos.length) fora.push(`${plural(combos.length, 'combo não tem', 'combos não têm')} custo (${exemplos(combos)}). Informe em ${ONDE_PRECO_DE_CUSTO}.`);
  const variacoes = doMotivo('variacao');
  if (variacoes.length) fora.push(`${plural(variacoes.length, 'produto com variação fica', 'produtos com variação ficam')} de fora (${exemplos(variacoes)}): o custo informado à mão não diz quanto cada tamanho usa. Use a ficha técnica em ${ONDE_CRIAR_FICHA}.`);
  if (doMotivo('adicional').length) fora.push('As vendas com adicional pago ficam de fora: o custo do adicional ainda não entra nesta conta.');
  const semCadastro = doMotivo('sem_cadastro');
  if (semCadastro.length) fora.push(`${plural(semCadastro.length, 'item vendido não está ligado', 'itens vendidos não estão ligados')} a um produto do cardápio (${exemplos(semCadastro)}).`);
  return fora;
}

// ───────────────────────────── margem bruta e CMV ─────────────────────────────

/** Mês inteiro compara com o mês anterior inteiro; outro período, com o anterior de mesmo tamanho (`null` aqui). */
export function mesAnteriorInteiro(de: string, ate: string): { de: string; ate: string } | null {
  if (de.slice(8, 10) !== '01' || de.slice(0, 7) !== ate.slice(0, 7)) return null;
  const ultimo = somarDias(`${ate.slice(0, 7)}-01`, 31);
  if (somarDias(`${ultimo.slice(0, 7)}-01`, -1) !== ate) return null;
  const fim = somarDias(de, -1);
  return { de: `${fim.slice(0, 7)}-01`, ate: fim };
}

const margemDe = (c: ContaDoCusto): { cmvPct: number; margemPct: number } => {
  const cmvPct = pct(c.custoCentavos, c.cobertoCentavos);
  return { cmvPct, margemPct: umaCasa(100 - cmvPct) };
};

export interface EntradaDaMargem {
  vendaOficialCentavos: number;
  /** A venda de produto (sem taxa de entrega e de serviço, que não têm custo de mercadoria): a cobertura se mede sobre ela. */
  vendaDeProdutoCentavos?: number;
  pedidos: number;
  conta: ContaDoCusto;
  anterior?: { rotulo: string; vendaOficialCentavos: number; vendaDeProdutoCentavos?: number; conta: ContaDoCusto } | null;
}

const COMO_CONTEI_A_MARGEM =
  'Venda oficial do período contra o custo teórico da ficha, com o custo de HOJE do cadastro. Só entra o produto com custo em todos os ingredientes, ou com o custo informado no produto.';

export function indicadorDeMargem(o: EntradaDaMargem): Record<string, unknown> {
  if (o.vendaOficialCentavos <= 0) return { semDados: true, oQueFalta: ['Não há venda registrada neste período: não dá para calcular a margem.'] };
  const baseDaCobertura = o.vendaDeProdutoCentavos ?? o.vendaOficialCentavos;
  const coberto = Math.min(o.conta.cobertoCentavos, baseDaCobertura);
  const coberturaPct = pct(coberto, baseDaCobertura);
  const cobertura = { vendaOficial: reais(o.vendaOficialCentavos), vendaDeProduto: reais(baseDaCobertura), pedidos: o.pedidos, vendaComCustoCompleto: reais(coberto), partePct: coberturaPct };
  const oQueFalta = oQueFaltaNoCusto(o.conta);
  if (o.conta.cobertoCentavos <= 0)
    return {
      semDados: true,
      cobertura,
      margemBruta: null,
      cmv: null,
      explica: 'Nenhum produto vendido tem custo completo: não dá para calcular a margem nem o CMV. Não diga 100% de margem nem R$ 0 de custo.',
      oQueFalta: oQueFalta.length ? oQueFalta : [`Falta o custo dos produtos. Para lançar: ${ONDE_CUSTO_DO_INSUMO}.`],
    };
  const m = margemDe(o.conta);
  const parcial = coberturaPct < COBERTURA_MINIMA_PCT;
  const avisos: string[] = [];
  if (parcial) avisos.push(`Número PARCIAL: só ${coberturaPct}% da venda de produto tem custo completo. Vale para essa parte, não para a loja inteira, e não dá para comparar com outro mês.`);
  else if (coberturaPct < 100) avisos.push(`O número vale para ${coberturaPct}% da venda de produto; o resto fica fora da conta.`);
  let comparacao: Record<string, unknown> | null = null;
  if (!parcial && o.anterior && o.anterior.vendaOficialCentavos > 0 && o.anterior.conta.cobertoCentavos > 0) {
    const baseAntes = o.anterior.vendaDeProdutoCentavos ?? o.anterior.vendaOficialCentavos;
    const cobAntes = pct(Math.min(o.anterior.conta.cobertoCentavos, baseAntes), baseAntes);
    if (cobAntes >= COBERTURA_MINIMA_PCT) {
      const a = margemDe(o.anterior.conta);
      comparacao = {
        periodo: o.anterior.rotulo,
        margemPct: a.margemPct,
        cmvPct: a.cmvPct,
        coberturaPct: cobAntes,
        diferencaDaMargemEmPontos: umaCasa(m.margemPct - a.margemPct),
        observacao: 'Os dois períodos usam o custo de hoje: a diferença vem de preço, desconto e do que foi vendido. Não atribua a nenhum insumo.',
      };
    } else avisos.push(`No período anterior só ${cobAntes}% da venda tem custo completo: não dá para comparar.`);
  }
  return {
    cobertura,
    parcial,
    margemBruta: { pct: m.margemPct, valor: reais(o.conta.cobertoCentavos - o.conta.custoCentavos) },
    cmv: { pct: m.cmvPct, valor: reais(o.conta.custoCentavos) },
    comoContei: COMO_CONTEI_A_MARGEM,
    comparacao,
    ...(avisos.length ? { avisos } : {}),
    ...(oQueFalta.length ? { oQueFalta } : {}),
  };
}

// ───────────────────────────── inadimplência ─────────────────────────────

export interface LeituraDoReceber {
  abertas: number;
  totalCentavos: number;
  vencidas: number;
  vencidoCentavos: number;
  maisAntiga: string | null;
}

export function indicadorDeInadimplencia(l: LeituraDoReceber, hoje: string, verValores: boolean): Record<string, unknown> {
  const ondeVer = `Os nomes ficam em ${ONDE_CONTAS_A_RECEBER}. Dado de cliente não sai por aqui.`;
  if (!l.abertas)
    return { semDados: true, contasEmAberto: 0, oQueFalta: [`Não há conta a receber em aberto lançada: não dá para medir a inadimplência. Para lançar: ${ONDE_LANCAR_CONTA}.`], ondeVer };
  return {
    contasEmAberto: l.abertas,
    contasVencidas: l.vencidas,
    diasDaMaisAntiga: l.maisAntiga ? diasEntreDatas(l.maisAntiga, hoje) : null,
    // O percentual e os dois valores: quem não vê valores recebe só as contagens.
    inadimplenciaPct: verValores ? pct(l.vencidoCentavos, l.totalCentavos) : null,
    vencido: verValores ? reais(l.vencidoCentavos) : null,
    totalAReceber: verValores ? reais(l.totalCentavos) : null,
    comoContei: 'O que já venceu e segue em aberto, sobre tudo o que está em aberto a receber.',
    ondeVer,
  };
}

// ───────────────────────────── prazo de pagamento ─────────────────────────────

export interface LeituraDoPrazo {
  titulos: number;
  mediaDias: number | null;
}

export function indicadorDePrazo(atual: LeituraDoPrazo, anterior: (LeituraDoPrazo & { rotulo: string }) | null): Record<string, unknown> {
  if (!atual.titulos || atual.mediaDias === null)
    return { semDados: true, titulosPagos: 0, oQueFalta: [`Não há conta a pagar paga neste período: não dá para medir o prazo. Para lançar: ${ONDE_LANCAR_CONTA}.`] };
  const pouco = atual.titulos < MINIMO_DE_TITULOS_PAGOS;
  const comparavel = !pouco && !!anterior && anterior.titulos >= MINIMO_DE_TITULOS_PAGOS && anterior.mediaDias !== null;
  return {
    prazoMedioDias: umaCasa(atual.mediaDias),
    titulosPagos: atual.titulos,
    comoContei: 'Dias entre a compra (o recebimento da mercadoria) ou a criação da conta e a data real do pagamento no caixa.',
    ...(pouco ? { avisos: [`Só ${plural(atual.titulos, 'conta paga', 'contas pagas')} neste período: é pouco para concluir.`] } : {}),
    comparacao: comparavel ? { periodo: anterior!.rotulo, prazoMedioDias: umaCasa(anterior!.mediaDias!), titulosPagos: anterior!.titulos, diferencaEmDias: umaCasa(atual.mediaDias - anterior!.mediaDias!) } : null,
  };
}

// ───────────────────────────── caixa: o saldo cobre quantos dias ─────────────────────────────

export interface DadoInformado {
  centavos: number;
  /** AAAA-MM-DD */
  dia: string;
}

export const saldoVale = (dia: string, hoje: string): boolean => {
  const idade = diasEntreDatas(dia, hoje);
  return idade >= 0 && idade <= VALIDADE_DO_SALDO_DIAS;
};

/** O que não é despesa: mexe no dinheiro da loja sem gastar (sangria), devolve uma venda (estorno) ou é o próprio caixa. */
const SAIDAS_QUE_NAO_SAO_DESPESA: ReadonlySet<string> = new Set(['sangria', 'estorno', 'venda', 'troco', 'suprimento']);
const CATEGORIA_DE_FOLHA = /\b(folha|salarios?|pessoal|holerite|pro labore|prolabore)\b/;

export interface SaidaDoMes {
  categoria: string;
  centavos: number;
}

export function classificarSaidas(saidas: ReadonlyArray<SaidaDoMes>): { despesasCentavos: number; folhaLancadaCentavos: number; foraDaContaCentavos: number } {
  let despesasCentavos = 0;
  let folhaLancadaCentavos = 0;
  let foraDaContaCentavos = 0;
  for (const s of saidas) {
    const c = semAcentoMinusculo(s.categoria).replace(/[_-]+/g, ' ');
    if (SAIDAS_QUE_NAO_SAO_DESPESA.has(c)) foraDaContaCentavos += s.centavos;
    else if (CATEGORIA_DE_FOLHA.test(c)) folhaLancadaCentavos += s.centavos;
    else despesasCentavos += s.centavos;
  }
  return { despesasCentavos, folhaLancadaCentavos, foraDaContaCentavos };
}

export interface EntradaDoCaixa {
  saldo: DadoInformado | null;
  folha: DadoInformado | null;
  saidas: ReadonlyArray<SaidaDoMes>;
  mes: { de: string; ate: string; nome: string };
  hoje: string;
}

const NAO_LEIO_OS_REPASSES = 'O runway em meses e o burn rate dependem do que entra de verdade na conta, e os repasses do iFood, da 99 e do cartão o Regem ainda não lê.';

export function indicadorDeCaixa(o: EntradaDoCaixa): Record<string, unknown> {
  const saldoOk = o.saldo && saldoVale(o.saldo.dia, o.hoje) ? o.saldo : null;
  const s = classificarSaidas(o.saidas);
  const oQueFalta: string[] = [];
  if (!saldoOk)
    oQueFalta.push(
      o.saldo
        ? `O saldo informado em ${diaMes(o.saldo.dia)} passou de ${VALIDADE_DO_SALDO_DIAS} dias e não vale mais: peça o saldo de hoje no banco.`
        : 'O saldo de hoje no banco: peça à pessoa.',
    );
  if (!o.folha) oQueFalta.push('Quanto sai de folha por mês, que não está lançada no Regem: peça à pessoa.');
  // Só com pagamento de entregador lançado, a conta ignoraria fornecedor e aluguel e diria que o saldo dura muito mais do que dura.
  const temContaDaLoja = o.saidas.some((x) => {
    const c = semAcentoMinusculo(x.categoria).replace(/[_-]+/g, ' ');
    return x.centavos > 0 && !SAIDAS_QUE_NAO_SAO_DESPESA.has(c) && !CATEGORIA_DE_FOLHA.test(c) && c !== 'pagamento entregador';
  });
  if (s.despesasCentavos <= 0 && !s.folhaLancadaCentavos) oQueFalta.push(`Nenhuma saída de despesa lançada em ${o.mes.nome}. Para lançar: ${ONDE_LANCAR_CONTA}.`);
  else if (!temContaDaLoja) oQueFalta.push(`Em ${o.mes.nome} só há entregador ou folha lançados: fornecedor, aluguel e as outras contas não estão no Regem, e a conta diria mais dias do que o saldo aguenta. Para lançar: ${ONDE_LANCAR_CONTA}.`);

  // A folha informada vale no lugar da folha lançada: as duas juntas contariam o mesmo dinheiro duas vezes.
  const folha = o.folha ? o.folha.centavos : null;
  const comFolha = folha !== null ? s.despesasCentavos + folha : null;
  const diasNoMes = diasEntreDatas(o.mes.de, o.mes.ate) + 1;
  const podeContar = !!saldoOk && comFolha !== null && temContaDaLoja && comFolha > 0;
  const diasQueCobre = podeContar ? Math.floor((saldoOk!.centavos * diasNoMes) / comFolha!) : null;

  const avisos: string[] = [];
  if (folha !== null && s.folhaLancadaCentavos > 0) avisos.push(`Já havia R$ ${reais(s.folhaLancadaCentavos).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lançados como folha em ${o.mes.nome}: usei a folha informada no lugar, para não contar duas vezes.`);
  if (podeContar) avisos.push('A conta só enxerga as saídas lançadas no Regem, e supõe a venda parada.');
  return {
    alcance: 'a empresa inteira',
    saldo: saldoOk ? { valor: reais(saldoOk.centavos), em: diaMes(saldoOk.dia), origem: 'veio de você, não do banco' } : null,
    folhaMensal: o.folha ? { valor: reais(o.folha.centavos), informadaEm: diaMes(o.folha.dia), origem: 'veio de você, é uma estimativa sua' } : null,
    saidasDoMes: {
      mes: o.mes.nome,
      lancadas: reais(s.despesasCentavos + s.folhaLancadaCentavos),
      comAFolhaInformada: comFolha !== null ? reais(comFolha) : null,
      foraDaConta: reais(s.foraDaContaCentavos),
      oQueFicaFora: 'Sangria, estorno e devolução não são despesa e ficam fora.',
    },
    diasQueOSaldoCobre: diasQueCobre,
    burnRate: null,
    runwayEmMeses: null,
    porQueNaoTemRunway: NAO_LEIO_OS_REPASSES,
    ...(avisos.length ? { avisos } : {}),
    ...(oQueFalta.length ? { oQueFalta } : {}),
    ...(diasQueCobre === null ? { semDados: true } : {}),
  };
}

// ───────────────────────────── os que ainda não têm dado ─────────────────────────────

export function indicadorSemDado(foco: 'margem_liquida' | 'giro_de_recebiveis'): Record<string, unknown> {
  return foco === 'margem_liquida'
    ? {
        semDados: true,
        margemLiquida: null,
        oQueE: 'O que sobra da venda depois de todas as despesas.',
        oQueFalta: ['O custo da mercadoria (a margem bruta).', 'A folha de pessoal.', 'Os impostos.', 'As taxas do iFood, da 99 e do cartão, que o Regem ainda não lê.'],
      }
    : {
        semDados: true,
        giroDeRecebiveis: null,
        oQueE: 'Em quantos dias a venda vira dinheiro na conta.',
        oQueFalta: ['Os repasses do iFood, da 99 e do cartão, que o Regem ainda não lê.'],
      };
}

// ───────────────────────────── ROI de uma campanha ─────────────────────────────

export interface EntradaDoRoi {
  campanha: string;
  desde: string;
  pedidos: number;
  faturamentoCentavos: number;
  /** A venda de produto dos pedidos, sem a taxa de entrega. */
  baseCentavos: number;
  conta: ContaDoCusto;
  custoCentavos: number | null;
  verValores: boolean;
}

export function indicadorDeRoi(o: EntradaDoRoi): Record<string, unknown> {
  const base = { campanha: o.campanha, desde: diaMes(o.desde), pedidosComCupom: o.pedidos, comoContei: 'Só os pedidos que usaram o cupom da campanha e valem na conta oficial, cada um uma vez.' };
  if (!o.pedidos) return { ...base, semDados: true, roiPct: null, oQueFalta: ['Nenhum pedido que vale na conta oficial usou o cupom desta campanha.'] };
  if (!o.verValores) return { ...base, roiPct: null };
  const vendas = { ...base, faturamento: reais(o.faturamentoCentavos) };
  const coberturaPct = pct(Math.min(o.conta.cobertoCentavos, o.baseCentavos), o.baseCentavos);
  const oQueFalta: string[] = [];
  if (o.custoCentavos === null) oQueFalta.push('Quanto foi gasto na campanha: peça à pessoa.');
  if (coberturaPct < COBERTURA_DO_ROI_PCT) oQueFalta.push(...oQueFaltaNoCusto(o.conta));
  if (coberturaPct < COBERTURA_DO_ROI_PCT)
    return {
      ...vendas,
      semDados: true,
      roiPct: null,
      custoInformado: o.custoCentavos !== null ? reais(o.custoCentavos) : null,
      coberturaPct,
      explica: 'Sem o custo da mercadoria destas vendas não dá para calcular o ROI. Não use o faturamento no lugar da margem.',
      oQueFalta,
    };
  const margem = o.conta.cobertoCentavos - o.conta.custoCentavos;
  if (o.custoCentavos === null) return { ...vendas, semDados: true, roiPct: null, margemDasVendas: reais(margem), coberturaPct, oQueFalta };
  return {
    ...vendas,
    custoInformado: o.custoCentavos / 100,
    origemDoCusto: 'veio de você, não do Regem',
    margemDasVendas: reais(margem),
    coberturaPct,
    sobraDepoisDoCusto: reais(margem - o.custoCentavos),
    roiPct: pct(margem - o.custoCentavos, o.custoCentavos),
    limite: 'A conta inclui quem compraria de qualquer jeito, e usa o custo de hoje do cadastro.',
  };
}
