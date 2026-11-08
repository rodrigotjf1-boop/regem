/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// INSTAGRAM DIRECT NA FILA (item 6 do checkpoint da Central; protótipo `mockups/regem-central-atendimento.html`, versão
// 7; mig 377). Caminho oficial: Instagram API com o login do Instagram — documentação da Meta conferida em 06/11/2026:
//   • Business Login for Instagram: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
//   • Messaging API: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
//   • Webhooks (setup e exemplos): https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
// Regra pura (os testes conferem cada uma sozinha). A loja entra com a conta PROFISSIONAL e autoriza; o app, o segredo,
// o aviso de mensagem e a renovação do acesso são da distribuição.

/**
 * As permissões pedidas: ver o perfil, ler/responder o Direct e (F6, mig 384) ler/responder/esconder os comentários dos
 * posts da loja. Nada de publicar. A conta conectada antes da F6 não tem a dos comentários — a tela pede "Reconectar"
 * (`podeComentarios` em `comentarios.ts`).
 */
export const ESCOPOS = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'] as const;
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

// ───────────────────────── o robô no Direct (F4, 07/11/2026 — mig 378; protótipo v8) ─────────────────────────
// O MESMO robô do WhatsApp (o fluxo do n8n, com as instruções do Regem) atende o Direct. A chave da loja para o robô é
// `ig:<conta>` (no campo `instancia`, que o fluxo já repassa em todas as consultas) e o cliente é `ig:<igsid>` (no campo
// `de`, que o fluxo usa na memória e devolve como `para`): nada muda no fluxo. O Instagram não manda telefone — no Direct o
// robô NÃO vê pedido nem cadastro (as rotas de telefone recusam `ig:`); para pedir, ele manda o link do cardápio.

const DIGITOS = /^[0-9]{5,32}$/;

/** `ig:<conta>` — a chave da loja do Direct para o robô. */
export const chaveDaConta = (igUserId: string): string => `ig:${igUserId}`;
/** `ig:<igsid>` — o cliente do Direct para o robô (o `de` da mensagem e o `para` da resposta). */
export const chaveDoCliente = (igsid: string): string => `ig:${igsid}`;
/** O id que vem depois de `ig:` (a conta ou o cliente), só se forem só dígitos; senão `null`. */
export function idDaChave(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^ig:/i.test(s)) return null;
  const id = s.slice(3);
  return DIGITOS.test(id) ? id : null;
}

/** Por quanto tempo a resposta da loja pelo app do Instagram cala o robô quando a pausa da loja é "sem prazo" (0). */
export const CALADO_SEM_PRAZO_MS = 12 * 3_600_000;
/** O cliente escreveu e ninguém respondeu nisto: a conversa vira caso ("O robô não respondeu"). */
export const SEM_RESPOSTA_MS = 3 * 60_000;

export type DecisaoDoDirect = {
  /** A mensagem entra no caso aberto (que já existe). */
  anexar: boolean;
  /** Abre um caso novo para a conversa. */
  abrir: boolean;
  /** A mensagem vai ao robô. */
  robo: boolean;
};

/**
 * QUEM RESPONDE a mensagem nova do cliente no Direct. Com o robô desligado (ou indisponível), como no #861: caso aberto →
 * anexa; sem caso, abre se "Mensagens do Direct na fila" estiver ligado. Com o robô ligado: o robô responde primeiro e o
 * caso só nasce do "chamar atendente", do "Assumir" ou do "sem resposta". Ele fica QUIETO quando a conversa está com
 * alguém — caso aberto com uma pessoa, caso aberto há menos que a pausa da loja (0 = até resolver), ou resposta da loja
 * pelo app do Instagram dentro da pausa (0 = 12 h) —, a mesma régua do "humano assumiu" do WhatsApp.
 * HORÁRIO DA EQUIPE (mig 379): o caso que é RECADO esperando a abertura (`caso.recado`) e sem ninguém com ele não cala
 * o robô — a mensagem entra no recado e o robô responde (salvo a loja respondendo pelo app do Instagram). Depois do
 * `ate`, ele é um caso comum, e quem chama passa em `criadoEm` a volta da equipe: a pausa conta dali.
 * ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): o RECADO PARA O RESPONSÁVEL (`caso.paraOResponsavel`) sem ninguém com ele também
 * não cala o robô — a mensagem entra no recado e o robô responde. Com o robô desligado, ele não segura a conversa: a
 * mensagem nova abre um caso comum (se a fila estiver ligada), porque o recado não está na fila da equipe. Quem chama
 * passa o caso comum antes do recado (o que manda na conversa).
 */
export function quemRespondeNoDirect(e: {
  roboLigado: boolean;
  filaLigada: boolean;
  caso: { criadoEm: Date | string; responsavelId: string | null; recado?: boolean | null; paraOResponsavel?: boolean | null } | null;
  ultimaDaLojaEm: Date | string | null;
  minutos: number;
  agora: number;
}): DecisaoDoDirect {
  const { roboLigado, filaLigada, minutos, agora } = e;
  const recadoParaOResponsavel = e.caso?.paraOResponsavel === true && !e.caso.responsavelId;
  // Sem o robô, o recado para o responsável que espera não é "o caso da conversa": a mensagem vai para a fila.
  const caso = !roboLigado && recadoParaOResponsavel ? null : e.caso;
  if (!roboLigado) return caso ? { anexar: true, abrir: false, robo: false } : { anexar: false, abrir: filaLigada, robo: false };
  const pausa = minutos > 0 ? minutos * 60_000 : null;
  const t = e.ultimaDaLojaEm ? new Date(e.ultimaDaLojaEm).getTime() : NaN;
  const lojaRespondeu = Number.isFinite(t) && agora - t < (pausa ?? CALADO_SEM_PRAZO_MS);
  if ((caso?.recado === true || recadoParaOResponsavel) && !caso?.responsavelId) return { anexar: true, abrir: false, robo: !lojaRespondeu };
  if (caso) {
    const idade = agora - new Date(caso.criadoEm).getTime();
    const comAlguem = !!caso.responsavelId || lojaRespondeu || pausa === null || idade < pausa;
    return { anexar: true, abrir: false, robo: !comAlguem };
  }
  return { anexar: false, abrir: false, robo: !lojaRespondeu };
}

/** O que o robô recebe no lugar do texto quando o cliente mandou outra coisa (no Direct ele não ouve áudio). */
export function textoParaORobo(e: Pick<EventoDoDirect, 'texto' | 'tipo'>): string {
  if (e.texto) return e.texto.slice(0, 4000);
  if (e.tipo === 'audio') return '(o cliente mandou um áudio pelo Direct; aqui você não ouve áudio)';
  return `(o cliente mandou ${DESCRICAO_DO_TIPO[e.tipo] ?? DESCRICAO_DO_TIPO.outro})`;
}

/** Até 3 mensagens de até 1.000 bytes cada (regra do Instagram), pelos parágrafos, depois pelas linhas e pelas palavras. */
export const MAX_PARTES = 3;
export function partirTexto(texto: string, maxBytes = MAX_BYTES_DO_TEXTO, maxPartes = MAX_PARTES): string[] {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const limpo = String(texto ?? '').replace(/\r\n/g, '\n').trim();
  if (!limpo) return [];
  if (bytes(limpo) <= maxBytes) return [limpo];
  // Pedaços que cabem, cada um com o separador que vinha ANTES dele no texto: o parágrafo inteiro; se não, as linhas; se
  // não, as palavras; e a palavra gigante, letra a letra (por caractere, nunca no meio de um emoji).
  const cortar = (s: string): string[] => {
    const out: string[] = [];
    let atual = '';
    for (const ch of Array.from(s)) {
      if (atual && bytes(atual + ch) > maxBytes) {
        out.push(atual);
        atual = ch;
      } else atual += ch;
    }
    if (atual) out.push(atual);
    return out;
  };
  const pedacos: { t: string; antes: string }[] = [];
  limpo.split(/\n{2,}/).forEach((par, i) => {
    const linhas = bytes(par) <= maxBytes ? [par] : par.split('\n');
    linhas.forEach((linha, j) => {
      const palavras = bytes(linha) <= maxBytes ? [linha] : linha.split(' ');
      palavras.forEach((palavra, k) => {
        const antes = k > 0 ? ' ' : j > 0 ? '\n' : i > 0 ? '\n\n' : '';
        (bytes(palavra) <= maxBytes ? [palavra] : cortar(palavra)).forEach((t, m) => pedacos.push({ t, antes: m === 0 ? antes : '' }));
      });
    });
  });
  // Junta os pedaços de volta enquanto couber, com o separador original.
  const partes: string[] = [];
  let atual = '';
  for (const p of pedacos) {
    if (!atual) atual = p.t;
    else if (bytes(atual + p.antes + p.t) > maxBytes) {
      partes.push(atual);
      atual = p.t;
    } else atual += p.antes + p.t;
  }
  if (atual) partes.push(atual);
  if (partes.length <= maxPartes) return partes;
  // Mais do que o Instagram aguenta numa resposta: as primeiras inteiras e a última cortada com reticências.
  const fica = partes.slice(0, maxPartes);
  let ultima = fica[maxPartes - 1];
  while (bytes(`${ultima}…`) > maxBytes) ultima = Array.from(ultima).slice(0, -1).join('');
  fica[maxPartes - 1] = `${ultima.trimEnd()}…`;
  return fica;
}

/**
 * O link do cardápio da loja no Direct sai marcando de onde veio (`utm_source=instagram&utm_medium=direct`): o cardápio
 * guarda a origem do pedido (origem-pedido.ts). Só nos links da PRÓPRIA loja; o que já tem `utm_source` fica como está.
 */
export function comOrigemDoDirect(texto: string, linkDaLoja: string): string {
  const base = String(linkDaLoja ?? '').replace(/\/+$/, '');
  if (!base) return texto;
  const re = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])(\\?[^\\s)]*)?`, 'g');
  return String(texto ?? '').replace(re, (todo: string, q?: string) => {
    if (q && /[?&]utm_source=/.test(q)) return todo;
    const sobra = (q ?? '').replace(/[.,!?;:]+$/, '');
    const fim = (q ?? '').slice(sobra.length);
    return `${base}${sobra ? `${sobra}&` : '?'}utm_source=instagram&utm_medium=direct${fim}`;
  });
}
