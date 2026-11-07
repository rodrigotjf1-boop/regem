/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// INSTAGRAM DIRECT NA FILA (item 6 do checkpoint da Central; protótipo `mockups/regem-central-atendimento.html`, versão
// 7; mig 377). Caminho oficial: Instagram API com o login do Instagram — documentação da Meta conferida em 06/11/2026:
//   • Business Login for Instagram: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
//   • Messaging API: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
//   • Webhooks (setup e exemplos): https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
// Regra pura (os testes conferem cada uma sozinha). A loja entra com a conta PROFISSIONAL e autoriza; o app, o segredo,
// o aviso de mensagem e a renovação do acesso são da distribuição.

/** As duas permissões pedidas: ver o perfil e ler/responder o Direct. Nada de publicar nem de comentários. */
export const ESCOPOS = ['instagram_business_basic', 'instagram_business_manage_messages'] as const;
/** A versão da Graph API (a da documentação em 06/11/2026); `INSTAGRAM_GRAPH_VERSAO` troca. */
export const VERSAO_PADRAO = 'v27.0';
/** O texto da mensagem vai em UTF-8 e com até 1.000 bytes (regra do Instagram). */
export const MAX_BYTES_DO_TEXTO = 1000;
/** A janela padrão: a loja responde até 24 h depois da última mensagem do cliente. */
export const JANELA_MS = 24 * 3_600_000;
/** O "state" do login vale 15 min (a pessoa entra no Instagram e volta). */
export const ESTADO_VALE_MS = 15 * 60_000;

/** O endereço do login do Instagram (a página onde a pessoa entra e autoriza). */
export function urlDeAutorizacao(o: { appId: string; redirect: string; estado: string; base?: string }): string {
  const q = new URLSearchParams({
    client_id: o.appId,
    redirect_uri: o.redirect,
    response_type: 'code',
    scope: ESCOPOS.join(','),
    state: o.estado,
    // Entra com a conta PROFISSIONAL (no PC da loja pode estar aberta a conta pessoal de alguém).
    force_reauth: 'true',
  });
  return `${(o.base ?? 'https://www.instagram.com').replace(/\/+$/, '')}/oauth/authorize?${q.toString()}`;
}

// ───────────────────────── o "state" do login (contra CSRF) ─────────────────────────

export type EstadoDoLogin = { t: string; c: string; e: number; n: string };
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Quem pediu para conectar (empresa e pessoa), até quando vale, assinado com o segredo da distribuição. */
export function assinarEstado(tenantId: string, colaboradorId: string, segredo: string, agora = Date.now()): string {
  const corpo = b64(JSON.stringify({ t: tenantId, c: colaboradorId, e: agora + ESTADO_VALE_MS, n: randomBytes(8).toString('hex') }));
  const assinatura = createHmac('sha256', segredo).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
}

/** O "state" que voltou do Instagram: a assinatura confere e não venceu → quem pediu; senão, nada. */
export function lerEstado(estado: unknown, segredo: string, agora = Date.now()): EstadoDoLogin | null {
  const s = typeof estado === 'string' ? estado : '';
  const [corpo, assinatura, sobra] = s.split('.');
  if (!corpo || !assinatura || sobra !== undefined || !segredo) return null;
  const esperada = Buffer.from(createHmac('sha256', segredo).update(corpo).digest('base64url'));
  const veio = Buffer.from(assinatura);
  if (esperada.length !== veio.length || !timingSafeEqual(esperada, veio)) return null;
  try {
    const e = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (typeof e?.t !== 'string' || typeof e?.c !== 'string' || typeof e?.e !== 'number' || e.e < agora) return null;
    return e as EstadoDoLogin;
  } catch {
    return null;
  }
}

/** A assinatura do aviso (`X-Hub-Signature-256: sha256=<hex>`), sobre o corpo CRU, com o segredo do app. */
export function assinaturaDoAvisoOk(corpo: Buffer | string | undefined, cabecalho: unknown, segredo: string): boolean {
  if (!corpo || !segredo || typeof cabecalho !== 'string' || !cabecalho.startsWith('sha256=')) return false;
  const esperada = Buffer.from(`sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`);
  const veio = Buffer.from(cabecalho);
  return esperada.length === veio.length && timingSafeEqual(esperada, veio);
}

// ───────────────────────── o aviso de mensagem ─────────────────────────

export type TipoDaMensagem = 'texto' | 'imagem' | 'audio' | 'video' | 'arquivo' | 'compartilhamento' | 'story' | 'reel' | 'outro';
export type EventoDoDirect = {
  /** A conta da loja (o `entry.id`: o id da conta profissional). */
  conta: string;
  /** O cliente (o IGSID): quem mandou, ou — no eco — para quem a loja mandou. */
  igsid: string;
  mid: string | null;
  /** Eco = a própria loja mandou (pelo app do Instagram ou pelo Regem). */
  eco: boolean;
  apagada: boolean;
  tipo: TipoDaMensagem;
  texto: string | null;
  midiaUrl: string | null;
  em: Date;
};

const TIPO_DO_ANEXO: Record<string, TipoDaMensagem> = {
  image: 'imagem',
  audio: 'audio',
  video: 'video',
  file: 'arquivo',
  share: 'compartilhamento',
  story_mention: 'story',
  ig_reel: 'reel',
  reel: 'reel',
};
/** O que a fila mostra quando a mensagem não tem texto (a foto, o áudio…). */
export const DESCRICAO_DO_TIPO: Record<TipoDaMensagem, string> = {
  texto: '',
  imagem: '[foto]',
  audio: '[áudio]',
  video: '[vídeo]',
  arquivo: '[arquivo]',
  compartilhamento: '[publicação compartilhada]',
  story: '[menção no story]',
  reel: '[reel]',
  outro: '[mensagem que o Instagram não mostra aqui]',
};

/**
 * As mensagens de um aviso do Instagram (`object: "instagram"`). Lê `entry[].messaging[]`: o texto, os anexos (só o
 * primeiro vira o tipo), o eco e a apagada. O que não é mensagem (lida, reação, botão) fica de fora. O aviso pode trazer
 * várias contas e várias mensagens juntas — cada uma sai sozinha.
 */
export function lerAviso(body: any): EventoDoDirect[] {
  if (body?.object !== 'instagram' || !Array.isArray(body?.entry)) return [];
  const saida: EventoDoDirect[] = [];
  for (const entry of body.entry) {
    const conta = entry?.id != null ? String(entry.id) : '';
    if (!conta) continue;
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const m = ev?.message;
      if (!m || typeof m !== 'object') continue;
      const de = ev?.sender?.id != null ? String(ev.sender.id) : '';
      const para = ev?.recipient?.id != null ? String(ev.recipient.id) : '';
      const eco = m.is_echo === true;
      const igsid = eco ? para : de;
      if (!igsid || igsid === conta) continue;
      const anexo = Array.isArray(m.attachments) ? m.attachments[0] : null;
      const tipo: TipoDaMensagem = typeof m.text === 'string' && m.text.trim()
        ? 'texto'
        : anexo
          ? TIPO_DO_ANEXO[String(anexo.type ?? '')] ?? 'outro'
          : 'outro';
      const ts = Number(ev?.timestamp);
      saida.push({
        conta,
        igsid,
        mid: typeof m.mid === 'string' && m.mid ? m.mid : null,
        eco,
        apagada: m.is_deleted === true,
        tipo,
        texto: typeof m.text === 'string' && m.text.trim() ? m.text.slice(0, 4000) : null,
        midiaUrl: typeof anexo?.payload?.url === 'string' && /^https:\/\//.test(anexo.payload.url) ? anexo.payload.url : null,
        em: Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date(),
      });
    }
  }
  return saida;
}

/** A frase curta da mensagem (o caso na fila e a conversa): o texto, senão o que ela é. */
export function frase(e: Pick<EventoDoDirect, 'texto' | 'tipo'>): string {
  return (e.texto ?? DESCRICAO_DO_TIPO[e.tipo] ?? '').slice(0, 1000);
}

// ───────────────────────── responder ─────────────────────────

/** A janela do Instagram: aberta até 24 h depois da última mensagem do cliente. Sem mensagem dele, fechada. */
export function janela(ultimaDoCliente: Date | string | null | undefined, agora = Date.now()): { aberta: boolean; ate: string | null } {
  const t = ultimaDoCliente ? new Date(ultimaDoCliente).getTime() : NaN;
  if (!Number.isFinite(t)) return { aberta: false, ate: null };
  return { aberta: agora < t + JANELA_MS, ate: new Date(t + JANELA_MS).toISOString() };
}

/** O texto da resposta: sem espaço sobrando, não vazio, até 1.000 bytes em UTF-8. */
export function textoDaResposta(v: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  const texto = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
  if (!texto) return { ok: false, erro: 'Escreva a mensagem.' };
  if (Buffer.byteLength(texto, 'utf8') > MAX_BYTES_DO_TEXTO) return { ok: false, erro: 'Mensagem longa demais para o Instagram (até 1.000 caracteres simples).' };
  return { ok: true, texto };
}

/** O nome do cliente no caso: o nome do perfil, senão o @, senão "Cliente do Instagram". */
export function nomeDoCliente(p: { nome?: string | null; usuario?: string | null } | null | undefined): string {
  const nome = p?.nome?.trim();
  if (nome) return nome.slice(0, 120);
  const u = p?.usuario?.trim().replace(/^@/, '');
  return u ? `@${u}`.slice(0, 120) : 'Cliente do Instagram';
}
