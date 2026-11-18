import { BadRequestException } from '@nestjs/common';
import { FUSO_OPERACAO, somarDias } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O GASTO DO WHATSAPP OFICIAL (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado pelo dono em 18/11/2026 com
// as oito decisões recomendadas) — as regras puras: ler o que a Meta devolve, agrupar por dia no fuso da loja, os tipos de
// mensagem, o período da tela, a projeção do mês e a franquia do atendimento. Nada aqui lê banco, rede ou relógio: o
// "agora" e o "hoje" vêm de quem chama.
//
// A Meta cobra a loja direto, por mensagem ENTREGUE, pelo tipo (categoria) e pelo tipo de preço: `REGULAR` é cobrada;
// `FREE_CUSTOMER_SERVICE` e `FREE_ENTRY_POINT` são grátis. Desde 01/10/2026 o atendimento (SERVICE) é cobrado depois de
// 1.000 por mês em cada número. O custo que a Meta informa é APROXIMADO, na moeda da conta — a fatura oficial é a dela.

/** Mensagens de atendimento grátis por mês, em cada número (Meta, desde 01/10/2026). */
export const FRANQUIA_DO_ATENDIMENTO = 1000;
/** De quanto em quanto tempo a nuvem lê o gasto de cada conta. */
export const MINUTOS_ENTRE_LEITURAS = 30;
/** O "De onde veio" (por modelo) muda devagar: lido de 3 em 3 horas. */
export const HORAS_ENTRE_LEITURAS_DE_MODELO = 3;
/** Quantos meses para trás a Meta guarda (`pricing_analytics`, desde 01/12/2025) — a carga inicial lê todos. */
export const MESES_DE_HISTORICO = 12;
/** O `template_analytics` guarda 90 dias. */
export const DIAS_DE_HISTORICO_DE_MODELO = 90;
/** O período "outro" vai até um ano para trás e um ano de comprimento. */
export const DIAS_MAX_DO_PERIODO = 366;

export type Grupo = 'marketing' | 'utilidade' | 'atendimento' | 'autenticacao' | 'outros';
export const GRUPOS: Grupo[] = ['marketing', 'utilidade', 'atendimento', 'autenticacao', 'outros'];

/** O grupo da tela para a categoria da Meta (MARKETING_LITE é marketing; AUTHENTICATION_INTERNATIONAL, autenticação). */
export function grupoDaCategoria(categoria: unknown): Grupo {
  const c = String(categoria ?? '').toUpperCase();
  if (c.startsWith('MARKETING')) return 'marketing';
  if (c === 'UTILITY') return 'utilidade';
  if (c === 'SERVICE') return 'atendimento';
  if (c.startsWith('AUTHENTICATION')) return 'autenticacao';
  return 'outros';
}

/** A mensagem foi cobrada? Só o tipo de preço REGULAR (os FREE_* não são). */
export const ehCobrada = (tipo: unknown): boolean => String(tipo ?? '').toUpperCase() === 'REGULAR';

/** Só os dígitos de um número de telefone. */
export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D+/g, '');

// ───────────────────────────── o que a Meta devolve ─────────────────────────────

export interface PontoDoPreco {
  inicio: number; // segundos (UNIX)
  fim: number;
  numero: string;
  categoria: string;
  tipo: string;
  mensagens: number;
  custo: number;
}

const numeroOuZero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Os pontos de `pricing_analytics` (`{ pricing_analytics: { data: [{ data_points: [...] }] } }`, a forma documentada pela
 * Meta). O número vem na dimensão PHONE (`phone_number`); categoria e tipo em maiúsculas; volume e custo que não são
 * número viram 0. Ponto sem início ou fim fica de fora (não há dia onde pô-lo).
 */
export function pontosDoPreco(json: any): PontoDoPreco[] {
  const blocos = json?.pricing_analytics?.data;
  if (!Array.isArray(blocos)) return [];
  const saida: PontoDoPreco[] = [];
  for (const b of blocos) {
    for (const p of Array.isArray(b?.data_points) ? b.data_points : []) {
      const inicio = Number(p?.start);
      const fim = Number(p?.end);
      if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) continue;
      saida.push({
        inicio,
        fim,
        numero: soDigitos(p?.phone_number ?? p?.phone ?? ''),
        categoria: String(p?.pricing_category ?? '').toUpperCase() || 'DESCONHECIDA',
        tipo: String(p?.pricing_type ?? '').toUpperCase() || 'DESCONHECIDO',
        mensagens: Math.round(numeroOuZero(p?.volume)),
        custo: numeroOuZero(p?.cost),
      });
    }
  }
  return saida;
}

export interface PontoDoModelo {
  inicio: number;
  fim: number;
  modeloId: string;
  mensagens: number; // entregues
  custo: number;
}

/** Os pontos de `template_analytics` (`{ data: [{ data_points: [{ template_id, start, end, delivered, cost: [...] }] }] }`). */
export function pontosDoModelo(json: any): PontoDoModelo[] {
  const saida: PontoDoModelo[] = [];
  for (const b of Array.isArray(json?.data) ? json.data : []) {
    for (const p of Array.isArray(b?.data_points) ? b.data_points : []) {
      const inicio = Number(p?.start);
      const fim = Number(p?.end);
      const modeloId = String(p?.template_id ?? '').trim();
      if (!modeloId || !Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) continue;
      let custo = 0;
      for (const c of Array.isArray(p?.cost) ? p.cost : []) if (c?.type === 'amount_spent') custo += numeroOuZero(c?.value);
      saida.push({ inicio, fim, modeloId, mensagens: Math.round(numeroOuZero(p?.delivered)), custo });
    }
  }
  return saida;
}

/** A meia-noite de `iso` no fuso da loja, em segundos UNIX — pelo deslocamento do fuso naquele dia (sem supor −3). */
export function inicioDoDiaEmSegundos(iso: string, fuso = FUSO_OPERACAO): number {
  const meioDia = Date.parse(`${iso}T12:00:00Z`);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(meioDia))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const deslocamento = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - meioDia; // −3 h em São Paulo
  return Math.floor((Date.parse(`${iso}T00:00:00Z`) - deslocamento) / 1000);
}

/** O dia, no fuso da loja, de um intervalo da Meta: pelo MEIO do intervalo (meia hora cai no dia em que está; o ponto
 *  diário da Meta — em UTC — cai no próprio dia, porque o meio dele, 12h UTC, é 09h aqui). */
export function diaDoIntervalo(inicio: number, fim: number, fuso = FUSO_OPERACAO): string {
  return new Date(((inicio + fim) / 2) * 1000).toLocaleDateString('en-CA', { timeZone: fuso });
}

export interface LinhaDoGasto {
  numero: string;
  dia: string;
  categoria: string;
  tipo: string;
  mensagens: number;
  custo: number;
}

/** Soma os pontos por número, dia (no fuso da loja), categoria e tipo — uma linha por chave da tabela. */
export function linhasPorDia(pontos: PontoDoPreco[], fuso = FUSO_OPERACAO): LinhaDoGasto[] {
  const m = new Map<string, LinhaDoGasto>();
  for (const p of pontos) {
    const dia = diaDoIntervalo(p.inicio, p.fim, fuso);
    const k = `${p.numero}|${dia}|${p.categoria}|${p.tipo}`;
    const l = m.get(k) ?? { numero: p.numero, dia, categoria: p.categoria, tipo: p.tipo, mensagens: 0, custo: 0 };
    l.mensagens += p.mensagens;
    l.custo += p.custo;
    m.set(k, l);
  }
  return [...m.values()].map((l) => ({ ...l, custo: arredondar4(l.custo) }));
}

export interface LinhaDoModelo {
  dia: string;
  modeloId: string;
  mensagens: number;
  custo: number;
}

/** Soma os pontos dos modelos por dia (no fuso da loja) e modelo. */
export function linhasDeModeloPorDia(pontos: PontoDoModelo[], fuso = FUSO_OPERACAO): LinhaDoModelo[] {
  const m = new Map<string, LinhaDoModelo>();
  for (const p of pontos) {
    const dia = diaDoIntervalo(p.inicio, p.fim, fuso);
    const k = `${dia}|${p.modeloId}`;
    const l = m.get(k) ?? { dia, modeloId: p.modeloId, mensagens: 0, custo: 0 };
    l.mensagens += p.mensagens;
    l.custo += p.custo;
    m.set(k, l);
  }
  return [...m.values()].map((l) => ({ ...l, custo: arredondar4(l.custo) }));
}

export const arredondar4 = (n: number): number => Math.round(n * 10000) / 10000;
export const arredondar2 = (n: number): number => Math.round(n * 100) / 100;

/** A mensagem de erro da Meta, curta e sem nada que identifique o token (o `fbtrace_id` fica de fora). */
export function erroDaMeta(status: number, json: any): string {
  const e = json?.error;
  const msg = String(e?.error_user_msg || e?.message || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const cod = e?.code ? ` (código ${e.code}${e?.error_subcode ? `/${e.error_subcode}` : ''})` : '';
  return msg ? `A Meta respondeu ${status}: ${msg}${cod}` : `A Meta respondeu ${status}${cod}`;
}

// ───────────────────────────── o período da tela ─────────────────────────────

export type TipoDePeriodo = 'mes' | 'passado' | 'tres' | 'outro';
export interface Periodo {
  tipo: TipoDePeriodo;
  de: string;
  ate: string;
  /** É o mês corrente (a projeção só vale nele). */
  mesCorrente: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// `somarDias(s, 0)` remonta a data pelos campos: 2026-02-30 vira 2026-03-02 (ou NaN) e não confere.
const dataValida = (s: string): boolean => ISO.test(s) && somarDias(s, 0) === s;

export const primeiroDoMes = (iso: string): string => `${iso.slice(0, 7)}-01`;
/** O último dia do mês de `iso`. */
export function ultimoDoMes(iso: string): string {
  const [a, m] = iso.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  return somarDias(prox, -1);
}
/** O primeiro dia do mês `n` meses antes do mês de `iso`. */
export function mesesAntes(iso: string, n: number): string {
  const [a, m] = iso.split('-').map(Number);
  const total = a * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** O período pedido pela tela, conferido. `hoje` é a data da loja. Sem `periodo`, o mês corrente. */
export function periodoDaConsulta(q: { periodo?: unknown; de?: unknown; ate?: unknown }, hoje: string): Periodo {
  const tipo = String(q?.periodo ?? 'mes') as TipoDePeriodo;
  if (tipo === 'mes') return { tipo, de: primeiroDoMes(hoje), ate: hoje, mesCorrente: true };
  if (tipo === 'passado') {
    const de = mesesAntes(hoje, 1);
    return { tipo, de, ate: ultimoDoMes(de), mesCorrente: false };
  }
  if (tipo === 'tres') return { tipo, de: mesesAntes(hoje, 2), ate: hoje, mesCorrente: false };
  if (tipo !== 'outro') throw new BadRequestException('Período desconhecido.');
  const de = String(q?.de ?? '');
  const ate = String(q?.ate ?? '');
  if (!dataValida(de) || !dataValida(ate)) throw new BadRequestException('Escolha as duas datas do período.');
  if (de > ate) throw new BadRequestException('A data inicial vem depois da final.');
  if (ate > hoje) throw new BadRequestException('O período vai até hoje.');
  if (de < somarDias(hoje, -DIAS_MAX_DO_PERIODO)) throw new BadRequestException('A Meta guarda o gasto de até 12 meses.');
  return { tipo, de, ate, mesCorrente: de === primeiroDoMes(hoje) && ate === hoje };
}

/** Os dias de `de` a `ate`, inclusive. */
export function diasEntre(de: string, ate: string): string[] {
  const saida: string[] = [];
  for (let d = de; d <= ate && saida.length <= DIAS_MAX_DO_PERIODO; d = somarDias(d, 1)) saida.push(d);
  return saida;
}

// ───────────────────────────── a projeção ─────────────────────────────

/**
 * Quanto o mês fecha, no ritmo de até agora: o gasto ÷ os dias decorridos (com a fração do dia de hoje) × os dias do mês.
 * Antes de completar um dia não há ritmo: null. `agora` decide o dia e a hora no fuso da loja.
 */
export function projecaoDoMes(gastoAteAgora: number, agora: Date, fuso = FUSO_OPERACAO): number | null {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hoje = `${partes.year}-${partes.month}-${partes.day}`;
  const decorridos = Number(partes.day) - 1 + (Number(partes.hour) * 60 + Number(partes.minute)) / 1440;
  if (decorridos < 1) return null;
  const diasDoMes = Number(ultimoDoMes(hoje).slice(8, 10));
  return arredondar2((gastoAteAgora / decorridos) * diasDoMes);
}

// ───────────────────────────── o resumo da tela ─────────────────────────────

export interface LinhaSomada {
  numero: string;
  dia: string;
  categoria: string;
  tipo: string;
  mensagens: number;
  custo: number;
}

export interface ResumoDoTipo {
  grupo: Grupo;
  mensagens: number;
  cobradas: number;
  gratis: number;
  custo: number;
}

/** Os totais, por tipo (na ordem da tela; "outros" só se houver) e por dia (todos os dias do período, até os sem gasto). */
export function resumoDasLinhas(linhas: LinhaSomada[], periodo: Periodo) {
  const porGrupo = new Map<Grupo, ResumoDoTipo>(GRUPOS.map((g) => [g, { grupo: g, mensagens: 0, cobradas: 0, gratis: 0, custo: 0 }]));
  const porDia = new Map<string, { custo: number; marketing: number }>();
  let custo = 0;
  let mensagens = 0;
  let cobradas = 0;
  for (const l of linhas) {
    const g = porGrupo.get(grupoDaCategoria(l.categoria))!;
    const n = Number(l.mensagens) || 0;
    const c = Number(l.custo) || 0;
    g.mensagens += n;
    g.custo += c;
    if (ehCobrada(l.tipo)) g.cobradas += n;
    else g.gratis += n;
    mensagens += n;
    custo += c;
    if (ehCobrada(l.tipo)) cobradas += n;
    const d = porDia.get(l.dia) ?? { custo: 0, marketing: 0 };
    d.custo += c;
    if (grupoDaCategoria(l.categoria) === 'marketing') d.marketing += c;
    porDia.set(l.dia, d);
  }
  const tipos = [...porGrupo.values()]
    .filter((t) => t.grupo !== 'outros' || t.mensagens > 0)
    .map((t) => ({ ...t, custo: arredondar2(t.custo) }));
  const dias = diasEntre(periodo.de, periodo.ate).map((dia) => {
    const d = porDia.get(dia);
    return { dia, custo: arredondar2(d?.custo ?? 0), marketing: arredondar2(d?.marketing ?? 0) };
  });
  return { total: { custo: arredondar2(custo), mensagens, cobradas }, tipos, dias };
}

/** O uso da franquia do atendimento no mês, por número (as mensagens de atendimento ENTREGUES, cobradas ou não). */
export function franquiaPorNumero(linhasDoMes: LinhaSomada[]): { numero: string; usadas: number; limite: number }[] {
  const m = new Map<string, number>();
  for (const l of linhasDoMes) if (grupoDaCategoria(l.categoria) === 'atendimento') m.set(l.numero, (m.get(l.numero) ?? 0) + (Number(l.mensagens) || 0));
  return [...m.entries()].map(([numero, usadas]) => ({ numero, usadas, limite: FRANQUIA_DO_ATENDIMENTO })).sort((a, b) => b.usadas - a.usadas);
}

/** "pedido_saiu_para_entrega" → "Pedido saiu para entrega". */
export function nomeDoModelo(tecnico: unknown): string {
  const s = String(tecnico ?? '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Modelo sem nome';
}

/** Os 8 últimos dígitos: o mesmo celular com e sem o 55, o DDD ou o nono dígito ("21 99999-2210" × "2199992210"). */
export const finalDoNumero = (v: unknown): string => soDigitos(v).slice(-8);

/** O papel do número (principal × marketing) pelo final dele: a Meta devolve só dígitos, o Regem guarda em outro formato. */
export function papelDoNumero(numero: string, numeros: { numero: string | null; papel: string }[]): string | null {
  const d = finalDoNumero(numero);
  if (d.length < 8) return null;
  return numeros.find((n) => finalDoNumero(n.numero) === d)?.papel ?? null;
}
