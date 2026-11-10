import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { dataNoFuso, horaNoFuso, somarDias, FUSO_OPERACAO } from './data';

// A PAUSA DOS PEDIDOS POR CANAL (mig 392; pedido do dono de 10/11/2026, protótipo `mockups/regem-pausa.html`).
//
// Cada canal tem a sua pausa, separada: o cardápio digital (o site e o atendente no WhatsApp, Instagram e Messenger), o
// iFood e a 99. Uma linha por empresa, loja e canal (`pausa_canal`); pausado = `ate` no futuro. Este arquivo é a regra
// ÚNICA: o painel, o cardápio online, o pedido e o atendente leem a pausa por aqui (V74 — a mesma conta dos dois lados).

export const CANAIS_DA_PAUSA = ['cardapio', 'ifood', 'food99'] as const;
export type CanalDaPausa = (typeof CANAIS_DA_PAUSA)[number];
export const NOME_DO_CANAL: Record<CanalDaPausa, string> = { cardapio: 'Cardápio digital', ifood: 'iFood', food99: '99' };
export const ehCanalDaPausa = (c: unknown): c is CanalDaPausa => CANAIS_DA_PAUSA.includes(c as CanalDaPausa);

export const MOTIVOS = ['pedidos', 'entregador', 'ingrediente', 'cozinha', 'energia', 'fechando', 'outro'] as const;
export type MotivoDaPausa = (typeof MOTIVOS)[number];

/**
 * Os motivos prontos. `frase` é o que o cliente lê, com o destaque do WhatsApp (`*…*`); `codigo99` é o código oficial do
 * motivo na 99 (`pause_reason_code`: 1001 equipamento ou energia, 1002 falta de equipe, 1003 falta de ingrediente, 1004
 * perto do fechamento, 1005 muitos pedidos no salão, 1006 outro) — o iFood recebe o próprio texto.
 */
export const MOTIVOS_DA_PAUSA: Record<MotivoDaPausa, { rotulo: string; frase: string | null; codigo99: number }> = {
  pedidos: { rotulo: 'Muitos pedidos agora', frase: 'Estamos com *muitos pedidos agora*', codigo99: 1005 },
  entregador: { rotulo: 'Falta de entregador', frase: 'Estamos *sem entregador no momento*', codigo99: 1002 },
  ingrediente: { rotulo: 'Falta de ingrediente', frase: '*Acabou um ingrediente* e estamos repondo', codigo99: 1003 },
  cozinha: { rotulo: 'Problema na cozinha', frase: 'Estamos com *um problema na cozinha*', codigo99: 1001 },
  energia: { rotulo: 'Sem energia ou internet', frase: 'Estamos *sem energia ou internet*', codigo99: 1001 },
  fechando: { rotulo: 'Perto de fechar', frase: 'Estamos *perto do horário de fechar*', codigo99: 1004 },
  outro: { rotulo: 'Outro motivo', frase: null, codigo99: 1006 },
};

export const MOTIVO_TEXTO_MAX = 80;
/** Os tempos prontos do cardápio digital (minutos); o outro jeito é "até HH:MM". */
export const TEMPOS_DO_CARDAPIO = [15, 30, 60] as const;
/** A pausa mais longa que se escolhe por "até HH:MM". */
export const PAUSA_MAX_HORAS = 12;

const limpo = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();
const maiuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** O texto do motivo (o pronto, ou o que o gestor escreveu). */
export function rotuloDoMotivo(motivo: string | null | undefined, texto?: string | null): string {
  if (motivo === 'outro') return maiuscula(limpo(texto)) || MOTIVOS_DA_PAUSA.outro.rotulo;
  return MOTIVOS_DA_PAUSA[motivo as MotivoDaPausa]?.rotulo ?? (maiuscula(limpo(texto)) || 'Pausa da loja');
}

/** A frase que o cliente lê ("Estamos com *muitos pedidos agora*"), com o destaque do WhatsApp. */
export function fraseDoMotivo(motivo: string | null | undefined, texto?: string | null): string {
  const pronta = MOTIVOS_DA_PAUSA[motivo as MotivoDaPausa]?.frase;
  if (pronta) return pronta;
  const t = maiuscula(limpo(texto).replace(/\*/g, ''));
  return t ? `*${t}*` : 'Pausamos *por alguns minutos*';
}

/** Confere o motivo que a tela mandou. "Outro" exige o texto (até 80 letras). */
export function lerMotivo(
  motivo: unknown,
  texto: unknown,
): { ok: true; motivo: MotivoDaPausa; motivoTexto: string | null } | { ok: false; erro: string } {
  if (!MOTIVOS.includes(motivo as MotivoDaPausa)) return { ok: false, erro: 'Escolha o motivo da pausa.' };
  if (motivo !== 'outro') return { ok: true, motivo: motivo as MotivoDaPausa, motivoTexto: null };
  const t = limpo(texto);
  if (!t) return { ok: false, erro: 'Escreva o motivo da pausa.' };
  if (t.length > MOTIVO_TEXTO_MAX) return { ok: false, erro: `O motivo tem até ${MOTIVO_TEXTO_MAX} letras.` };
  return { ok: true, motivo: 'outro', motivoTexto: t };
}

/** O instante de uma data (YYYY-MM-DD) e hora (HH:MM) no fuso da operação, sem depender do fuso do servidor. */
export function instanteNoFuso(dataISO: string, hhmm: string): Date {
  const chute = new Date(`${dataISO}T${hhmm}:00Z`);
  // A diferença entre o relógio de parede do fuso e o de UTC naquele instante é o deslocamento do fuso.
  const parede = (fuso: string) => new Date(chute.toLocaleString('en-US', { timeZone: fuso })).getTime();
  return new Date(chute.getTime() + (parede('UTC') - parede(FUSO_OPERACAO)));
}

/**
 * Até quando pausar o cardápio digital: um dos tempos prontos (15, 30 ou 60 min) ou "até HH:MM" — a próxima vez que o
 * relógio da loja marcar essa hora (passou de meia-noite, é amanhã), até 12 horas à frente.
 */
export function ateDoCardapio(tempo: { minutos?: unknown; ate?: unknown } | null | undefined, agora: Date = new Date()):
  { ok: true; ate: Date } | { ok: false; erro: string } {
  const min = Number(tempo?.minutos);
  if (tempo?.minutos != null && tempo?.minutos !== '') {
    if (!(TEMPOS_DO_CARDAPIO as readonly number[]).includes(min)) return { ok: false, erro: 'Escolha 15 min, 30 min, 1 hora ou "Até".' };
    return { ok: true, ate: new Date(agora.getTime() + min * 60_000) };
  }
  const hhmm = String(tempo?.ate ?? '');
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return { ok: false, erro: 'Escolha por quanto tempo pausar.' };
  const hoje = dataNoFuso(agora);
  let ate = instanteNoFuso(hoje, hhmm);
  if (ate.getTime() - agora.getTime() < 60_000) ate = instanteNoFuso(somarDias(hoje, 1), hhmm);
  if (ate.getTime() - agora.getTime() > PAUSA_MAX_HORAS * 3600_000)
    return { ok: false, erro: `Escolha um horário nas próximas ${PAUSA_MAX_HORAS} horas.` };
  return { ok: true, ate };
}

/** "às 21:40" ou "amanhã às 00:30" (no fuso da operação). */
export function voltaDaPausa(ate: Date, agora: Date = new Date()): { hora: string; amanha: boolean; texto: string } {
  const hora = horaNoFuso(ate);
  const amanha = dataNoFuso(ate) !== dataNoFuso(agora);
  return { hora, amanha, texto: amanha ? `amanhã às ${hora}` : `às ${hora}` };
}

/** A pausa de um canal como a API devolve (só quando vale AGORA). */
export type PausaVigente = {
  canal: CanalDaPausa;
  unidadeId: string | null;
  ate: string; // ISO
  motivo: string | null;
  motivoTexto: string | null;
  rotulo: string;
  frase: string;
  volta: { hora: string; amanha: boolean; texto: string };
  pausadoEm: string | null;
  pausadoPorNome: string | null;
};

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

/** A linha do banco vale como pausa agora? (o `ate` no futuro) */
export function linhaVigente(row: { ate?: unknown } | null | undefined, agora: Date = new Date()): boolean {
  return !!row?.ate && new Date(row.ate as any).getTime() > agora.getTime();
}

/** A linha (com os nomes do banco ou do Drizzle) como `PausaVigente`; null se não vale agora. */
export function pausaDaLinha(row: any, agora: Date = new Date()): PausaVigente | null {
  if (!row || !linhaVigente(row, agora)) return null;
  const ate = new Date(row.ate);
  const motivo = row.motivo ?? null;
  const texto = row.motivoTexto ?? row.motivo_texto ?? null;
  return {
    canal: row.canal,
    unidadeId: row.unidadeId ?? row.unidade_id ?? null,
    ate: ate.toISOString(),
    motivo,
    motivoTexto: texto,
    rotulo: rotuloDoMotivo(motivo, texto),
    frase: fraseDoMotivo(motivo, texto),
    volta: voltaDaPausa(ate, agora),
    pausadoEm: iso(row.pausadoEm ?? row.pausado_em),
    pausadoPorNome: row.pausadoPorNome ?? row.pausado_por_nome ?? null,
  };
}

const logger = new Logger('PausaDoCanal');
let avisouSemTabela = false;

/**
 * A pausa que vale AGORA para um canal de uma loja: a da própria loja ou a da empresa toda (`unidade_id` nulo — V4).
 * Com as duas, vale a que termina por último. Banco sem a 392 (servidor de loja ainda sem a atualização): sem pausa, com
 * aviso no log uma vez — o cardápio online não pode cair por isso.
 */
export async function pausaVigenteDoCanal(
  db: { execute: (q: any) => Promise<any> },
  tenantId: string,
  unidadeId: string | null | undefined,
  canal: CanalDaPausa,
  agora: Date = new Date(),
): Promise<PausaVigente | null> {
  try {
    const r: any = await db.execute(sql`
      select canal, unidade_id, ate, motivo, motivo_texto, pausado_em, pausado_por_nome
        from pausa_canal
       where tenant_id = ${tenantId}::uuid and canal = ${canal} and ate > ${agora.toISOString()}::timestamptz
         and (unidade_id is null or unidade_id = ${unidadeId ?? null}::uuid)
       order by ate desc
       limit 1`);
    return pausaDaLinha((r.rows ?? r)[0], agora);
  } catch (e: any) {
    if (e?.code === '42P01') {
      if (!avisouSemTabela) logger.warn('pausa_canal não existe neste banco (falta a migration 392): o canal segue aberto');
      avisouSemTabela = true;
      return null;
    }
    throw e;
  }
}

/**
 * O texto da recusa do pedido durante a pausa (o cardápio, o atendente e o servidor usam o MESMO): o motivo e a volta.
 * Sem o destaque do WhatsApp — sai em mensagem de erro e no aviso do cardápio.
 */
export function textoDaRecusa(p: Pick<PausaVigente, 'frase'> & { volta: Pick<PausaVigente['volta'], 'texto'> }): string {
  return `Pedidos pausados agora: ${p.frase.replace(/\*/g, '').replace(/^./, (c) => c.toLowerCase())}. Voltamos ${p.volta.texto}.`;
}
