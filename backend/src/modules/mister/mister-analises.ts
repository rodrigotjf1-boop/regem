import { somarDias } from '../../common/data';
import { diaMes, diferencaEmReais, variacaoPct } from './mister-agente.regras';

// AS ANÁLISES DE VENDA DO MISTER (versão 7, V7e; `docs/plano-mister.md` § "Versão 7"; protótipo `mockups/regem-mister-v7.html`,
// aba "Análises (BI)"). Só o que é puro: agrupar as linhas da conta OFICIAL (`RelatoriosService.linhasDaVendaOficial`) por dia
// da semana, hora e fase do mês; achar a faixa de pico; classificar o motivo de um cancelamento; e dizer o que falta lançar.
//
//  • Nenhuma soma de venda nasce aqui: as linhas são as de `vendasOficiais`, e o total bate com `vendas_do_periodo`.
//  • O motivo de cancelamento é TEXTO LIVRE e traz nome de funcionário: ele é classificado aqui e NUNCA sai daqui. O que vai à
//    IA é a causa (de uma lista fechada), a quantidade e o valor. Nenhuma análise aponta pessoa.
//  • Sem permissão de ver valores, nenhum R$ sai: os valores vêm nulos e as partes (%) são contadas em pedidos.
//  • Sem dado, diz o que falta lançar (V7-10). "Nada lançado" nunca vira "R$ 0 de perda".

export const FOCOS_DA_ANALISE = ['semana', 'pico', 'fases_do_mes', 'perdas'] as const;
export type FocoDaAnalise = (typeof FOCOS_DA_ANALISE)[number];

/** O período mais longo de uma análise de semana ou de perdas, em dias. */
export const MAX_DIAS_DA_ANALISE = 92;
/** O dia de trabalho vira às 06:00: a venda da 01:00 de sábado é da noite de sexta (a mesma régua das regras do Mister). */
export const VIRADA_DO_DIA = 6;
/** Semanas olhadas no pico de um dia da semana: o padrão, o mínimo e o máximo. */
export const SEMANAS_DO_PICO = { padrao: 4, minimo: 2, maximo: 8 } as const;
/** Menos que isto não é padrão: a análise mostra o número e diz que ainda é pouco para concluir. */
export const MINIMO_DE_SEMANAS = 3;
/** Com menos cancelamentos que isto, não se diz "onde se concentra". */
export const MINIMO_PARA_CONCENTRACAO = 5;
/** Um mês com menos dias de venda que isto é um mês incompleto. */
export const DIAS_DE_UM_MES_COMPLETO = 15;
/** Quantos itens e pares a análise devolve. */
export const ITENS_DO_PICO = 6;
export const PARES_DO_PICO = 4;
export const ITENS_DA_PERDA = 8;

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
/** A semana como a loja fala: de segunda a domingo. */
const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const semAcentoMinusculo = (t: unknown): string =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** 0 = domingo … 6 = sábado (o dia do calendário, sem fuso). */
export const diaDaSemanaDe = (iso: string): number => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
export const nomeDoDia = (d: number): string => DIAS[d] ?? '';
export const nomeCurtoDoDia = (d: number): string => DIAS_CURTOS[d] ?? '';

/** "sexta", "sexta-feira", "SEXTA", "sáb" → 5, 6… ou null. */
export function lerDiaDaSemana(v: unknown): number | null {
  const t = semAcentoMinusculo(v).replace(/-feira$/, '');
  if (!t) return null;
  const i = DIAS.findIndex((d) => {
    const n = semAcentoMinusculo(d);
    return n === t || (t.length >= 3 && n.startsWith(t));
  });
  return i >= 0 ? i : null;
}

const pct = (parte: number, todo: number): number => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
const reais = (centavos: number): number => Math.round(centavos) / 100;
const emReais = (centavos: number | null, ver: boolean): number | null => (ver && centavos !== null ? reais(centavos) : null);
const ticketEmCentavos = (centavos: number, pedidos: number): number | null => (pedidos > 0 ? Math.round(centavos / pedidos) : null);
const umaCasa = (n: number): number => Math.round(n * 10) / 10;
const hora2 = (h: number): string => `${String(h).padStart(2, '0')}h`;
/** "segunda, terça e sexta". */
export const emLista = (nomes: string[]): string => (nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

// ───────────────────────────── as linhas da conta oficial ─────────────────────────────

export interface LinhaOficial {
  dia: string;
  hora: number;
  pedidos: number;
  centavos: number;
}

/**
 * As linhas de `linhasDaVendaOficial`, em centavos. Cada linha (canal, dia, hora) se arredonda ANTES de somar, como em
 * `vendasOficiais`: juntar antes daria um centavo de diferença para o Painel.
 */
export function lerLinhasOficiais(rows: ReadonlyArray<Record<string, unknown>>): LinhaOficial[] {
  return (rows ?? []).map((l) => ({
    dia: String(l.chave ?? '').slice(0, 10),
    hora: Number(l.hora) || 0,
    pedidos: Number(l.qtd) || 0,
    centavos: Math.round(Number(l.fat) * 100) || 0,
  }));
}

const somar = (linhas: ReadonlyArray<LinhaOficial>): { pedidos: number; centavos: number } =>
  linhas.reduce((s, l) => ({ pedidos: s.pedidos + l.pedidos, centavos: s.centavos + l.centavos }), { pedidos: 0, centavos: 0 });

const diasEntre = (de: string, ate: string): string[] => {
  const fora: string[] = [];
  for (let d = de; d <= ate && fora.length <= 400; d = somarDias(d, 1)) fora.push(d);
  return fora;
};

// ───────────────────────────── a semana (ou um período) ─────────────────────────────

export interface EntradaDaSemana {
  linhas: LinhaOficial[];
  anteriores: LinhaOficial[];
  de: string;
  ate: string;
  deAnterior: string;
  ateAnterior: string;
  hoje: string;
  verValores: boolean;
}

export function analiseDaSemana(o: EntradaDaSemana) {
  const atual = somar(o.linhas);
  const antes = somar(o.anteriores);
  const v = o.verValores;
  const medida = (x: { centavos: number; pedidos: number }) => (v ? x.centavos : x.pedidos);
  const dias = diasEntre(o.de, o.ate);
  const porData = new Map<string, { pedidos: number; centavos: number }>();
  for (const l of o.linhas) {
    const x = porData.get(l.dia) ?? { pedidos: 0, centavos: 0 };
    x.pedidos += l.pedidos;
    x.centavos += l.centavos;
    porData.set(l.dia, x);
  }
  const grupos = ORDEM_DA_SEMANA.map((d) => {
    const datas = dias.filter((x) => diaDaSemanaDe(x) === d);
    const comVenda = datas.filter((x) => (porData.get(x)?.pedidos ?? 0) > 0);
    const soma = comVenda.reduce((s, x) => ({ pedidos: s.pedidos + porData.get(x)!.pedidos, centavos: s.centavos + porData.get(x)!.centavos }), { pedidos: 0, centavos: 0 });
    return { d, datas, diasComVenda: comVenda.length, ...soma, media: comVenda.length ? medida(soma) / comVenda.length : 0 };
  }).filter((g) => g.datas.length > 0);
  const todoTotal = medida(atual);
  const comVenda = grupos.filter((g) => g.diasComVenda > 0);
  const ordenados = [...comVenda].sort((a, b) => b.media - a.media || a.d - b.d);
  const melhores = ordenados.slice(0, 2);
  const fraco = ordenados.length ? ordenados[ordenados.length - 1] : null;
  const diasComVendaNoPeriodo = new Set(o.linhas.filter((l) => l.pedidos > 0).map((l) => l.dia)).size;
  const diasComVendaAntes = new Set(o.anteriores.filter((l) => l.pedidos > 0).map((l) => l.dia)).size;

  const avisos: string[] = [];
  if (o.ate >= o.hoje) avisos.push('O período inclui hoje, que ainda não fechou: o número de hoje ainda vai mudar.');
  if (!antes.pedidos) avisos.push('O período anterior não tem venda: não há com o que comparar.');
  else if (diasComVendaAntes < diasComVendaNoPeriodo) avisos.push(`O período anterior teve só ${diasComVendaAntes} dia(s) com venda, contra ${diasComVendaNoPeriodo} agora: a comparação fica desigual.`);
  if (atual.pedidos && comVenda.length < 3) avisos.push('Poucos dias com venda neste período: ainda não dá para dizer qual é o melhor nem o mais fraco.');
  const semVenda = grupos.filter((g) => g.diasComVenda === 0).map((g) => nomeDoDia(g.d));

  return {
    temDados: atual.pedidos > 0,
    faturamento: emReais(atual.centavos, v),
    pedidos: atual.pedidos,
    ticketMedio: emReais(ticketEmCentavos(atual.centavos, atual.pedidos), v),
    diasComVenda: diasComVendaNoPeriodo,
    anterior: {
      faturamento: emReais(antes.centavos, v),
      pedidos: antes.pedidos,
      ticketMedio: emReais(ticketEmCentavos(antes.centavos, antes.pedidos), v),
      diasComVenda: diasComVendaAntes,
    },
    variacaoPct: {
      faturamento: v ? variacaoPct(atual.centavos, antes.centavos) : null,
      pedidos: variacaoPct(atual.pedidos, antes.pedidos),
      ticketMedio: v ? variacaoPct(ticketEmCentavos(atual.centavos, atual.pedidos), ticketEmCentavos(antes.centavos, antes.pedidos)) : null,
    },
    diferencaDeFaturamento: v ? diferencaEmReais(reais(atual.centavos), reais(antes.centavos)) : null,
    porDiaDaSemana: grupos.map((g) => ({
      dia: nomeCurtoDoDia(g.d),
      ...(g.datas.length === 1 ? { data: diaMes(g.datas[0]) } : { diasNoPeriodo: g.datas.length, diasComVenda: g.diasComVenda }),
      pedidos: g.pedidos,
      faturamento: emReais(g.centavos, v),
      partePct: pct(medida(g), todoTotal),
    })),
    doisMelhoresDias:
      comVenda.length >= 3
        ? {
            dias: melhores.map((g) => nomeDoDia(g.d)),
            pedidos: melhores.reduce((s, g) => s + g.pedidos, 0),
            faturamento: emReais(melhores.reduce((s, g) => s + g.centavos, 0), v),
            partePct: pct(melhores.reduce((s, g) => s + medida(g), 0), todoTotal),
          }
        : null,
    diaMaisFraco: comVenda.length >= 3 && fraco ? { dia: nomeDoDia(fraco.d), pedidos: fraco.pedidos, faturamento: emReais(fraco.centavos, v), partePct: pct(medida(fraco), todoTotal) } : null,
    ...(semVenda.length && atual.pedidos ? { diasSemVenda: semVenda } : {}),
    ...(avisos.length ? { avisos } : {}),
  };
}

// ───────────────────────────── o pico ─────────────────────────────

/** O dia de trabalho de uma venda: até as 05:59, ainda é a noite do dia anterior. */
export const diaDeTrabalho = (dia: string, hora: number): string => (hora < VIRADA_DO_DIA ? somarDias(dia, -1) : dia);
/** A posição da hora no dia de trabalho: 06h = 0 … 23h = 17, 00h = 18 … 05h = 23. */
export const posicaoDaHora = (h: number): number => (h - VIRADA_DO_DIA + 24) % 24;

/** Os últimos `n` dias da semana `d`, antes de hoje (hoje ainda não fechou), do mais velho ao mais novo. */
export function ultimosDiasDaSemana(d: number, n: number, hoje: string): string[] {
  const fora: string[] = [];
  for (let x = somarDias(hoje, -1); fora.length < n; x = somarDias(x, -1)) if (diaDaSemanaDe(x) === d) fora.unshift(x);
  return fora;
}

export interface FaixaDePico {
  /** As horas do relógio, na ordem do dia de trabalho. */
  horas: number[];
  de: string;
  ate: string;
}

/**
 * A faixa de pico, pelos PEDIDOS (é o que pesa na cozinha, e dá a mesma resposta a quem não vê valores): a menor janela de
 * horas seguidas (até 3) com metade ou mais dos pedidos do dia; se nenhuma chega, a janela de 3 horas com mais pedidos. No
 * empate, a mais cedo.
 */
export function faixaDePico(porHora: ReadonlyArray<{ hora: number; pedidos: number }>): FaixaDePico | null {
  const n = new Array<number>(24).fill(0);
  for (const h of porHora) n[posicaoDaHora(h.hora)] += h.pedidos;
  const total = n.reduce((s, x) => s + x, 0);
  if (!total) return null;
  let melhor: { ini: number; tam: number; soma: number } | null = null;
  for (const tam of [1, 2, 3]) {
    melhor = null;
    for (let ini = 0; ini + tam <= 24; ini++) {
      const soma = n.slice(ini, ini + tam).reduce((s, x) => s + x, 0);
      if (!melhor || soma > melhor.soma) melhor = { ini, tam, soma };
    }
    if (melhor && melhor.soma * 2 >= total) break;
  }
  const f = melhor!;
  // Hora vazia na ponta não faz parte da faixa.
  let ini = f.ini;
  let fim = f.ini + f.tam - 1;
  while (ini < fim && n[ini] === 0) ini++;
  while (fim > ini && n[fim] === 0) fim--;
  const relogio = (p: number) => (p + VIRADA_DO_DIA) % 24;
  const horas = Array.from({ length: fim - ini + 1 }, (_, i) => relogio(ini + i));
  return { horas, de: hora2(horas[0]), ate: hora2((horas[horas.length - 1] + 1) % 24) };
}

export interface ItemDoPico {
  item: string;
  quantidade: number;
  pedidos: number;
}
export interface ParDoPico {
  a: string;
  b: string;
  juntos: number;
}

export interface EntradaDoPico {
  linhas: LinhaOficial[];
  /** Os dias de trabalho olhados (um dia, ou as últimas sextas). */
  dias: string[];
  /** Foi pedido um dia da semana ao longo de semanas. */
  porSemanas: boolean;
  hoje: string;
  verValores: boolean;
}

export function analiseDoPico(o: EntradaDoPico) {
  const v = o.verValores;
  const alvo = new Set(o.dias);
  const doDia = o.linhas.filter((l) => alvo.has(diaDeTrabalho(l.dia, l.hora)));
  const total = somar(doDia);
  const medida = (x: { pedidos: number; centavos: number }) => (v ? x.centavos : x.pedidos);
  const porHoraMapa = new Map<number, { hora: number; pedidos: number; centavos: number }>();
  for (const l of doDia) {
    const x = porHoraMapa.get(l.hora) ?? { hora: l.hora, pedidos: 0, centavos: 0 };
    x.pedidos += l.pedidos;
    x.centavos += l.centavos;
    porHoraMapa.set(l.hora, x);
  }
  const horas = [...porHoraMapa.values()].filter((h) => h.pedidos > 0).sort((a, b) => posicaoDaHora(a.hora) - posicaoDaHora(b.hora));
  const faixa = faixaDePico(horas);
  const naFaixa = faixa ? horas.filter((h) => faixa.horas.includes(h.hora)) : [];
  const somaFaixa = naFaixa.reduce((s, h) => ({ pedidos: s.pedidos + h.pedidos, centavos: s.centavos + h.centavos }), { pedidos: 0, centavos: 0 });
  const diasComVenda = new Set(doDia.filter((l) => l.pedidos > 0).map((l) => diaDeTrabalho(l.dia, l.hora))).size;
  const porDia = Math.max(1, diasComVenda);

  const avisos: string[] = [];
  if (o.dias.includes(o.hoje)) avisos.push('Hoje ainda não fechou: o pico pode mudar.');
  if (o.porSemanas && total.pedidos && diasComVenda < MINIMO_DE_SEMANAS)
    avisos.push(`Só ${diasComVenda} ${diasComVenda === 1 ? 'dia' : 'dias'} com venda nas semanas olhadas: ainda é pouco para falar em padrão.`);

  return {
    temDados: total.pedidos > 0,
    diasOlhados: o.dias.length,
    diasComVenda,
    comoContei: `O dia vai das ${String(VIRADA_DO_DIA).padStart(2, '0')}:00 às ${String(VIRADA_DO_DIA - 1).padStart(2, '0')}:59 do dia seguinte: a venda depois da meia-noite conta na noite em que começou.`,
    totalDoDia: { pedidos: total.pedidos, faturamento: emReais(total.centavos, v) },
    porHora: horas.map((h) => ({ hora: hora2(h.hora), pedidos: h.pedidos, faturamento: emReais(h.centavos, v), partePct: pct(medida(h), medida(total)) })),
    faixaDePico: faixa
      ? {
          de: faixa.de,
          ate: faixa.ate,
          pedidos: somaFaixa.pedidos,
          faturamento: emReais(somaFaixa.centavos, v),
          partePct: pct(medida(somaFaixa), medida(total)),
          ...(diasComVenda > 1 ? { mediaPorDia: { pedidos: umaCasa(somaFaixa.pedidos / porDia), faturamento: emReais(Math.round(somaFaixa.centavos / porDia), v) } } : {}),
        }
      : null,
    horasDaFaixa: faixa?.horas ?? [],
    ...(avisos.length ? { avisos } : {}),
  };
}

/** Os itens e os pares da faixa, com "em X de Y pedidos". Com menos de 5 pedidos, os pares ficam de fora (é coincidência). */
export function itensDaFaixa(itens: ReadonlyArray<ItemDoPico>, pares: ReadonlyArray<ParDoPico>, pedidosComItens: number, pedidosDaFaixa: number) {
  return {
    pedidosComItens,
    ...(pedidosComItens < pedidosDaFaixa ? { observacaoDosItens: `${pedidosDaFaixa - pedidosComItens} pedido(s) da faixa não têm os itens gravados: as contas de itens são sobre ${pedidosComItens}.` } : {}),
    itensQueMaisSaem: itens.slice(0, ITENS_DO_PICO).map((i) => ({ item: i.item, quantidade: Math.round(i.quantidade * 1000) / 1000, emPedidos: i.pedidos, de: pedidosComItens })),
    saemJuntos:
      pedidosComItens >= 5
        ? pares
            .filter((p) => p.juntos >= 2)
            .slice(0, PARES_DO_PICO)
            .map((p) => ({ itens: `${p.a} + ${p.b}`, juntos: p.juntos, de: pedidosComItens, frase: `em ${p.juntos} de ${pedidosComItens} pedidos`, partePct: pct(p.juntos, pedidosComItens) }))
        : [],
  };
}

// ───────────────────────────── as fases do mês ─────────────────────────────

export interface MesDaAnalise {
  de: string;
  ate: string;
  nome: string;
}

/** Os `n` últimos meses COMPLETOS antes de hoje, do mais velho ao mais novo. */
export function mesesCompletos(hoje: string, n = 3): MesDaAnalise[] {
  const fora: MesDaAnalise[] = [];
  let primeiro = `${hoje.slice(0, 7)}-01`;
  for (let i = 0; i < n; i++) {
    const ate = somarDias(primeiro, -1);
    const de = `${ate.slice(0, 7)}-01`;
    fora.unshift({ de, ate, nome: MESES[Number(ate.slice(5, 7)) - 1] });
    primeiro = de;
  }
  return fora;
}

export const FASES_DO_MES = [
  { fase: 'dias 1 a 10', de: 1, ate: 10 },
  { fase: 'dias 11 a 20', de: 11, ate: 20 },
  { fase: 'dias 21 ao fim', de: 21, ate: 31 },
] as const;

export function analiseDasFases(linhas: ReadonlyArray<LinhaOficial>, meses: ReadonlyArray<MesDaAnalise>, verValores: boolean) {
  const v = verValores;
  const dentro = linhas.filter((l) => meses.some((m) => l.dia >= m.de && l.dia <= m.ate));
  const total = somar(dentro);
  const faseDe = (dia: string) => FASES_DO_MES.findIndex((f) => Number(dia.slice(8, 10)) >= f.de && Number(dia.slice(8, 10)) <= f.ate);
  const fases = FASES_DO_MES.map((f, i) => {
    const l = dentro.filter((x) => faseDe(x.dia) === i);
    const s = somar(l);
    const diasComVenda = new Set(l.filter((x) => x.pedidos > 0).map((x) => x.dia)).size;
    return { fase: f.fase, s, diasComVenda, porDia: diasComVenda ? s.centavos / diasComVenda : 0, pedidosPorDia: diasComVenda ? s.pedidos / diasComVenda : 0, ticket: ticketEmCentavos(s.centavos, s.pedidos) };
  });
  const porMes = meses.map((m) => {
    const l = dentro.filter((x) => x.dia >= m.de && x.dia <= m.ate);
    const s = somar(l);
    return { mes: m.nome, diasComVenda: new Set(l.filter((x) => x.pedidos > 0).map((x) => x.dia)).size, pedidos: s.pedidos, faturamento: emReais(s.centavos, v) };
  });
  const incompletos = porMes.filter((m) => m.diasComVenda < DIAS_DE_UM_MES_COMPLETO).map((m) => m.mes);
  const validos = porMes.length - incompletos.length;
  const [comeco, , fim] = fases;
  const comparavel = comeco.diasComVenda > 0 && fim.diasComVenda > 0 && validos >= 2;
  const avisos: string[] = [];
  if (incompletos.length && total.pedidos) avisos.push(`Mês com poucos dias de venda (menos de ${DIAS_DE_UM_MES_COMPLETO}): ${emLista(incompletos)}. Ele pesa menos na conclusão.`);
  if (total.pedidos && validos < 2) avisos.push('Ainda não há dois meses completos de venda: dá para mostrar os números, mas não para concluir um padrão do mês.');
  return {
    temDados: total.pedidos > 0,
    mesesOlhados: emLista(meses.map((m) => m.nome)),
    comoContei: 'A venda, os pedidos e o ticket por dia contam só os dias em que a loja vendeu: dia fechado não puxa a média para baixo.',
    fases: fases.map((f) => ({
      fase: f.fase,
      diasComVenda: f.diasComVenda,
      pedidos: f.s.pedidos,
      faturamento: emReais(f.s.centavos, v),
      vendaPorDia: emReais(f.diasComVenda ? Math.round(f.porDia) : null, v),
      pedidosPorDia: umaCasa(f.pedidosPorDia),
      ticketMedio: emReais(f.ticket, v),
    })),
    doComecoParaOFim: comparavel
      ? {
          vendaPorDiaPct: v ? variacaoPct(Math.round(fim.porDia), Math.round(comeco.porDia)) : null,
          pedidosPorDiaPct: variacaoPct(umaCasa(fim.pedidosPorDia), umaCasa(comeco.pedidosPorDia)),
          ticketPct: v ? variacaoPct(fim.ticket, comeco.ticket) : null,
        }
      : null,
    porMes,
    totalDosMeses: { pedidos: total.pedidos, faturamento: emReais(total.centavos, v) },
    ...(avisos.length ? { avisos } : {}),
  };
}

// ───────────────────────────── os cancelamentos ─────────────────────────────

export const CAUSAS_DO_CANCELAMENTO = [
  'fora_da_area',
  'repetido',
  'nao_atendeu',
  'engano',
  'erro_de_lancamento',
  'bloqueado',
  'desistiu',
  'atraso',
  'item_em_falta',
  'sem_entregador',
  'loja_fechada',
  'pagamento',
  'sem_motivo_do_canal',
  'sem_motivo',
  'outros',
  'teste',
] as const;
export type CausaDoCancelamento = (typeof CAUSAS_DO_CANCELAMENTO)[number];

export const NOME_DA_CAUSA: Record<CausaDoCancelamento, string> = {
  fora_da_area: 'fora da área de entrega',
  repetido: 'pedido repetido',
  nao_atendeu: 'cliente não atendeu',
  engano: 'engano no pedido',
  erro_de_lancamento: 'erro ao lançar',
  bloqueado: 'cliente bloqueado',
  desistiu: 'cliente desistiu ou pediu para cancelar',
  atraso: 'atraso',
  item_em_falta: 'item em falta',
  sem_entregador: 'sem entregador',
  loja_fechada: 'loja fechada ou fora do horário',
  pagamento: 'problema no pagamento',
  sem_motivo_do_canal: 'sem motivo informado pelo canal',
  sem_motivo: 'sem motivo anotado',
  outros: 'outros motivos',
  teste: 'pedido de teste',
};

/** Estas não dizem a causa: aparecem na lista, mas nunca como "a principal causa". */
const CAUSAS_SEM_EXPLICACAO: ReadonlySet<CausaDoCancelamento> = new Set(['sem_motivo_do_canal', 'sem_motivo', 'outros']);

const REGRAS_DA_CAUSA: ReadonlyArray<[CausaDoCancelamento, RegExp]> = [
  ['teste', /\b(testes?|testando)\b/],
  ['repetido', /(pediu|pedido|pedindo|lancado|lancou)\s+(em\s+)?(duas|2)\s*(x|vezes)|repeti[dou]|duplicad|duplicidade|em dobro|pedido igual/],
  ['fora_da_area', /fora d[ae] (area|zona|raio|cobertura)|area de entrega|nao (entregamos|atendemos)|muito longe/],
  ['sem_entregador', /(sem|falta de|faltou|nao tem|nao tinha) (o )?(entregador|motoboy|moto\b)/],
  ['nao_atendeu', /nao (atendeu|atende|responde|respondeu|retornou)|sem resposta|sem retorno|nao (foi )?(encontrad|localizad)|ausente/],
  ['bloqueado', /bloquead|bloqueio/],
  ['erro_de_lancamento', /(lanc\w*|digit\w*)\s+(\w+\s+)?errad|errad\w*\s+(ao\s+)?(lanc|digit)|erro (ao|de|no) (lanc|digit)/],
  ['engano', /engano|equivoco|errad|errou/],
  ['atraso', /atras|demor/],
  // Antes da falta de item: "falta de pagamento" é pagamento.
  ['pagamento', /pagamento|nao pagou|\bpix\b|cartao recusad/],
  ['item_em_falta', /em falta|por falta|falta de|faltou|acabou|sem estoque|indisponivel|nao tem mais|nao tinha/],
  ['loja_fechada', /loja fechad|fechad[ao]|fechando|fora do horario/],
  ['desistiu', /desist|(pediu|solicitou)( o| para| pra)? cancel|cliente cancelou|cancelad[oa] pel[oa] cliente|cancelou|nao quer mais/],
  ['sem_motivo_do_canal', /^(pedido )?cancelad[oa] (pel[oa]|n[oa]|via) (o |a )?(cardapio[_ ]?web|cardapio|ifood|99 ?food|99|anota[_ ]?ai|canal|plataforma|marketplace|aplicativo|app)\.?$/],
];

/**
 * A causa do motivo escrito (sem acento e sem caixa). O que vem depois de "autorizado por" é um NOME e sai antes de classificar:
 * um nome não decide a causa. "Teste" vem primeiro (pedido de teste não é perda); o que não casa com nada é "outros".
 */
export function causaDoCancelamento(motivo: unknown): CausaDoCancelamento {
  const t = semAcentoMinusculo(motivo)
    .replace(/\(?\s*autorizad[oa] por[^)]*\)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 'sem_motivo';
  for (const [causa, re] of REGRAS_DA_CAUSA) if (re.test(t)) return causa;
  return 'outros';
}

export interface GrupoDoCancelamento {
  motivo: unknown;
  /** 0 = domingo … 6 = sábado, no relógio da loja. */
  dow: number;
  hora: number;
  pedidos: number;
  centavos: number;
}

/**
 * Os cancelamentos por causa. Só a causa, a quantidade e o valor saem daqui: o texto do motivo não. O `total` é o da consulta:
 * se a lista de grupos foi cortada, o que ficou de fora entra em "outros" e a soma continua certa. O pedido de teste fica à
 * parte e fora do total.
 */
export function analiseDosCancelamentos(grupos: ReadonlyArray<GrupoDoCancelamento>, total: { pedidos: number; centavos: number }, verValores: boolean) {
  const v = verValores;
  const porCausa = new Map<CausaDoCancelamento, { pedidos: number; centavos: number }>();
  const porDia = new Array<number>(7).fill(0);
  const porHora = new Array<number>(24).fill(0);
  let lidos = 0;
  let lidosCentavos = 0;
  for (const g of grupos) {
    const c = causaDoCancelamento(g.motivo);
    const x = porCausa.get(c) ?? { pedidos: 0, centavos: 0 };
    x.pedidos += g.pedidos;
    x.centavos += g.centavos;
    porCausa.set(c, x);
    lidos += g.pedidos;
    lidosCentavos += g.centavos;
    if (c !== 'teste') {
      if (g.dow >= 0 && g.dow <= 6) porDia[g.dow] += g.pedidos;
      if (g.hora >= 0 && g.hora <= 23) porHora[g.hora] += g.pedidos;
    }
  }
  if (total.pedidos > lidos) {
    const x = porCausa.get('outros') ?? { pedidos: 0, centavos: 0 };
    x.pedidos += total.pedidos - lidos;
    x.centavos += total.centavos - lidosCentavos;
    porCausa.set('outros', x);
  }
  const teste = porCausa.get('teste') ?? { pedidos: 0, centavos: 0 };
  porCausa.delete('teste');
  const reaisOuPedidos = (x: { pedidos: number; centavos: number }) => (v ? x.centavos : x.pedidos);
  const lista = [...porCausa.entries()].sort((a, b) => reaisOuPedidos(b[1]) - reaisOuPedidos(a[1]) || b[1].pedidos - a[1].pedidos);
  const naoEntrou = lista.reduce((s, [, x]) => ({ pedidos: s.pedidos + x.pedidos, centavos: s.centavos + x.centavos }), { pedidos: 0, centavos: 0 });
  const explicadas = lista.filter(([c]) => !CAUSAS_SEM_EXPLICACAO.has(c));
  const semExplicacao = lista.filter(([c]) => CAUSAS_SEM_EXPLICACAO.has(c)).reduce((s, [, x]) => s + x.pedidos, 0);

  const avisos: string[] = [];
  let ondeSeConcentra: Record<string, unknown> | null = null;
  if (naoEntrou.pedidos >= MINIMO_PARA_CONCENTRACAO) {
    const maiorDia = porDia.reduce((m, n, i) => (n > porDia[m] ? i : m), 0);
    const maiorHora = porHora.reduce((m, n, i) => (n > porHora[m] ? i : m), 0);
    ondeSeConcentra = {
      diaDaSemana: { dia: nomeDoDia(maiorDia), pedidos: porDia[maiorDia], partePct: pct(porDia[maiorDia], naoEntrou.pedidos) },
      hora: { hora: hora2(maiorHora), pedidos: porHora[maiorHora], partePct: pct(porHora[maiorHora], naoEntrou.pedidos) },
    };
  } else if (naoEntrou.pedidos) avisos.push(`Só ${naoEntrou.pedidos} cancelamento(s) no período: ainda é pouco para dizer onde se concentram.`);
  if (semExplicacao && naoEntrou.pedidos) avisos.push(`${semExplicacao} de ${naoEntrou.pedidos} cancelamentos não dizem a causa (o canal não informou, ou não foi anotado): não conclua nada sobre eles.`);

  return {
    temDados: naoEntrou.pedidos > 0 || teste.pedidos > 0,
    naoEntrou: { pedidos: naoEntrou.pedidos, valor: emReais(naoEntrou.centavos, v) },
    porCausa: lista.map(([c, x]) => ({
      causa: NOME_DA_CAUSA[c],
      ...(CAUSAS_SEM_EXPLICACAO.has(c) ? { naoDizACausa: true } : {}),
      pedidos: x.pedidos,
      valor: emReais(x.centavos, v),
      partePct: pct(reaisOuPedidos(x), reaisOuPedidos(naoEntrou)),
    })),
    principalCausa: explicadas.length ? { causa: NOME_DA_CAUSA[explicadas[0][0]], pedidos: explicadas[0][1].pedidos, valor: emReais(explicadas[0][1].centavos, v) } : null,
    ondeSeConcentra,
    ...(teste.pedidos ? { pedidosDeTeste: { pedidos: teste.pedidos, valor: emReais(teste.centavos, v), observacao: 'Pedido de teste não é perda: está fora do total.' } } : {}),
    ...(avisos.length ? { avisos } : {}),
  };
}

// ───────────────────────────── a mercadoria perdida ─────────────────────────────

export interface LinhaDoDesperdicio {
  /** null = registro sem item ligado (só o texto): o texto não vai à IA. */
  item: string | null;
  unidade: string | null;
  registros: number;
  quantidade: number;
  /** Só dos registros COM custo. */
  centavos: number;
  semCusto: number;
}

export interface LinhaDaContagem {
  item: string;
  unidade: string | null;
  /** O ajuste: negativo = faltou; positivo = sobrou. */
  diferenca: number;
  /** O valor da diferença, sem sinal; null = o item não tem custo. */
  centavos: number | null;
}

export const ONDE_LANCAR_DESPERDICIO = 'Estoque › aba "Desperdício", botão "Registrar desperdício"';
export const ONDE_CONTAR = 'Estoque › aba "Contagem"';

const quantidade3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * O desperdício e a diferença de contagem por item, em valor. Registro sem custo conta na quantidade e NÃO no valor, e a resposta
 * diz isso. Nada lançado volta `valor: null` e o que falta lançar: nunca "R$ 0 de perda".
 */
export function analiseDaMercadoria(desperdicio: ReadonlyArray<LinhaDoDesperdicio>, contagem: ReadonlyArray<LinhaDaContagem>, itensContados: number, verValores: boolean) {
  const v = verValores;
  const registros = desperdicio.reduce((s, l) => s + l.registros, 0);
  const semCusto = desperdicio.reduce((s, l) => s + l.semCusto, 0);
  const centavosDesp = desperdicio.reduce((s, l) => s + l.centavos, 0);
  const temValorDesp = registros - semCusto > 0;
  const itensDesp = [...desperdicio].sort((a, b) => b.centavos - a.centavos || b.registros - a.registros);
  const faltou = contagem.filter((l) => l.diferenca < 0).sort((a, b) => (b.centavos ?? 0) - (a.centavos ?? 0) || a.diferenca - b.diferenca);
  const sobrou = contagem.filter((l) => l.diferenca > 0);
  const centavosFaltou = faltou.reduce((s, l) => s + (l.centavos ?? 0), 0);
  const faltouSemCusto = faltou.filter((l) => l.centavos === null).length;
  const centavosSobrou = sobrou.reduce((s, l) => s + (l.centavos ?? 0), 0);

  const oQueFalta: string[] = [];
  if (!registros) oQueFalta.push(`Nenhum desperdício lançado neste período. Para medir, a loja lança em ${ONDE_LANCAR_DESPERDICIO}.`);
  if (!itensContados) oQueFalta.push(`Nenhuma contagem concluída neste período. Para achar diferença de estoque, a loja conta em ${ONDE_CONTAR}.`);
  if (semCusto) oQueFalta.push(`${semCusto} registro(s) de desperdício sem custo: entram na quantidade e não no valor. O custo vem do custo médio do produto no Estoque.`);
  if (faltouSemCusto) oQueFalta.push(`${faltouSemCusto} item(ns) da contagem sem custo: entram na quantidade e não no valor.`);

  const temValor = temValorDesp || faltou.some((l) => l.centavos !== null);
  return {
    temDados: registros > 0 || contagem.length > 0,
    valorPerdido: v && temValor ? reais(centavosDesp + centavosFaltou) : null,
    desperdicio: {
      registros,
      registrosSemCusto: semCusto,
      valor: v && temValorDesp ? reais(centavosDesp) : null,
      itens: itensDesp.slice(0, ITENS_DA_PERDA).map((l) => ({
        item: l.item ?? 'registro sem item ligado',
        quantidade: quantidade3(l.quantidade),
        unidade: l.unidade,
        registros: l.registros,
        valor: v && l.registros > l.semCusto ? reais(l.centavos) : null,
        ...(l.semCusto ? { registrosSemCusto: l.semCusto } : {}),
      })),
    },
    contagem: {
      itensContados,
      itensComDiferenca: contagem.length,
      valorQueFaltou: v && faltou.some((l) => l.centavos !== null) ? reais(centavosFaltou) : null,
      faltou: faltou.slice(0, ITENS_DA_PERDA).map((l) => ({ item: l.item, quantidade: quantidade3(-l.diferenca), unidade: l.unidade, valor: l.centavos === null ? null : emReais(l.centavos, v) })),
      ...(sobrou.length ? { sobrou: { itens: sobrou.length, valor: v && sobrou.some((l) => l.centavos !== null) ? reais(centavosSobrou) : null, observacao: 'Sobra na contagem não abate a perda: costuma ser lançamento que faltou.' } } : {}),
    },
    ...(oQueFalta.length ? { oQueFalta } : {}),
  };
}
