/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ID_DO_MESSENGER_RE } from '../../common/conversa-do-robo';

// O MESSENGER DO FACEBOOK (a última fase do atendente virtual, mig 386; protótipo `mockups/regem-central-atendimento.html`).
// Caminho oficial: Messenger Platform, com o "Facebook Login" do app da distribuição. A loja entra no Facebook e autoriza a
// PÁGINA dela; o app, o segredo, o aviso de mensagem e o acesso da página (cifrado) são da distribuição. O espelho do
// Instagram Direct (`instagram/instagram.ts`) — a régua de QUEM RESPONDE é a MESMA (`quemRespondeNoDirect`), as diferenças
// do Facebook ficam aqui. Documentação da Meta:
//   • Facebook Login (fluxo manual): https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
//   • Acesso longo e da página: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
//   • Webhooks do Messenger: https://developers.facebook.com/docs/messenger-platform/webhooks
//   • Send API: https://developers.facebook.com/docs/messenger-platform/reference/send-api
// Regra pura (os testes conferem cada uma sozinha).

/** As permissões pedidas: listar as páginas, ler/responder o Messenger delas e ligar os avisos. Nada de publicar. */
export const ESCOPOS = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'] as const;
/** A versão da Graph API; `FACEBOOK_GRAPH_VERSAO` troca. */
export const VERSAO_PADRAO = 'v27.0';
/** O texto de UMA mensagem do Messenger: até 2.000 caracteres (regra da Send API). */
export const MAX_LETRAS_DO_TEXTO = 2000;
/** A janela padrão: a loja responde até 24 h depois da última mensagem do cliente. */
export const JANELA_MS = 24 * 3_600_000;
/** O "state" do login vale 15 min (a pessoa entra no Facebook e volta). */
export const ESTADO_VALE_MS = 15 * 60_000;
/** A escolha da página (quem administra mais de uma) vale 15 min. */
export const ESCOLHA_VALE_MS = 15 * 60_000;
/** As tarefas da página (no `me/accounts`) que deixam ler e responder as mensagens dela. */
export const TAREFAS_QUE_RESPONDEM = ['MESSAGING', 'MODERATE', 'MANAGE'] as const;

/**
 * O endereço do login do Facebook (a página onde a pessoa entra e autoriza as páginas).
 *
 * Com `configId` (app do tipo EMPRESA, "Login do Facebook para Empresas" — ERR-415): a configuração criada no painel da
 * Meta (token de USUÁRIO, ativo Páginas, as três permissões de `ESCOPOS`) vai em `config_id` e o `scope` NÃO vai — nesse
 * tipo de app a Meta ignora o `scope` e recusa o diálogo ("precisa pelo menos de uma permissão compatível").
 * `override_default_response_type` faz o `code` valer sobre o padrão da configuração (doc do Login para Empresas). Sem
 * `configId`: o login clássico, com `scope`.
 */
export function urlDeAutorizacao(o: { appId: string; redirect: string; estado: string; base?: string; versao?: string; configId?: string }): string {
  const configId = String(o.configId ?? '').trim();
  const q = new URLSearchParams({
    client_id: o.appId,
    redirect_uri: o.redirect,
    state: o.estado,
    response_type: 'code',
    ...(configId ? { config_id: configId, override_default_response_type: 'true' } : { scope: ESCOPOS.join(',') }),
  });
  const base = (o.base || 'https://www.facebook.com').replace(/\/+$/, '');
  return `${base}/${o.versao || VERSAO_PADRAO}/dialog/oauth?${q.toString()}`;
}

// ───────────────────────── o "state" do login (contra CSRF) ─────────────────────────

export type EstadoDoLogin = { t: string; c: string; e: number; n: string };
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
/** O rótulo do state do Messenger: um state do login do Instagram (ou de outro login) nunca vale aqui, nem com o mesmo segredo. */
const ROTULO_DO_ESTADO = 'regem:messenger:estado:v1:';
const assinar = (corpo: string, segredo: string) => createHmac('sha256', segredo).update(`${ROTULO_DO_ESTADO}${corpo}`).digest('base64url');

/** Quem pediu para conectar (empresa e pessoa), até quando vale, assinado com o segredo do app da distribuição. */
export function assinarEstado(tenantId: string, colaboradorId: string, segredo: string, agora = Date.now()): string {
  const corpo = b64(JSON.stringify({ t: tenantId, c: colaboradorId, e: agora + ESTADO_VALE_MS, n: randomBytes(8).toString('hex') }));
  return `${corpo}.${assinar(corpo, segredo)}`;
}

/** O "state" que voltou do Facebook: a assinatura confere e não venceu → quem pediu; senão, nada. */
export function lerEstado(estado: unknown, segredo: string, agora = Date.now()): EstadoDoLogin | null {
  const s = typeof estado === 'string' ? estado : '';
  const [corpo, assinatura, sobra] = s.split('.');
  if (!corpo || !assinatura || sobra !== undefined || !segredo) return null;
  const esperada = Buffer.from(assinar(corpo, segredo));
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

// ───────────────────────── as páginas de quem entrou ─────────────────────────

export type PaginaDoLogin = { id: string; nome: string; token: string };

/**
 * As páginas que a pessoa pode ligar: as do `me/accounts` com o acesso da página e uma tarefa que deixa ler e responder as
 * mensagens (MESSAGING, MODERATE ou MANAGE). Id só dígitos; sem nome = "Página"; a mesma página duas vezes = uma.
 */
export function paginasQueRespondem(lista: unknown): PaginaDoLogin[] {
  const vistas = new Set<string>();
  const saida: PaginaDoLogin[] = [];
  for (const p of Array.isArray(lista) ? lista : []) {
    const id = p?.id != null ? String(p.id) : '';
    const token = typeof p?.access_token === 'string' ? p.access_token : '';
    const tarefas = Array.isArray(p?.tasks) ? p.tasks.map((t: unknown) => String(t).toUpperCase()) : [];
    if (!ID_DO_MESSENGER_RE.test(id) || !token || vistas.has(id)) continue;
    if (!tarefas.some((t: string) => (TAREFAS_QUE_RESPONDEM as readonly string[]).includes(t))) continue;
    vistas.add(id);
    const nome = typeof p?.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 120) : 'Página';
    saida.push({ id, nome, token });
  }
  return saida;
}

/** As permissões que a pessoa CONCEDEU (o `me/permissions`), numa linha: "pages_show_list,pages_messaging,…". */
export function permissoesConcedidas(lista: unknown): string | null {
  const ok = (Array.isArray(lista) ? lista : [])
    .filter((p: any) => p?.status === 'granted' && typeof p?.permission === 'string')
    .map((p: any) => String(p.permission).slice(0, 80));
  return ok.length ? ok.join(',') : null;
}

// ───────────────────────── o aviso de mensagem ─────────────────────────

export type TipoDaMensagem = 'texto' | 'imagem' | 'audio' | 'video' | 'arquivo' | 'compartilhamento' | 'figurinha' | 'local' | 'outro';
export type EventoDoMessenger = {
  /** A página da loja (o `entry.id`). */
  pagina: string;
  /** O cliente (o PSID): quem mandou, ou — no eco — para quem a página mandou. */
  psid: string;
  mid: string | null;
  /** Eco = a própria página mandou (pelo app do Facebook / Meta Business Suite, ou pela API — aí com o `appId`). */
  eco: boolean;
  /** No eco: o app que mandou (o eco do NOSSO app tem o id do app da distribuição). */
  appId: string | null;
  /** O toque num botão (postback): o texto é o título do botão. */
  postback: boolean;
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
  fallback: 'compartilhamento',
  template: 'compartilhamento',
  share: 'compartilhamento',
  location: 'local',
};
/** O que a fila mostra quando a mensagem não tem texto (a foto, o áudio…). */
export const DESCRICAO_DO_TIPO: Record<TipoDaMensagem, string> = {
  texto: '',
  imagem: '[foto]',
  audio: '[áudio]',
  video: '[vídeo]',
  arquivo: '[arquivo]',
  compartilhamento: '[link ou publicação compartilhada]',
  figurinha: '[figurinha]',
  local: '[localização]',
  outro: '[mensagem que o Messenger não mostra aqui]',
};

const idDaMeta = (v: unknown): string => (v != null && ID_DO_MESSENGER_RE.test(String(v)) ? String(v) : '');

/**
 * As mensagens de um aviso do Messenger (`object: "page"`). Lê `entry[].messaging[]`: o texto, os anexos (só o primeiro
 * vira o tipo), o eco (com o app que mandou) e o toque num botão (`postback`: o texto é o título dele). O que não é
 * mensagem (lida, entregue, reação) fica de fora. Os ids (página e cliente) têm o formato da Meta — só dígitos (ERR-409);
 * o resto é descartado. O aviso pode trazer várias páginas e várias mensagens juntas — cada uma sai sozinha.
 */
export function lerAvisoDoMessenger(body: any): EventoDoMessenger[] {
  if (body?.object !== 'page' || !Array.isArray(body?.entry)) return [];
  const saida: EventoDoMessenger[] = [];
  for (const entry of body.entry) {
    const pagina = idDaMeta(entry?.id);
    if (!pagina) continue;
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const m = ev?.message && typeof ev.message === 'object' ? ev.message : null;
      const pb = !m && ev?.postback && typeof ev.postback === 'object' ? ev.postback : null;
      if (!m && !pb) continue; // lida, entregue, reação, otimização…: não é mensagem
      const de = idDaMeta(ev?.sender?.id);
      const para = idDaMeta(ev?.recipient?.id);
      const eco = m?.is_echo === true;
      const psid = eco ? para : de;
      if (!psid || psid === pagina) continue;
      // O eco tem de vir DA página (e o cliente nunca é a página): um aviso torto não vira "a loja respondeu".
      if (eco ? de !== pagina : para !== pagina) continue;
      const ts = Number(ev?.timestamp);
      const em = Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date();
      if (pb) {
        const titulo = typeof pb.title === 'string' && pb.title.trim() ? pb.title.trim().slice(0, 1000) : null;
        const carga = typeof pb.payload === 'string' && pb.payload.trim() ? pb.payload.trim().slice(0, 1000) : null;
        const texto = titulo ?? carga;
        if (!texto) continue;
        saida.push({
          pagina,
          psid,
          // O postback novo traz o `mid`; o antigo, não: a hora do toque faz as vezes (a Meta reentrega com a mesma hora).
          mid: typeof pb.mid === 'string' && pb.mid ? pb.mid : `pb:${psid}:${Number.isFinite(ts) ? ts : em.getTime()}`,
          eco: false,
          appId: null,
          postback: true,
          tipo: 'texto',
          texto,
          midiaUrl: null,
          em,
        });
        continue;
      }
      const anexo = Array.isArray(m.attachments) ? m.attachments[0] : null;
      const temTexto = typeof m.text === 'string' && m.text.trim();
      const tipo: TipoDaMensagem = temTexto
        ? 'texto'
        : m.sticker_id != null
          ? 'figurinha'
          : anexo
            ? TIPO_DO_ANEXO[String(anexo.type ?? '')] ?? 'outro'
            : 'outro';
      saida.push({
        pagina,
        psid,
        mid: typeof m.mid === 'string' && m.mid ? m.mid : null,
        eco,
        appId: eco && m.app_id != null && String(m.app_id).trim() ? String(m.app_id).trim() : null,
        postback: false,
        tipo,
        texto: temTexto ? String(m.text).slice(0, 4000) : null,
        midiaUrl: typeof anexo?.payload?.url === 'string' && /^https:\/\//.test(anexo.payload.url) ? anexo.payload.url.slice(0, 2000) : null,
        em,
      });
    }
  }
  return saida;
}

/** A frase curta da mensagem (o caso na fila e a conversa): o texto, senão o que ela é. */
export function frase(e: Pick<EventoDoMessenger, 'texto' | 'tipo'>): string {
  return (e.texto ?? DESCRICAO_DO_TIPO[e.tipo] ?? '').slice(0, 1000);
}

/** O que o robô recebe no lugar do texto quando o cliente mandou outra coisa (no Messenger ele não ouve áudio). */
export function textoParaORobo(e: Pick<EventoDoMessenger, 'texto' | 'tipo'>): string {
  if (e.texto) return e.texto.slice(0, 4000);
  if (e.tipo === 'audio') return '(o cliente mandou um áudio pelo Messenger; aqui você não ouve áudio)';
  return `(o cliente mandou ${DESCRICAO_DO_TIPO[e.tipo] ?? DESCRICAO_DO_TIPO.outro})`;
}

// ───────────────────────── responder ─────────────────────────

/** A janela do Messenger: aberta até 24 h depois da última mensagem do cliente. Sem mensagem dele, fechada. */
export function janela(ultimaDoCliente: Date | string | null | undefined, agora = Date.now()): { aberta: boolean; ate: string | null } {
  const t = ultimaDoCliente ? new Date(ultimaDoCliente).getTime() : NaN;
  if (!Number.isFinite(t)) return { aberta: false, ate: null };
  return { aberta: agora < t + JANELA_MS, ate: new Date(t + JANELA_MS).toISOString() };
}

const letras = (s: string) => Array.from(s).length;

/** O texto da resposta da equipe: sem espaço sobrando, não vazio, até 2.000 caracteres (uma mensagem do Messenger). */
export function textoDaResposta(v: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  const texto = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
  if (!texto) return { ok: false, erro: 'Escreva a mensagem.' };
  if (letras(texto) > MAX_LETRAS_DO_TEXTO) return { ok: false, erro: 'Mensagem longa demais para o Messenger (até 2.000 caracteres).' };
  return { ok: true, texto };
}

/** O nome do cliente no caso: o nome do perfil do Messenger, senão "Cliente do Messenger". */
export function nomeDoCliente(p: { nome?: string | null } | null | undefined): string {
  const nome = p?.nome?.trim();
  return nome ? nome.slice(0, 120) : 'Cliente do Messenger';
}

/** O nome do perfil (nome e sobrenome, como a Meta devolve), numa linha; sem nada = null. */
export function nomeDoPerfil(p: { first_name?: unknown; last_name?: unknown } | null | undefined): string | null {
  const partes = [p?.first_name, p?.last_name].filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim());
  const nome = partes.join(' ').replace(/\s+/g, ' ').trim();
  return nome ? nome.slice(0, 120) : null;
}

/** Até 3 mensagens de até 2.000 caracteres (sem cortar um emoji), pelos parágrafos, depois pelas linhas e pelas palavras. */
export const MAX_PARTES = 3;
export function partirTexto(texto: string, maxLetras = MAX_LETRAS_DO_TEXTO, maxPartes = MAX_PARTES): string[] {
  const limpo = String(texto ?? '').replace(/\r\n/g, '\n').trim();
  if (!limpo) return [];
  if (letras(limpo) <= maxLetras) return [limpo];
  const cortar = (s: string): string[] => {
    const out: string[] = [];
    let atual = '';
    for (const ch of Array.from(s)) {
      if (atual && letras(atual) + 1 > maxLetras) {
        out.push(atual);
        atual = ch;
      } else atual += ch;
    }
    if (atual) out.push(atual);
    return out;
  };
  const pedacos: { t: string; antes: string }[] = [];
  limpo.split(/\n{2,}/).forEach((par, i) => {
    const linhas = letras(par) <= maxLetras ? [par] : par.split('\n');
    linhas.forEach((linha, j) => {
      const palavras = letras(linha) <= maxLetras ? [linha] : linha.split(' ');
      palavras.forEach((palavra, k) => {
        const antes = k > 0 ? ' ' : j > 0 ? '\n' : i > 0 ? '\n\n' : '';
        (letras(palavra) <= maxLetras ? [palavra] : cortar(palavra)).forEach((t, m) => pedacos.push({ t, antes: m === 0 ? antes : '' }));
      });
    });
  });
  const partes: string[] = [];
  let atual = '';
  for (const p of pedacos) {
    if (!atual) atual = p.t;
    else if (letras(atual + p.antes + p.t) > maxLetras) {
      partes.push(atual);
      atual = p.t;
    } else atual += p.antes + p.t;
  }
  if (atual) partes.push(atual);
  if (partes.length <= maxPartes) return partes;
  // Mais do que cabe numa resposta: as primeiras inteiras e a última cortada com reticências.
  const fica = partes.slice(0, maxPartes);
  let ultima = fica[maxPartes - 1];
  while (letras(`${ultima}…`) > maxLetras) ultima = Array.from(ultima).slice(0, -1).join('');
  fica[maxPartes - 1] = `${ultima.trimEnd()}…`;
  return fica;
}

/**
 * O link do cardápio da loja no Messenger sai marcando de onde veio (`utm_source=facebook&utm_medium=messenger`): o
 * cardápio guarda a origem do pedido (origem-pedido.ts). Só nos links da PRÓPRIA loja; o que já tem `utm_source` fica.
 */
export function comOrigemDoMessenger(texto: string, linkDaLoja: string): string {
  const base = String(linkDaLoja ?? '').replace(/\/+$/, '');
  if (!base) return texto;
  const re = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])(\\?[^\\s)]*)?`, 'g');
  return String(texto ?? '').replace(re, (todo: string, q?: string) => {
    if (q && /[?&]utm_source=/.test(q)) return todo;
    const sobra = (q ?? '').replace(/[.,!?;:]+$/, '');
    const fim = (q ?? '').slice(sobra.length);
    return `${base}${sobra ? `${sobra}&` : '?'}utm_source=facebook&utm_medium=messenger${fim}`;
  });
}
