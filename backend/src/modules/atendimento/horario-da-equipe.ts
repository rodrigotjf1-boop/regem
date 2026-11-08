import { BadRequestException, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { FUSO_OPERACAO } from '../../common/data';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O HORÁRIO DA EQUIPE (F1 do atendente virtual, mig 379 — pedido do dono, 07/11/2026: "o robô administra o atendimento; a
// mensagem só vai ao atendimento humano quando o robô não resolve; o atendimento humano só está disponível no horário em
// que a loja funciona — fora desse horário fica basicamente off"; protótipo `mockups/regem-central-atendimento.html`,
// versão 10). O robô atende 24 h (WhatsApp, Direct, chat do iFood e da 99); a PESSOA só entra no horário.
//
// Uma regra só, fora dos serviços — como `abrir-chamado.ts`: o WhatsApp, o Instagram e a ponte do chat importam daqui sem
// ciclo de módulo. Três partes:
//  • a CONTA (pura): as janelas da loja (o horário de Delivery › Configurações › Horários) com a folga do ajuste — "começa
//    a atender" antes de abrir e "para de atender" depois de fechar — dizem se a equipe está agora e quando volta;
//  • a LEITURA (banco): o ajuste da empresa (`robo_config`, só na nuvem) e o horário da loja (`cardapio_config`);
//  • o RECADO: fora do horário, o caso que o robô passaria para a equipe nasce com `detalhe.recado = { ate, em }` — nada
//    toca, o gerente não é avisado, a posição na fila não conta e o robô NÃO fica calado; no `ate` (a equipe começou) ele
//    vira um caso comum, pela ordem de chegada. Pedido em andamento conta como horário: o caso dele nunca vira recado.

const logger = new Logger('HorarioDaEquipe');

export type ModoDaEquipe = 'sempre' | 'loja';
/** "Começa a atender": quando a loja abre, 30 min ou 1 h antes. */
export const MINUTOS_ANTES_DA_EQUIPE = [0, 30, 60] as const;
/** "Para de atender": quando a loja fecha, 30 min, 1 h ou 2 h depois (as últimas entregas). */
export const MINUTOS_DEPOIS_DA_EQUIPE = [0, 30, 60, 120] as const;
/** O texto de "Fora do horário, o robô diz" cabe nisto (a regra da coluna, mig 379). */
export const TEXTO_FORA_MAX = 300;
/** O que o robô diz fora do horário quando a loja não escreveu o dela. `{volta}` = "hoje às 17:30"… */
export const FRASE_FORA_PADRAO = 'Nossa equipe volta {volta}. Já deixei o seu recado aqui e respondemos assim que começarmos.';
/** `{volta}` sem data (não acontece com uma janela cadastrada — é a rede de segurança): neutro, sem prometer hora. */
export const VOLTA_SEM_DATA = 'em breve';

export type AjusteDaEquipe = { atende: ModoDaEquipe; antesMin: number; depoisMin: number; textoFora: string | null };
/** Nasce em "Sempre (como hoje)": nada muda até a loja escolher "No horário da loja" (protótipo, cartão da versão 10). */
export const AJUSTE_DA_EQUIPE_PADRAO: AjusteDaEquipe = { atende: 'sempre', antesMin: 30, depoisMin: 60, textoFora: null };

// ───────────────────────── a conta (pura) ─────────────────────────

/** Uma janela do horário da loja: `{ dia 0–6 (0 = domingo), ativo, abre 'HH:MM', fecha 'HH:MM' }`. */
export type JanelaDaLoja = { dia?: unknown; ativo?: unknown; abre?: unknown; fecha?: unknown };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_MS = 60_000;
const DIA_MS = 86_400_000;

// As partes de um instante no fuso da operação. O deslocamento é calculado pela DATA (nada de −3 fixo): se o horário de
// verão voltar, a conta acompanha.
const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_OPERACAO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

type Partes = { ano: number; mes: number; dia: number; hora: number; min: number; seg: number };

function partesNoFuso(d: Date): Partes {
  const p: Record<string, string> = {};
  for (const x of formatador.formatToParts(d)) p[x.type] = x.value;
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, min: +p.minute, seg: +p.second };
}

/** Quanto o fuso da operação está à frente do UTC neste instante (São Paulo hoje: −3 h). */
function deslocamentoMs(d: Date): number {
  const p = partesNoFuso(d);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg) - Math.floor(d.getTime() / 1000) * 1000;
}

/** O instante (ms) de uma data e hora LOCAIS do fuso da operação. `dia` pode passar do fim do mês (o Date.UTC acerta). */
function instanteLocal(ano: number, mes: number, dia: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const comoUtc = Date.UTC(ano, mes - 1, dia, h, m);
  let t = comoUtc - deslocamentoMs(new Date(comoUtc));
  const ajustado = comoUtc - deslocamentoMs(new Date(t)); // perto da troca de fuso, a 2ª leitura corrige a 1ª
  if (ajustado !== t) t = ajustado;
  return t;
}

/** As janelas que valem: dia 0–6, ativa, abre e fecha em HH:MM. O resto (lixo do jsonb) fica de fora. */
export function janelasValidas(janelas: unknown): Array<{ dia: number; abre: string; fecha: string }> {
  if (!Array.isArray(janelas)) return [];
  const out: Array<{ dia: number; abre: string; fecha: string }> = [];
  for (const j of janelas as JanelaDaLoja[]) {
    const dia = Number(j?.dia);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6 || !j?.ativo) continue;
    if (typeof j.abre !== 'string' || typeof j.fecha !== 'string' || !HHMM.test(j.abre) || !HHMM.test(j.fecha)) continue;
    out.push({ dia, abre: j.abre, fecha: j.fecha });
  }
  return out;
}

/**
 * A equipe está AGORA? E, se não, quando volta? Janela da equipe = [abre − antes, fecha + depois]; a janela que fecha na
 * hora em que abre, ou antes (18:00–02:00), pertence ao dia em que ABRE e fecha no dia seguinte (a mesma regra do
 * cardápio). Ignora o interruptor manual "aberto" da loja: a equipe trabalha mesmo com a loja pausada. "Sempre", ou
 * nenhuma janela ativa cadastrada → sempre atendendo (como hoje). `voltaEm` = o começo da próxima janela (até 8 dias).
 */
export function situacaoPura(
  janelas: unknown,
  ajuste: Pick<AjusteDaEquipe, 'atende' | 'antesMin' | 'depoisMin'>,
  agora: Date = new Date(),
): { atendendo: boolean; voltaEm: Date | null } {
  if (ajuste.atende !== 'loja') return { atendendo: true, voltaEm: null };
  const validas = janelasValidas(janelas);
  if (!validas.length) return { atendendo: true, voltaEm: null };
  const t = agora.getTime();
  let voltaEm: number | null = null;
  for (const { inicio, fim } of janelasDaEquipe(validas, ajuste, agora)) {
    if (inicio <= t && t < fim) return { atendendo: true, voltaEm: null };
    if (inicio > t && (voltaEm === null || inicio < voltaEm)) voltaEm = inicio;
  }
  return { atendendo: false, voltaEm: voltaEm === null ? null : new Date(voltaEm) };
}

/**
 * As janelas da EQUIPE (instantes, ms) em volta de `agora`: cada janela da loja com a folga do ajuste — [abre − antes,
 * fecha + depois] —, de ontem (a janela que vira a meia-noite ainda pode valer) até daqui a 8 dias (a próxima de um dia da
 * semana só). A mesma conta para "a equipe está agora?" e para a volta do teste com "simular fora do horário".
 */
function* janelasDaEquipe(
  validas: Array<{ dia: number; abre: string; fecha: string }>,
  ajuste: Pick<AjusteDaEquipe, 'antesMin' | 'depoisMin'>,
  agora: Date,
): Generator<{ inicio: number; fim: number }> {
  const antes = Math.max(0, Number(ajuste.antesMin) || 0) * MIN_MS;
  const depois = Math.max(0, Number(ajuste.depoisMin) || 0) * MIN_MS;
  const hoje = partesNoFuso(agora);
  for (let k = -1; k <= 8; k++) {
    const data = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + k));
    const [ano, mes, dia, semana] = [data.getUTCFullYear(), data.getUTCMonth() + 1, data.getUTCDate(), data.getUTCDay()];
    for (const j of validas) {
      if (j.dia !== semana) continue;
      yield {
        inicio: instanteLocal(ano, mes, dia, j.abre) - antes,
        fim: instanteLocal(ano, mes, j.fecha <= j.abre ? dia + 1 : dia, j.fecha) + depois,
      };
    }
  }
}

/**
 * "Simular fora do horário" (teste do atendente, F4 — mig 382): quando a equipe VOLTARIA se não estivesse agora — o começo
 * da próxima janela da equipe que começa DEPOIS de agora (a de agora não conta), pelo horário da loja e a folga do ajuste,
 * mesmo com o ajuste em "Sempre" (o teste mostra o que a loja teria com "No horário da loja"). Sem janela cadastrada: null.
 */
export function proximaVoltaPura(janelas: unknown, ajuste: Pick<AjusteDaEquipe, 'antesMin' | 'depoisMin'>, agora: Date = new Date()): Date | null {
  const validas = janelasValidas(janelas);
  const t = agora.getTime();
  let voltaEm: number | null = null;
  for (const { inicio } of janelasDaEquipe(validas, ajuste, agora)) if (inicio > t && (voltaEm === null || inicio < voltaEm)) voltaEm = inicio;
  return voltaEm === null ? null : new Date(voltaEm);
}

const NO_DIA = ['no domingo', 'na segunda', 'na terça', 'na quarta', 'na quinta', 'na sexta', 'no sábado'];
const dois = (n: number) => String(n).padStart(2, '0');

/** Quando a equipe volta, como o cliente lê: "hoje às 17:30", "amanhã às 17:30", "na terça às 17:30", "no sábado às…". */
export function textoDaVolta(voltaEm: Date | null | undefined, agora: Date = new Date()): string {
  if (!voltaEm || Number.isNaN(voltaEm.getTime())) return VOLTA_SEM_DATA;
  const a = partesNoFuso(agora);
  const v = partesNoFuso(voltaEm);
  const dias = Math.round((Date.UTC(v.ano, v.mes - 1, v.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / DIA_MS);
  const hora = `${dois(v.hora)}:${dois(v.min)}`;
  if (dias <= 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã às ${hora}`;
  return `${NO_DIA[new Date(Date.UTC(v.ano, v.mes - 1, v.dia)).getUTCDay()]} às ${hora}`;
}

/** A frase de fora do horário: a da loja (ou a padrão), com `{volta}` trocado pelo dia e a hora em que a equipe volta. */
export function fraseForaDoHorario(textoDaLoja: string | null | undefined, voltaTexto: string): string {
  const base = typeof textoDaLoja === 'string' && textoDaLoja.trim() ? textoDaLoja.trim() : FRASE_FORA_PADRAO;
  return base.replace(/\{volta\}/g, () => voltaTexto);
}

// ───────────────────────── o ajuste (Configurações › Atendimento › "Horário da equipe") ─────────────────────────

/**
 * O que a tela mandou para "Horário da equipe", conferido (V16: ausente fica de fora; V15: cada escolha só entre as
 * opções). Pura — a rota confere ANTES de gravar qualquer grupo (V86). Texto vazio = volta ao padrão (null).
 */
export function lerAjusteDaEquipe(dto: unknown): Partial<AjusteDaEquipe> {
  const d = (dto ?? {}) as Record<string, unknown>;
  const parcial: Partial<AjusteDaEquipe> = {};
  if (d.atende !== undefined) {
    if (d.atende !== 'sempre' && d.atende !== 'loja')
      throw new BadRequestException('A equipe atende: escolha "Sempre" ou "No horário da loja".');
    parcial.atende = d.atende;
  }
  if (d.antesMin !== undefined) {
    if (typeof d.antesMin !== 'number' || !(MINUTOS_ANTES_DA_EQUIPE as readonly number[]).includes(d.antesMin))
      throw new BadRequestException('Começa a atender: escolha quando a loja abre, 30 min ou 1 h antes de abrir.');
    parcial.antesMin = d.antesMin;
  }
  if (d.depoisMin !== undefined) {
    if (typeof d.depoisMin !== 'number' || !(MINUTOS_DEPOIS_DA_EQUIPE as readonly number[]).includes(d.depoisMin))
      throw new BadRequestException('Para de atender: escolha quando a loja fecha, 30 min, 1 h ou 2 h depois de fechar.');
    parcial.depoisMin = d.depoisMin;
  }
  if (d.textoFora !== undefined) {
    if (d.textoFora !== null && typeof d.textoFora !== 'string')
      throw new BadRequestException('Fora do horário, o robô diz: escreva o texto (ou deixe vazio para usar o padrão).');
    const t = typeof d.textoFora === 'string' ? d.textoFora.trim() : '';
    if (t.length > TEXTO_FORA_MAX)
      throw new BadRequestException(`Fora do horário, o robô diz: no máximo ${TEXTO_FORA_MAX} letras.`);
    parcial.textoFora = t || null;
  }
  return parcial;
}

/** O ajuste de uma linha do banco (as colunas da 379 ou o `to_jsonb` delas), com os padrões no que faltar ou vier fora. */
export function ajusteDaLinha(l: { atende?: unknown; antesMin?: unknown; depoisMin?: unknown; textoFora?: unknown } | null | undefined): AjusteDaEquipe {
  // `Number(null)` e `Number('')` dão 0 — uma opção válida ("quando a loja abre"): vazio é "sem valor", não zero.
  const numero = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const antes = numero(l?.antesMin);
  const depois = numero(l?.depoisMin);
  const texto = typeof l?.textoFora === 'string' && l.textoFora.trim() ? l.textoFora.trim().slice(0, TEXTO_FORA_MAX) : null;
  return {
    atende: l?.atende === 'loja' ? 'loja' : 'sempre',
    antesMin: (MINUTOS_ANTES_DA_EQUIPE as readonly number[]).includes(antes) ? antes : AJUSTE_DA_EQUIPE_PADRAO.antesMin,
    depoisMin: (MINUTOS_DEPOIS_DA_EQUIPE as readonly number[]).includes(depois) ? depois : AJUSTE_DA_EQUIPE_PADRAO.depoisMin,
    textoFora: texto,
  };
}

// ───────────────────────── a leitura (banco) ─────────────────────────

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/**
 * O ajuste da empresa (`robo_config`, só na nuvem). Lido pelo `to_jsonb` da linha, nunca pelo nome da coluna: num banco
 * sem a 379 (ou sem a `robo_config`) a leitura não falha — e não derruba a TRANSAÇÃO de quem chama (o caso do Direct e o
 * da ponte nascem dentro de uma). Sem tabela ou sem linha: os padrões ("sempre").
 */
export async function ajusteDaEquipeDaEmpresa(db: any, tenantId: string): Promise<AjusteDaEquipe> {
  const [tem] = linhasDe(await db.execute(sql`select to_regclass(current_schema() || '.robo_config') is not null as tem`));
  if (!tem?.tem) return { ...AJUSTE_DA_EQUIPE_PADRAO };
  const [l] = linhasDe(
    await db.execute(sql`
      select to_jsonb(rc) ->> 'equipe_atende' as atende, to_jsonb(rc) ->> 'equipe_antes_min' as "antesMin",
             to_jsonb(rc) ->> 'equipe_depois_min' as "depoisMin", to_jsonb(rc) ->> 'equipe_fora_texto' as "textoFora"
        from robo_config rc where rc.tenant_id = ${tenantId}::uuid`),
  );
  return ajusteDaLinha(l);
}

type LinhaDoHorario = { id: string; unidadeId: string | null; horarios: unknown; horariosRetirada: unknown; horarioUnico: unknown };

/** As janelas de uma linha do cardápio: a entrega e, quando o horário NÃO é único, a retirada (a equipe atende os dois). */
const janelasDaLinha = (l: LinhaDoHorario): unknown[] => [
  ...(Array.isArray(l.horarios) ? l.horarios : []),
  ...(l.horarioUnico === false && Array.isArray(l.horariosRetirada) ? l.horariosRetirada : []),
];

/** Onde o caso nasceu: o cardápio (o do robô do Direct, o do WhatsApp) e/ou a loja. */
export type OndeDaEquipe = { unidadeId?: string | null; cardapioId?: string | null };

/**
 * As janelas que valem para `onde`: o cardápio informado; senão a linha da LOJA, com herança para a da empresa
 * (`unidade_id` nulo — a mesma herança de `chegada.service.ts`); sem nenhuma das duas, a UNIÃO de todas as linhas da
 * empresa (a equipe está lá se alguma loja está aberta).
 */
export function janelasDeOnde(linhas: LinhaDoHorario[], onde: OndeDaEquipe): unknown[] {
  const cardapio = uuidOuNulo(onde.cardapioId);
  const doCardapio = cardapio ? linhas.find((l) => l.id === cardapio) : undefined;
  if (doCardapio) return janelasDaLinha(doCardapio);
  const loja = uuidOuNulo(onde.unidadeId);
  const daLoja = loja ? linhas.find((l) => l.unidadeId === loja) : undefined;
  const daEmpresa = linhas.find((l) => l.unidadeId == null);
  const linha = daLoja ?? daEmpresa;
  if (linha) return janelasDaLinha(linha);
  return linhas.flatMap(janelasDaLinha);
}

async function linhasDoHorario(db: any, tenantId: string): Promise<LinhaDoHorario[]> {
  return linhasDe(
    await db.execute(sql`
      select id, unidade_id as "unidadeId", horarios, horarios_retirada as "horariosRetirada", horario_unico as "horarioUnico"
        from cardapio_config where tenant_id = ${tenantId}::uuid
       order by id limit 100`),
  ).map((l) => ({ ...l, id: String(l.id), unidadeId: l.unidadeId ? String(l.unidadeId) : null }));
}

export type SituacaoDaEquipe = {
  modo: ModoDaEquipe;
  atendendo: boolean;
  /** O começo da próxima janela da equipe (com a folga de "começa a atender"); null atendendo. */
  voltaEm: Date | null;
  /** "hoje às 17:30"…; null atendendo. */
  voltaTexto: string | null;
  /** O que o robô diz ao cliente fora do horário (a frase da loja com o `{volta}` trocado); null atendendo. */
  frase: string | null;
  /** O texto que a loja escreveu (null = o padrão) — para refazer a frase de um recado que já existe. */
  textoFora: string | null;
};

const ATENDENDO = (modo: ModoDaEquipe, textoFora: string | null = null): SituacaoDaEquipe => ({
  modo,
  atendendo: true,
  voltaEm: null,
  voltaTexto: null,
  frase: null,
  textoFora,
});

function situacaoComDados(ajuste: AjusteDaEquipe, linhas: LinhaDoHorario[], onde: OndeDaEquipe, agora: Date): SituacaoDaEquipe {
  if (ajuste.atende !== 'loja') return ATENDENDO('sempre', ajuste.textoFora);
  const s = situacaoPura(janelasDeOnde(linhas, onde), ajuste, agora);
  if (s.atendendo) return ATENDENDO('loja', ajuste.textoFora);
  const voltaTexto = textoDaVolta(s.voltaEm, agora);
  return { modo: 'loja', atendendo: false, voltaEm: s.voltaEm, voltaTexto, frase: fraseForaDoHorario(ajuste.textoFora, voltaTexto), textoFora: ajuste.textoFora };
}

/**
 * A equipe está agora para `onde`? No servidor da loja, sempre "sempre" (a `robo_config` não existe lá — V1). Falha de
 * leitura = atendendo (o comportamento de hoje), com o motivo no log — nunca rejeita.
 */
export async function situacaoDaEquipe(db: any, tenantId: string, onde: OndeDaEquipe = {}, agora: Date = new Date()): Promise<SituacaoDaEquipe> {
  if (ehServidorLocal() || !tenantId) return ATENDENDO('sempre');
  try {
    const ajuste = await ajusteDaEquipeDaEmpresa(db, tenantId);
    if (ajuste.atende !== 'loja') return ATENDENDO('sempre', ajuste.textoFora);
    return situacaoComDados(ajuste, await linhasDoHorario(db, tenantId), onde, agora);
  } catch (e: any) {
    logger.warn(`horário da equipe não lido (empresa ${tenantId}; vale "atendendo"): ${e?.message ?? e}`);
    return ATENDENDO('sempre');
  }
}

/**
 * A situação da equipe no TESTE DO ATENDENTE com "simular fora do horário" (F4, mig 382): como se a equipe NÃO estivesse
 * agora — a frase de fora do horário da loja (ou a padrão) e a volta = o começo da próxima janela da equipe depois de agora
 * (`proximaVoltaPura`). `modo` diz o ajuste de verdade ("Sempre" = na conversa real a equipe estaria). Só leitura; nunca
 * rejeita: falha de leitura = a volta "em breve", com o motivo no log.
 */
export async function situacaoForaDoHorario(db: any, tenantId: string, onde: OndeDaEquipe = {}, agora: Date = new Date()): Promise<SituacaoDaEquipe> {
  const sem = (modo: ModoDaEquipe, textoFora: string | null): SituacaoDaEquipe => ({
    modo,
    atendendo: false,
    voltaEm: null,
    voltaTexto: VOLTA_SEM_DATA,
    frase: fraseForaDoHorario(textoFora, VOLTA_SEM_DATA),
    textoFora,
  });
  if (!tenantId) return sem('sempre', null);
  try {
    const ajuste = await ajusteDaEquipeDaEmpresa(db, tenantId);
    const voltaEm = proximaVoltaPura(janelasDeOnde(await linhasDoHorario(db, tenantId), onde), ajuste, agora);
    if (!voltaEm) return sem(ajuste.atende, ajuste.textoFora);
    const voltaTexto = textoDaVolta(voltaEm, agora);
    return { modo: ajuste.atende, atendendo: false, voltaEm, voltaTexto, frase: fraseForaDoHorario(ajuste.textoFora, voltaTexto), textoFora: ajuste.textoFora };
  } catch (e: any) {
    logger.warn(`horário da equipe não lido no teste (empresa ${tenantId}; volta "em breve"): ${e?.message ?? e}`);
    return sem('sempre', null);
  }
}

/** A chave de uma loja no mapa de `situacoesPorLoja` (sem loja = ''). */
export const chaveDaLoja = (unidadeId: string | null | undefined) => unidadeId ?? '';

/** A situação de várias lojas de uma vez (o lote da ponte): uma leitura do ajuste e uma do horário. Nunca rejeita. */
export async function situacoesPorLoja(
  db: any,
  tenantId: string,
  unidades: Array<string | null | undefined>,
  agora: Date = new Date(),
): Promise<Map<string, SituacaoDaEquipe>> {
  const mapa = new Map<string, SituacaoDaEquipe>();
  const chaves = [...new Set(unidades.map(chaveDaLoja))];
  if (ehServidorLocal() || !tenantId) {
    for (const k of chaves) mapa.set(k, ATENDENDO('sempre'));
    return mapa;
  }
  try {
    const ajuste = await ajusteDaEquipeDaEmpresa(db, tenantId);
    const linhas = ajuste.atende === 'loja' ? await linhasDoHorario(db, tenantId) : [];
    for (const k of chaves) mapa.set(k, situacaoComDados(ajuste, linhas, { unidadeId: k || null }, agora));
  } catch (e: any) {
    logger.warn(`horário da equipe não lido (empresa ${tenantId}; vale "atendendo"): ${e?.message ?? e}`);
    for (const k of chaves) mapa.set(k, ATENDENDO('sempre'));
  }
  return mapa;
}

// ───────────────────────── o recado ─────────────────────────

/** A marca do recado em `atendimento_chamado.detalhe.recado`: até quando espera (a volta da equipe) e quando chegou. */
export type Recado = { ate: string; em: string };

/** O recado gravado no caso (mesmo depois do `ate` — a tela mostra o selo "Recado das 02:14"), ou null. */
export function lerRecado(detalhe: unknown): Recado | null {
  const r = (detalhe as any)?.recado;
  if (!r || typeof r !== 'object' || typeof r.ate !== 'string' || typeof r.em !== 'string') return null;
  if (Number.isNaN(new Date(r.ate).getTime()) || Number.isNaN(new Date(r.em).getTime())) return null;
  return { ate: r.ate, em: r.em };
}

/** O recado ainda espera a equipe (o `ate` não chegou). A MESMA regra de `recadoAtivoSql`. */
export function recadoAtivo(detalhe: unknown, agora: Date = new Date()): boolean {
  const r = lerRecado(detalhe);
  return !!r && new Date(r.ate).getTime() > agora.getTime();
}

const ALIAS = /^[a-z_][a-z0-9_]*$/i;
const ateDoRecado = (alias: string) => {
  if (!ALIAS.test(alias)) throw new Error(`apelido de tabela inválido: ${alias}`);
  const ate = `(${alias}.detalhe -> 'recado' ->> 'ate')`;
  // Só converte o que tem cara de data: um valor torto no jsonb não derruba a fila inteira.
  return `(case when ${ate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then ${ate}::timestamptz end)`;
};

/** SQL: o caso `alias` (de `atendimento_chamado`) tem recado ATIVO — `detalhe.recado.ate` ainda no futuro. */
export const recadoAtivoSql = (alias: string): SQL => sql.raw(`coalesce(${ateDoRecado(alias)} > now(), false)`);

/** SQL: desde quando o caso espera uma pessoa — o fim do recado (a volta da equipe) ou, sem recado, a criação. */
export const inicioDoCasoSql = (alias: string): SQL => sql.raw(`coalesce(${ateDoRecado(alias)}, ${alias}.criado_em)`);

/** Os pedidos que já acabaram: o caso de um pedido FORA desta lista está "em andamento" e nunca vira recado. */
export const STATUS_DO_PEDIDO_ENCERRADO = ['entregue', 'concluido', 'cancelado'] as const;

/** O pedido ainda está em andamento (a equipe ainda trabalha nele)? Falha de leitura = sim (o caso vai para a fila). */
export async function pedidoEmAndamento(db: any, tenantId: string, pedidoId: string | null | undefined): Promise<boolean> {
  const id = uuidOuNulo(pedidoId);
  if (!id) return false;
  try {
    const [l] = linhasDe(
      await db.execute(sql`
        select status from pedido_externo where tenant_id = ${tenantId}::uuid and id = ${id}::uuid`),
    );
    return !!l && !(STATUS_DO_PEDIDO_ENCERRADO as readonly string[]).includes(String(l.status));
  } catch (e: any) {
    logger.warn(`situação do pedido do caso não lida (vai para a fila): ${e?.message ?? e}`);
    return true;
  }
}

/**
 * O caso NOVO nasce como recado? Fora do horário da equipe e sem pedido em andamento → `{ recado, situacao }`; no horário
 * (ou sem saber quando a equipe volta) → null, e o caso vai para a fila como hoje.
 */
export async function recadoDoCasoNovo(
  db: any,
  tenantId: string,
  onde: OndeDaEquipe,
  pedidoId?: string | null,
  agora: Date = new Date(),
): Promise<{ recado: Recado; situacao: SituacaoDaEquipe } | null> {
  const situacao = await situacaoDaEquipe(db, tenantId, onde, agora);
  const recado = recadoDaSituacao(situacao, agora);
  if (!recado) return null;
  if (await pedidoEmAndamento(db, tenantId, pedidoId)) return null;
  return { recado, situacao };
}

/**
 * O recado que a situação da equipe dá a um caso novo SEM pedido: fora do horário e sabendo quando a equipe volta → o
 * recado até a volta; no horário (ou sem saber quando volta) → null, e o caso vai para a fila. A regra de
 * `recadoDoCasoNovo` (que confere antes o pedido em andamento) e a do teste do atendente (F4, que não tem pedido).
 */
export function recadoDaSituacao(situacao: SituacaoDaEquipe, agora: Date = new Date()): Recado | null {
  if (situacao.atendendo || !situacao.voltaEm) return null;
  return { ate: situacao.voltaEm.toISOString(), em: agora.toISOString() };
}

/** O que a resposta do "chamar atendente" leva fora do horário: o robô manda `paraOCliente` como veio, sem a posição. */
export type ForaDoHorario = { foraDoHorario: true; equipeVolta: string; paraOCliente: string; posicao: null };

/** A resposta de fora do horário para um recado (o novo, ou o que já esperava): a volta pelo `ate` dele. */
export function respostaDoRecado(recado: Recado, textoFora: string | null, agora: Date = new Date()): ForaDoHorario {
  const equipeVolta = textoDaVolta(new Date(recado.ate), agora);
  return { foraDoHorario: true, equipeVolta, paraOCliente: fraseForaDoHorario(textoFora, equipeVolta), posicao: null };
}
