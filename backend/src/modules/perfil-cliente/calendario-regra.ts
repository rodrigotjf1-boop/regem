import { BadRequestException } from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CALENDÁRIO DA LOJA — A REGRA FIXA (F2 do docs/plano-perfil-cliente.md, §5.1 item 1). Tudo o que se calcula sem fonte
// de fora: feriados nacionais por lei, Páscoa e as datas móveis (Carnaval e Corpus Christi são PONTO FACULTATIVO, não
// feriado), datas comemorativas de regra fixa e o dinheiro no bolso. Datas como texto 'AAAA-MM-DD' (dia civil, sem fuso).
// Jogos, clima, séries e a curadoria (Bolsa Família, finais de TV, "dias" de comida) vêm do produto de eventos do Hub DMS
// (D12) — não daqui. Funções puras: testáveis sem banco.

export type GrupoDoEvento = 'feriado' | 'comemorativa' | 'dinheiro' | 'loja';
export type TipoDaRegra = 'feriado' | 'ponto_facultativo' | 'comemorativa' | 'dinheiro';
export type EventoDaRegra = {
  /** Chave estável (o mesmo evento no mesmo ano dá sempre a mesma chave). */
  chave: string;
  dia: string;
  tipo: TipoDaRegra;
  grupo: GrupoDoEvento;
  nome: string;
  /** De onde vem a data: a lei, ou "costume" quando não há lei. */
  fonte: string;
  confianca: 'lei' | 'costume';
};

const DIA_MS = 86_400_000;
const dataUtc = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const somar = (d: Date, dias: number) => new Date(d.getTime() + dias * DIA_MS);
export const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** 'AAAA-MM-DD' válido (o dia existe no calendário). */
export function diaValido(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DIA.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const x = dataUtc(a, m, d);
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}
const deIso = (s: string) => {
  const [a, m, d] = s.split('-').map(Number);
  return dataUtc(a, m, d);
};
export const somarDias = (s: string, dias: number) => iso(somar(deIso(s), dias));
export const diasEntre = (de: string, ate: string) => Math.round((deIso(ate).getTime() - deIso(de).getTime()) / DIA_MS);
/** 0 = domingo … 6 = sábado. */
export const diaDaSemana = (s: string) => deIso(s).getUTCDay();

/** Domingo de Páscoa (algoritmo gregoriano de Meeus/Jones/Butcher). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(dataUtc(ano, mes, dia));
}

/** O n-ésimo `diaSemana` (0 = domingo) do mês. */
function enesimo(ano: number, mes: number, diaSemana: number, n: number): string {
  const primeiro = dataUtc(ano, mes, 1);
  const desloca = (diaSemana - primeiro.getUTCDay() + 7) % 7;
  return iso(somar(primeiro, desloca + (n - 1) * 7));
}

const LEI_662 = 'Lei 662/1949 (redação da Lei 10.607/2002)';

/** Feriados nacionais por lei, e a Sexta-feira da Paixão (feriado religioso que os municípios declaram — quase todos). */
export function feriadosNacionais(ano: number): EventoDaRegra[] {
  const p = deIso(pascoa(ano));
  const f = (mes: number, dia: number, id: string, nome: string, fonte = LEI_662): EventoDaRegra => ({
    chave: `regra:feriado:${id}:${ano}`,
    dia: iso(dataUtc(ano, mes, dia)),
    tipo: 'feriado',
    grupo: 'feriado',
    nome,
    fonte,
    confianca: 'lei',
  });
  return [
    f(1, 1, 'ano-novo', 'Confraternização Universal'),
    {
      chave: `regra:feriado:paixao:${ano}`,
      dia: iso(somar(p, -2)),
      tipo: 'feriado',
      grupo: 'feriado',
      nome: 'Sexta-feira da Paixão',
      fonte: 'Lei 9.093/1995 — feriado religioso declarado pelo município (quase todos declaram)',
      confianca: 'lei',
    },
    f(4, 21, 'tiradentes', 'Tiradentes'),
    f(5, 1, 'trabalho', 'Dia do Trabalho'),
    f(9, 7, 'independencia', 'Independência do Brasil'),
    f(10, 12, 'aparecida', 'Nossa Senhora Aparecida', 'Lei 6.802/1980'),
    f(11, 2, 'finados', 'Finados'),
    f(11, 15, 'republica', 'Proclamação da República'),
    f(11, 20, 'consciencia-negra', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei 14.759/2023'),
    f(12, 25, 'natal', 'Natal'),
  ];
}

function pontosFacultativos(ano: number): EventoDaRegra[] {
  const p = deIso(pascoa(ano));
  const fonte = 'ponto facultativo federal (portaria anual do Ministério da Gestão) — não é feriado nacional';
  const pf = (desloca: number, id: string, nome: string): EventoDaRegra => ({
    chave: `regra:ponto:${id}:${ano}`,
    dia: iso(somar(p, desloca)),
    tipo: 'ponto_facultativo',
    grupo: 'feriado',
    nome,
    fonte,
    confianca: 'lei',
  });
  return [
    pf(-48, 'carnaval-segunda', 'Carnaval (segunda-feira)'),
    pf(-47, 'carnaval-terca', 'Carnaval (terça-feira)'),
    pf(-46, 'cinzas', 'Quarta-feira de Cinzas (até as 14h)'),
    pf(60, 'corpus-christi', 'Corpus Christi'),
  ];
}

function comemorativas(ano: number): EventoDaRegra[] {
  const c = (dia: string, id: string, nome: string, fonte: string, confianca: 'lei' | 'costume'): EventoDaRegra => ({
    chave: `regra:comemorativa:${id}:${ano}`,
    dia,
    tipo: 'comemorativa',
    grupo: 'comemorativa',
    nome,
    fonte,
    confianca,
  });
  const quartaQuinta = enesimo(ano, 11, 4, 4);
  return [
    c(enesimo(ano, 5, 0, 2), 'maes', 'Dia das Mães', 'Decreto 21.366/1932 — 2º domingo de maio', 'lei'),
    c(iso(dataUtc(ano, 6, 12)), 'namorados', 'Dia dos Namorados', 'costume do comércio (12/06), não é lei', 'costume'),
    c(enesimo(ano, 8, 0, 2), 'pais', 'Dia dos Pais', 'costume do comércio (2º domingo de agosto), não é lei', 'costume'),
    c(iso(dataUtc(ano, 10, 12)), 'criancas', 'Dia das Crianças', 'Decreto 4.867/1924', 'lei'),
    c(somarDias(quartaQuinta, 1), 'black-friday', 'Black Friday', 'costume do comércio (a sexta depois da 4ª quinta de novembro)', 'costume'),
    c(iso(dataUtc(ano, 12, 24)), 'vespera-natal', 'Véspera de Natal', 'data fixa (24/12)', 'costume'),
    c(iso(dataUtc(ano, 12, 31)), 'reveillon', 'Véspera de Ano-Novo', 'data fixa (31/12)', 'costume'),
  ];
}

/**
 * O 5º dia útil do mês para o salário (CLT art. 459 §1º): o sábado CONTA como dia útil (Instrução Normativa SRT 1/1989);
 * domingos e feriados não. Usa os feriados nacionais e a Sexta-feira da Paixão — o feriado municipal pode adiar um dia.
 */
export function quintoDiaUtil(ano: number, mes: number): string {
  const feriados = new Set(feriadosNacionais(ano).map((f) => f.dia));
  let d = dataUtc(ano, mes, 1);
  let conta = 0;
  for (;;) {
    const s = iso(d);
    if (d.getUTCDay() !== 0 && !feriados.has(s)) conta++;
    if (conta === 5) return s;
    d = somar(d, 1);
  }
}

function dinheiro(ano: number): EventoDaRegra[] {
  const out: EventoDaRegra[] = [];
  const mm = (m: number) => String(m).padStart(2, '0');
  for (let mes = 1; mes <= 12; mes++) {
    out.push({
      chave: `regra:dinheiro:salario:${ano}-${mm(mes)}`,
      dia: quintoDiaUtil(ano, mes),
      tipo: 'dinheiro',
      grupo: 'dinheiro',
      nome: 'Salário: 5º dia útil',
      fonte: 'CLT art. 459 §1º; o sábado conta (IN SRT 1/1989); feriado da cidade pode adiar um dia',
      confianca: 'lei',
    });
    out.push({
      chave: `regra:dinheiro:vale:${ano}-${mm(mes)}`,
      dia: iso(dataUtc(ano, mes, 20)),
      tipo: 'dinheiro',
      grupo: 'dinheiro',
      nome: 'Vale (adiantamento) do dia 20',
      fonte: 'costume de muitas empresas, não é lei',
      confianca: 'costume',
    });
  }
  out.push({
    chave: `regra:dinheiro:13-primeira:${ano}`,
    dia: iso(dataUtc(ano, 11, 30)),
    tipo: 'dinheiro',
    grupo: 'dinheiro',
    nome: '13º salário — prazo da 1ª parcela',
    fonte: 'Lei 4.749/1965, art. 2º (até 30/11)',
    confianca: 'lei',
  });
  out.push({
    chave: `regra:dinheiro:13-segunda:${ano}`,
    dia: iso(dataUtc(ano, 12, 20)),
    tipo: 'dinheiro',
    grupo: 'dinheiro',
    nome: '13º salário — prazo da 2ª parcela',
    fonte: 'Lei 4.749/1965, art. 1º (até 20/12)',
    confianca: 'lei',
  });
  return out;
}

const ORDEM: Record<TipoDaRegra, number> = { feriado: 0, ponto_facultativo: 1, comemorativa: 2, dinheiro: 3 };

/** Os eventos da regra fixa entre `de` e `ate` (inclusive), em ordem de dia. */
export function eventosDaRegra(de: string, ate: string): EventoDaRegra[] {
  const a0 = Number(de.slice(0, 4));
  const a1 = Number(ate.slice(0, 4));
  const todos: EventoDaRegra[] = [];
  for (let ano = a0; ano <= a1; ano++) todos.push(...feriadosNacionais(ano), ...pontosFacultativos(ano), ...comemorativas(ano), ...dinheiro(ano));
  return todos
    .filter((e) => e.dia >= de && e.dia <= ate)
    .sort((x, y) => (x.dia < y.dia ? -1 : x.dia > y.dia ? 1 : ORDEM[x.tipo] - ORDEM[y.tipo]));
}

// ── os eventos que a LOJA cadastra (evento_loja) ─────────────────────────────────────────────────────────────────────────

export const TIPOS_DA_LOJA = ['show', 'promocao', 'feriado_municipal', 'jogo_time', 'outro'] as const;
export const NOME_DO_TIPO: Record<(typeof TIPOS_DA_LOJA)[number], string> = {
  show: 'Show ou festa na cidade',
  promocao: 'Promoção da casa',
  feriado_municipal: 'Feriado municipal',
  jogo_time: 'Jogo do time da região',
  outro: 'Outro',
};
export const REPETE = ['nao', 'semana', 'ano'] as const;

/** Os dias em que um evento cai entre `de` e `ate`: uma vez, toda semana (desde o dia) ou todo ano (no mesmo dia e mês). */
export function ocorrencias(dia: string, repete: string, de: string, ate: string): string[] {
  if (repete === 'semana') {
    const inicio = dia > de ? dia : somarDias(de, (diaDaSemana(dia) - diaDaSemana(de) + 7) % 7);
    const out: string[] = [];
    for (let d = inicio; d <= ate; d = somarDias(d, 7)) out.push(d);
    return out;
  }
  if (repete === 'ano') {
    const out: string[] = [];
    const md = dia.slice(5);
    for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++) {
      const d = `${ano}-${md}`;
      // 29/02 só nos anos bissextos.
      if (diaValido(d) && d >= dia && d >= de && d <= ate) out.push(d);
    }
    return out;
  }
  return dia >= de && dia <= ate ? [dia] : [];
}

export type EventoDaLojaLido = { nome: string; tipo: string; dia: string; hora: string | null; repete: string };

/** Lê e confere o corpo do "Evento da loja" (criar e editar mandam o evento inteiro). */
export function lerEventoDaLoja(dto: any): EventoDaLojaLido {
  const nome = typeof dto?.nome === 'string' ? dto.nome.replace(/\s+/g, ' ').trim() : '';
  if (nome.length < 2 || nome.length > 80) throw new BadRequestException('Dê um nome ao evento (de 2 a 80 letras).');
  const tipo = String(dto?.tipo ?? '');
  if (!(TIPOS_DA_LOJA as readonly string[]).includes(tipo)) throw new BadRequestException('Escolha o tipo do evento.');
  if (!diaValido(dto?.dia)) throw new BadRequestException('Escolha o dia do evento.');
  let hora: string | null = null;
  if (dto?.hora !== undefined && dto?.hora !== null && dto?.hora !== '') {
    if (typeof dto.hora !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.hora)) throw new BadRequestException('Hora inválida (use HH:MM).');
    hora = dto.hora;
  }
  const repete = String(dto?.repete ?? 'nao');
  if (!(REPETE as readonly string[]).includes(repete)) throw new BadRequestException('Escolha se o evento repete.');
  return { nome, tipo, dia: dto.dia, hora, repete };
}
