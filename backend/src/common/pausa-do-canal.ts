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

// ── F2 (mig 393): o aviso antes de reabrir e o "estender" ──────────────────────────────────────────────────────────
/** Quantos minutos antes de reabrir o painel avisa (0 = não avisa). */
export const AVISO_MINUTOS = [0, 1, 3, 5, 10] as const;
export const SONS_DA_PAUSA = ['bipe', 'campainha'] as const;
export type SomDaPausa = (typeof SONS_DA_PAUSA)[number];
export type AvisoDaPausa = { minutos: number; som: SomDaPausa };
export const AVISO_PADRAO: AvisoDaPausa = { minutos: 5, som: 'bipe' };
/** Os botões "+10 min" e "+30 min" da faixa. */
export const MINUTOS_PARA_ESTENDER = [10, 30] as const;

/** O aviso gravado na linha do cardápio (o valor fora da lista vale o padrão — a linha pode vir de outra versão). */
export function avisoDaLinha(row: any): AvisoDaPausa {
  const min = Number(row?.pausa_aviso_min ?? row?.pausaAvisoMin);
  const som = row?.pausa_som ?? row?.pausaSom;
  return {
    minutos: (AVISO_MINUTOS as readonly number[]).includes(min) ? min : AVISO_PADRAO.minutos,
    som: (SONS_DA_PAUSA as readonly string[]).includes(som) ? (som as SomDaPausa) : AVISO_PADRAO.som,
  };
}

/** Confere o ajuste que a tela mandou: só os campos que vieram (V16); valor fora da lista é recusado. */
export function lerAjusteDaPausa(dto: unknown): { ok: true; parcial: Partial<AvisoDaPausa> } | { ok: false; erro: string } {
  const d = (dto ?? {}) as Record<string, unknown>;
  const parcial: Partial<AvisoDaPausa> = {};
  if (d.minutos !== undefined) {
    const n = Number(d.minutos);
    if (d.minutos === null || d.minutos === '' || !(AVISO_MINUTOS as readonly number[]).includes(n))
      return { ok: false, erro: 'Avisar antes de reabrir: escolha 1, 3, 5 ou 10 minutos, ou não avisar.' };
    parcial.minutos = n;
  }
  if (d.som !== undefined) {
    if (!(SONS_DA_PAUSA as readonly string[]).includes(d.som as string)) return { ok: false, erro: 'Som do aviso: escolha bipe ou campainha.' };
    parcial.som = d.som as SomDaPausa;
  }
  return { ok: true, parcial };
}

/**
 * O novo fim da pausa ao estender: o fim de agora + N minutos (10 ou 30), até 12 horas à frente. Sem pausa valendo, não
 * há o que estender (a faixa já sumiu ou outra pessoa reabriu).
 */
export function ateEstendido(ateAtual: Date | null, minutos: unknown, agora: Date = new Date()):
  { ok: true; ate: Date } | { ok: false; erro: string } {
  const n = Number(minutos);
  if (!(MINUTOS_PARA_ESTENDER as readonly number[]).includes(n)) return { ok: false, erro: 'Estenda por 10 ou 30 minutos.' };
  if (!ateAtual || ateAtual.getTime() <= agora.getTime()) return { ok: false, erro: 'Este canal já reabriu.' };
  const ate = new Date(ateAtual.getTime() + n * 60_000);
  if (ate.getTime() - agora.getTime() > 12 * 3600_000) return { ok: false, erro: 'A pausa vai até 12 horas à frente.' };
  return { ok: true, ate };
}

// ── F3 (migs 394 e 395): a mensagem pronta ao cliente ──────────────────────────────────────────────────────────────
/**
 * O texto padrão (o do protótipo aprovado). `{motivo}` é a FRASE do motivo ("Estamos com *muitos pedidos agora*" — cada
 * motivo pronto tem a sua), `{volta}` é "às *21:40*" ou "amanhã às *00:30*" e `{nome}` o primeiro nome do cliente (sem
 * nome, "Oi, {nome}!" vira "Oi!"). O destaque `*…*` é o negrito do WhatsApp; no Direct e no Messenger sai sem ele.
 */
export const MENSAGEM_DA_PAUSA_PADRAO = [
  '⏸️ *Pedidos pausados por alguns minutos*',
  '',
  'Oi, {nome}! {motivo} e pausamos os pedidos para não atrasar ninguém.',
  '',
  '🕒 Voltamos {volta}.',
  '',
  'Assim que reabrirmos, é só mandar o seu pedido por aqui. Obrigado pela paciência! 💛',
].join('\n');
export const MENSAGEM_DA_PAUSA_MAX = 700;
export const CAMPOS_DA_MENSAGEM = ['{nome}', '{motivo}', '{volta}'] as const;

/** O primeiro nome de quem escreve ("ANA PAULA" → "Ana"); nada que pareça nome (número, @, emoji) → vazio. */
export function primeiroNome(nome: unknown): string {
  const p = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^[\p{L}][\p{L}'’-]{1,29}$/u.test(p)) return '';
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}

/**
 * Monta a mensagem da pausa: o modelo da loja (ou o padrão) com o nome, a frase do motivo e a volta. `semDestaque` (Direct,
 * Messenger, a IA): sem os asteriscos. Linhas em branco seguidas viram uma só; as pontas sem espaço.
 */
export function montarMensagemDaPausa(
  modelo: string | null | undefined,
  d: { nome?: string | null; frase: string; volta: { hora: string; amanha: boolean } },
  opcoes: { semDestaque?: boolean } = {},
): string {
  const base = String(modelo ?? '').trim() || MENSAGEM_DA_PAUSA_PADRAO;
  const nome = primeiroNome(d.nome);
  const volta = `${d.volta.amanha ? 'amanhã ' : ''}às *${d.volta.hora}*`;
  // Sem nome: "Oi, {nome}!" → "Oi!" e "{nome}, tudo bem?" → "Tudo bem?" (some o nome e a vírgula que o acompanha).
  let t = nome
    ? base.replace(/\{nome\}/g, nome)
    : base
        .replace(/,\s*\{nome\}/g, '')
        .replace(/\{nome\}\s*,\s*(\p{L})/gu, (_m, l: string) => l.toLocaleUpperCase('pt-BR'))
        .replace(/\s*\{nome\}/g, '');
  t = t.replace(/\{motivo\}/g, d.frase).replace(/\{volta\}/g, volta);
  if (opcoes.semDestaque) t = t.replace(/\*/g, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Confere a mensagem que a tela mandou: vazia ou igual à padrão = o padrão (nulo); senão até 700 letras. */
export function lerMensagemDaPausa(v: unknown): { ok: true; mensagem: string | null } | { ok: false; erro: string } {
  if (v === null) return { ok: true, mensagem: null };
  if (typeof v !== 'string') return { ok: false, erro: 'Mensagem da pausa: escreva um texto.' };
  const t = v.replace(/\r\n/g, '\n').trim();
  if (!t || t === MENSAGEM_DA_PAUSA_PADRAO) return { ok: true, mensagem: null };
  if (t.length > MENSAGEM_DA_PAUSA_MAX) return { ok: false, erro: `A mensagem da pausa tem até ${MENSAGEM_DA_PAUSA_MAX} letras.` };
  return { ok: true, mensagem: t };
}

// ── F4 (mig 396): o áudio quando o cliente insiste ─────────────────────────────────────────────────────────────────
const semAcento = (t: unknown) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
/** Só concorda ("ok", "ah ok, às 21:40 eu peço então", "valeu") — sem "mas", "agora", "mesmo assim". */
const CONCORDA = /^(ok|okay|ah ok|ah,? ok|ta bom|ta|tudo bem|beleza|blz|certo|combinado|entendi|entendido|valeu|vlw|obrigad[oa]|brigad[oa]|tranquilo|de boa|show|perfeito|otimo|👍|🙏)\b/u;
const CONTRASTE = /\b(mas|porem|so que|nao da|mesmo assim|agora|urgente)\b/;
/** Insiste em pedir já ("mas não dá pra fazer agora? Pago no Pix", "quero um x-bacon", "aceita pix?"). */
const INSISTE =
  /\b(nao da|mesmo assim|agora|urgente|por favor|pfv|aceita|aceitam|pix|pago|pagar|quero|queria|pedir|pedido|manda|mandar|consegue|tem como|da pra|da para|preciso|faz|fazer|abre|abrir|ainda)\b/;
/** Não entendeu ("não entendi", "como assim?", "?"). */
const NAO_ENTENDEU = /\b(nao entendi|nao entendo|como assim|nao vi)\b|^\?+$|^(que|hein|oi)\?+$/;

/**
 * O cliente que JÁ recebeu a mensagem da pausa insistiu em pedir ou disse que não entendeu? Aí a resposta vai em áudio (F4).
 * Quem só concorda ("ah ok, às 21:40 eu peço então") recebe texto, como no protótipo. Na dúvida, texto.
 */
export function pedeOAudio(texto: unknown): boolean {
  const t = semAcento(texto);
  if (!t) return false;
  if (CONCORDA.test(t) && !CONTRASTE.test(t)) return false;
  return INSISTE.test(t) || NAO_ENTENDEU.test(t);
}

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
