import { BadRequestException } from '@nestjs/common';
import { exigirBooleano } from '../../common/exigir';
import { FUSO_OPERACAO } from '../../common/data';

// AS AUTOMÁTICAS DE MARKETING (Onda 3 · PR 2, mig 356; protótipo `mockups/regem-relacionamento.html`, vista
// "Automáticas", aprovado em 03/11/2026). Ajustes, horário do envio e textos — sem banco, testável.

/** "No máximo uma oferta por cliente a cada" (soma o aniversário, o "sentimos sua falta" e as campanhas). */
export const INTERVALOS_OFERTA = [3, 7, 15, 30] as const;
/** "Mensagens por dia, no máximo" (todas as automáticas juntas). */
export const MAX_POR_DIA = [10, 20, 30, 50, 100] as const;
/** "Horário do envio": só em dia que a loja abre, nunca antes das 9h nem depois das 21h. */
export const HORARIOS = ['antes_de_abrir', 'ao_abrir', '10:00', '15:00'] as const;
export type Horario = (typeof HORARIOS)[number];
/** Cashback vencendo: "avisar quantos dias antes" e "só se o saldo for de pelo menos" (R$). */
export const CASHBACK_DIAS_ANTES = [1, 2, 3, 5, 7] as const;
export const CASHBACK_SALDO_MIN = [1, 2, 5, 10] as const;
/** Aniversário (PR 3, mig 357): quando, o presente, o desconto, o pedido mínimo (R$) e a validade do cupom (dias). */
export const ANIV_QUANDO = ['no_dia', '3_antes', '7_antes'] as const;
export const ANIV_PRESENTE = ['cupom', 'nada'] as const;
export const ANIV_DESCONTO = ['v5', 'v10', 'v15', 'p10', 'p15', 'frete'] as const;
export const ANIV_MINIMO = [0, 30, 40, 60] as const;
export const ANIV_VALIDADE = [3, 7, 15] as const;
export type AnivQuando = (typeof ANIV_QUANDO)[number];
export type AnivPresente = (typeof ANIV_PRESENTE)[number];
export type AnivDesconto = (typeof ANIV_DESCONTO)[number];
/** Quantos dias antes do aniversário a mensagem sai. */
export const DIAS_ANTES_DO_ANIVERSARIO: Record<AnivQuando, number> = { no_dia: 0, '3_antes': 3, '7_antes': 7 };
/** Loja fechada no dia: a mensagem ainda sai até 3 dias depois (nunca duas no ano — a referência é o ano). */
export const ANIV_ATRASO_MAX = 3;

export const HORA_MIN = '09:00';
export const HORA_MAX = '21:00';

export type AjustesRelacionamento = {
  intervaloOfertasDias: number;
  maxPorDia: number;
  horario: Horario;
  cashbackAtivo: boolean;
  cashbackDiasAntes: number;
  cashbackSaldoMin: number;
  aniversarioAtivo: boolean;
  aniversarioQuando: AnivQuando;
  aniversarioPresente: AnivPresente;
  aniversarioDesconto: AnivDesconto;
  aniversarioMinimo: number;
  aniversarioValidadeDias: number;
};
/** Nasce DESLIGADO; o resto, como as decisões do dono de 03/11/2026 (aniversário: R$ 10 acima de R$ 40 por 7 dias). */
export const AJUSTES_PADRAO: AjustesRelacionamento = {
  intervaloOfertasDias: 7,
  maxPorDia: 30,
  horario: 'antes_de_abrir',
  cashbackAtivo: false,
  cashbackDiasAntes: 3,
  cashbackSaldoMin: 5,
  aniversarioAtivo: false,
  aniversarioQuando: 'no_dia',
  aniversarioPresente: 'cupom',
  aniversarioDesconto: 'v10',
  aniversarioMinimo: 40,
  aniversarioValidadeDias: 7,
};

/** O cupom de um desconto da lista: tipo e valor como o cadastro de cupons guarda. */
export function cupomDoDesconto(d: AnivDesconto): { tipo: 'valor' | 'percentual' | 'fretegratis'; valor: number } {
  if (d === 'frete') return { tipo: 'fretegratis', valor: 0 };
  if (d.startsWith('p')) return { tipo: 'percentual', valor: Number(d.slice(1)) };
  return { tipo: 'valor', valor: Number(d.slice(1)) };
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I (o cliente lê e digita)
/** Código do cupom pessoal: prefixo + 5 caracteres ("NIVER7K2QX"). */
export function codigoDoCupom(prefixo: string, sorteio: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i += 1) s += ALFABETO[Math.floor(sorteio() * ALFABETO.length) % ALFABETO.length];
  return `${prefixo}${s}`;
}

const umDe = (lista: readonly number[], v: unknown, msg: string): number => {
  const n = typeof v === 'number' ? v : NaN;
  if (!lista.includes(n)) throw new BadRequestException(msg);
  return n;
};

/**
 * O que a tela mandou, conferido (V16: ausente fica de fora; V15: liga/desliga só com booleano). Pura — a rota confere
 * ANTES de gravar.
 */
export function lerAjustes(dto: unknown): Partial<AjustesRelacionamento> {
  const d = (dto ?? {}) as Record<string, unknown>;
  const p: Partial<AjustesRelacionamento> = {};
  if (d.intervaloOfertasDias !== undefined)
    p.intervaloOfertasDias = umDe(INTERVALOS_OFERTA, d.intervaloOfertasDias, 'Uma oferta a cada: escolha 3, 7, 15 ou 30 dias.');
  if (d.maxPorDia !== undefined) p.maxPorDia = umDe(MAX_POR_DIA, d.maxPorDia, 'Mensagens por dia: escolha 10, 20, 30, 50 ou 100.');
  if (d.horario !== undefined) {
    if (typeof d.horario !== 'string' || !(HORARIOS as readonly string[]).includes(d.horario))
      throw new BadRequestException('Horário do envio: 1 h antes de abrir, na hora de abrir, às 10:00 ou às 15:00.');
    p.horario = d.horario as Horario;
  }
  if (d.cashbackAtivo !== undefined) p.cashbackAtivo = exigirBooleano(d.cashbackAtivo, 'cashbackAtivo');
  if (d.cashbackDiasAntes !== undefined)
    p.cashbackDiasAntes = umDe(CASHBACK_DIAS_ANTES, d.cashbackDiasAntes, 'Avisar o cashback: escolha 1, 2, 3, 5 ou 7 dias antes.');
  if (d.cashbackSaldoMin !== undefined)
    p.cashbackSaldoMin = umDe(CASHBACK_SALDO_MIN, d.cashbackSaldoMin, 'Saldo mínimo do aviso: escolha R$ 1, 2, 5 ou 10.');
  if (d.aniversarioAtivo !== undefined) p.aniversarioAtivo = exigirBooleano(d.aniversarioAtivo, 'aniversarioAtivo');
  const texto = <T extends string>(lista: readonly T[], v: unknown, msg: string): T => {
    if (typeof v !== 'string' || !(lista as readonly string[]).includes(v)) throw new BadRequestException(msg);
    return v as T;
  };
  if (d.aniversarioQuando !== undefined) p.aniversarioQuando = texto(ANIV_QUANDO, d.aniversarioQuando, 'Quando mandar os parabéns: no dia, 3 ou 7 dias antes.');
  if (d.aniversarioPresente !== undefined) p.aniversarioPresente = texto(ANIV_PRESENTE, d.aniversarioPresente, 'Presente: cupom de desconto ou só os parabéns.');
  if (d.aniversarioDesconto !== undefined)
    p.aniversarioDesconto = texto(ANIV_DESCONTO, d.aniversarioDesconto, 'Desconto: R$ 5, R$ 10, R$ 15, 10%, 15% ou entrega grátis.');
  if (d.aniversarioMinimo !== undefined)
    p.aniversarioMinimo = umDe(ANIV_MINIMO, d.aniversarioMinimo, 'Pedido mínimo: sem mínimo, R$ 30, R$ 40 ou R$ 60.');
  if (d.aniversarioValidadeDias !== undefined)
    p.aniversarioValidadeDias = umDe(ANIV_VALIDADE, d.aniversarioValidadeDias, 'O cupom vale por 3, 7 ou 15 dias.');
  return p;
}

/** A linha do banco como ajustes (sem linha: o padrão; valor torto: o padrão daquele campo). */
export function ajustesDaLinha(row: any): AjustesRelacionamento {
  if (!row) return { ...AJUSTES_PADRAO };
  const de = <T extends number>(lista: readonly T[], v: unknown, padrao: T): T =>
    (lista as readonly number[]).includes(Number(v)) ? (Number(v) as T) : padrao;
  const horario = String(row.horario ?? '');
  return {
    intervaloOfertasDias: de(INTERVALOS_OFERTA, row.intervalo_ofertas_dias, 7),
    maxPorDia: de(MAX_POR_DIA, row.max_por_dia, 30),
    horario: (HORARIOS as readonly string[]).includes(horario) ? (horario as Horario) : AJUSTES_PADRAO.horario,
    cashbackAtivo: row.cashback_ativo === true,
    cashbackDiasAntes: de(CASHBACK_DIAS_ANTES, row.cashback_dias_antes, 3),
    cashbackSaldoMin: de(CASHBACK_SALDO_MIN, row.cashback_saldo_min, 5),
    aniversarioAtivo: row.aniversario_ativo === true,
    aniversarioQuando: (ANIV_QUANDO as readonly string[]).includes(String(row.aniversario_quando)) ? (row.aniversario_quando as AnivQuando) : 'no_dia',
    aniversarioPresente: row.aniversario_presente === 'nada' ? 'nada' : 'cupom',
    aniversarioDesconto: (ANIV_DESCONTO as readonly string[]).includes(String(row.aniversario_desconto)) ? (row.aniversario_desconto as AnivDesconto) : 'v10',
    aniversarioMinimo: de(ANIV_MINIMO, row.aniversario_minimo, 40),
    aniversarioValidadeDias: de(ANIV_VALIDADE, row.aniversario_validade_dias, 7),
  };
}

// ===================== Horário do envio =====================

type Janela = { dia?: unknown; ativo?: unknown; abre?: unknown; fecha?: unknown };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const emMinutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const deMinutos = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * A primeira abertura do dia da semana (0 = domingo) entre os horários das lojas da empresa (`cardapio_config.horarios`
 * de cada uma). `null` = nenhuma loja abre nesse dia.
 */
export function aberturaDoDia(listas: (Janela[] | null | undefined)[], dia: number): string | null {
  let menor: string | null = null;
  for (const lista of listas) {
    for (const j of Array.isArray(lista) ? lista : []) {
      if (Number(j?.dia) !== dia || !j?.ativo) continue;
      const abre = String(j?.abre ?? '');
      if (!HHMM.test(abre) || !HHMM.test(String(j?.fecha ?? ''))) continue;
      if (menor === null || abre < menor) menor = abre;
    }
  }
  return menor;
}

/**
 * A hora (HH:MM, no fuso da operação) em que as automáticas saem no dia da semana `dia`, ou `null` se nenhuma loja abre
 * nesse dia. 1 h antes de abrir, na hora de abrir, às 10:00 ou às 15:00 — sempre entre 9h e 21h.
 */
export function horaDoEnvio(listas: (Janela[] | null | undefined)[], horario: Horario, dia: number): string | null {
  const abre = aberturaDoDia(listas, dia);
  if (!abre) return null;
  const m = horario === 'antes_de_abrir' ? emMinutos(abre) - 60 : horario === 'ao_abrir' ? emMinutos(abre) : emMinutos(horario);
  return deMinutos(Math.min(Math.max(m, emMinutos(HORA_MIN)), emMinutos(HORA_MAX)));
}

/** Dia da semana (0 = domingo) e hora (HH:MM) de um instante, no fuso da operação. */
export function agoraNaOperacao(d: Date = new Date()): { dia: number; hhmm: string } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_OPERACAO, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const hora = v('hour') === '24' ? '00' : v('hour');
  return { dia: dias.indexOf(v('weekday')), hhmm: `${hora}:${v('minute')}` };
}

/** Pode mandar agora? Dia em que a loja abre, depois da hora do envio e antes das 21h. */
export function podeMandarAgora(listas: (Janela[] | null | undefined)[], horario: Horario, agora: { dia: number; hhmm: string }): boolean {
  const h = horaDoEnvio(listas, horario, agora.dia);
  return !!h && agora.hhmm >= h && agora.hhmm < HORA_MAX;
}

// ===================== Textos =====================

/** R$ 12,40 */
export function reais(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

/** 06/11, no fuso da operação. */
export function dataCurta(d: Date | string): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACAO, day: '2-digit', month: '2-digit' });
}

export function primeiroNome(nome: unknown): string {
  const n = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

/** "Marina L." — a prévia da equipe mostra o mínimo do cliente. */
export function nomeCurto(nome: unknown): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Cliente sem nome';
  const primeiro = primeiroNome(partes[0]);
  return partes.length > 1 ? `${primeiro} ${partes[partes.length - 1].charAt(0).toUpperCase()}.` : primeiro;
}

/**
 * O aviso do cashback pelo QR (texto, sem modelo). O mesmo texto do modelo de utilidade `cashback_vencendo` da API
 * oficial: saldo, data e como usar — sem convite para comprar (é o que a Meta aceita como utilidade).
 */
export function textoCashbackQr(p: { nome?: string | null; valor: number; loja: string; vence: Date | string; link: string }): string {
  const nome = primeiroNome(p.nome);
  return [
    `Oi${nome ? `, ${nome}` : ''}! Seu cashback de ${reais(p.valor)} na ${p.loja} vence em ${dataCurta(p.vence)}. Ele é descontado no seu próximo pedido pelo cardápio ou pelo WhatsApp.`,
    `Ver meu saldo: ${p.link}`,
    '',
    'Para não receber estes avisos, responda SAIR.',
  ].join('\n');
}

/**
 * Os parabéns pelo QR (texto, sem modelo) — o mesmo texto dos modelos de marketing `aniversario_presente` /
 * `aniversario_parabens` da API oficial. Com presente: o desconto, até quando, o cupom e o link (que já aplica o cupom).
 */
export function textoAniversarioQr(p: { nome?: string | null; loja: string; link: string; presente?: { descricao: string; ate: string; cupom: string } | null }): string {
  const nome = primeiroNome(p.nome);
  const ola = `Parabéns${nome ? `, ${nome}` : ''}! 🎉`;
  const corpo = p.presente
    ? [
        `${ola} Para comemorar, a ${p.loja} te dá ${p.presente.descricao}, até ${dataCurta(`${p.presente.ate}T15:00:00Z`)}. O cupom já vem aplicado no seu carrinho.`,
        `Cupom: ${p.presente.cupom}`,
        `Peça agora: ${p.link}`,
      ]
    : [`${ola} A ${p.loja} deseja um feliz aniversário. Obrigado por pedir com a gente!`, `Peça agora: ${p.link}`];
  return [...corpo, '', 'Para sair das ofertas, responda SAIR.'].join('\n');
}
