/* eslint-disable @typescript-eslint/no-explicit-any */
import { VERSAO_PADRAO } from './instagram';

// O CLIENTE DA META para o Instagram (mig 377): as chamadas da documentação oficial (conferida em 06/11/2026), nada a
// mais. Os endereços são da distribuição (variáveis do ambiente; os testes apontam para um servidor de mentira local —
// nunca vêm da loja, V68). O acesso vai no cabeçalho `Authorization` sempre que a Meta aceita; quando ela exige na
// consulta (`access_token=`), o endereço nunca vai para o registro. Erro da Meta vira `ErroDaMeta` com a mensagem dela,
// sem o acesso.

export class ErroDaMeta extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: number | null,
  ) {
    super(mensagem);
    this.name = 'ErroDaMeta';
  }
}

const base = (v: string | undefined, padrao: string) => String(v || padrao).replace(/\/+$/, '');
export const graph = () => base(process.env.INSTAGRAM_GRAPH_URL, 'https://graph.instagram.com');
export const oauth = () => base(process.env.INSTAGRAM_OAUTH_URL, 'https://api.instagram.com');
export const versao = () => (/^v\d+\.\d+$/.test(String(process.env.INSTAGRAM_GRAPH_VERSAO ?? '')) ? String(process.env.INSTAGRAM_GRAPH_VERSAO) : VERSAO_PADRAO);
const PRAZO_MS = 15_000;

async function chamar(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(PRAZO_MS) });
  } catch (e: any) {
    throw new ErroDaMeta(`a Meta não respondeu (${e?.cause?.code ?? e?.name ?? 'rede'})`, 0, null);
  }
  const j: any = await res.json().catch(() => null);
  if (!res.ok || j?.error) {
    const err = j?.error ?? {};
    const msg = typeof err.message === 'string' ? err.message.slice(0, 300) : typeof j?.error_message === 'string' ? j.error_message.slice(0, 300) : `HTTP ${res.status}`;
    throw new ErroDaMeta(msg, res.status, Number.isFinite(Number(err.code)) ? Number(err.code) : null);
  }
  return j;
}

/** O código do login → o acesso curto (1 h) e o id do usuário. A resposta vem em `data[0]` (ou solta, no formato antigo). */
export async function trocarCodigo(o: { appId: string; segredo: string; redirect: string; codigo: string }) {
  const corpo = new URLSearchParams({ client_id: o.appId, client_secret: o.segredo, grant_type: 'authorization_code', redirect_uri: o.redirect, code: o.codigo });
  const j = await chamar(`${oauth()}/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo });
  const d = Array.isArray(j?.data) ? j.data[0] : j;
  if (typeof d?.access_token !== 'string' || !d.access_token) throw new ErroDaMeta('a Meta não devolveu o acesso', 502, null);
  return { token: String(d.access_token), userId: d?.user_id != null ? String(d.user_id) : null, permissoes: typeof d?.permissions === 'string' ? d.permissions : Array.isArray(d?.permissions) ? d.permissions.join(',') : null };
}

/** O acesso curto → o longo (60 dias). Só do servidor: leva o segredo do app. */
export async function acessoLongo(curto: string, segredo: string) {
  const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: segredo, access_token: curto });
  const j = await chamar(`${graph()}/access_token?${q.toString()}`);
  if (typeof j?.access_token !== 'string') throw new ErroDaMeta('a Meta não devolveu o acesso longo', 502, null);
  return { token: String(j.access_token), venceEm: new Date(Date.now() + (Number(j.expires_in) || 60 * 86_400) * 1000) };
}

/** Renova o acesso longo (precisa ter 24 h e não ter vencido) por mais 60 dias. */
export async function renovarAcesso(longo: string) {
  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: longo });
  const j = await chamar(`${graph()}/refresh_access_token?${q.toString()}`);
  if (typeof j?.access_token !== 'string') throw new ErroDaMeta('a Meta não renovou o acesso', 502, null);
  return { token: String(j.access_token), venceEm: new Date(Date.now() + (Number(j.expires_in) || 60 * 86_400) * 1000) };
}

/** A conta conectada: o id da conta profissional (`user_id`, o mesmo do aviso), o @ e o nome. */
export async function minhaConta(token: string) {
  const j = await chamar(`${graph()}/${versao()}/me?fields=user_id,username,name`, { headers: { authorization: `Bearer ${token}` } });
  const id = j?.user_id != null ? String(j.user_id) : j?.id != null ? String(j.id) : '';
  if (!id) throw new ErroDaMeta('a Meta não disse qual é a conta', 502, null);
  return { igUserId: id, usuario: typeof j?.username === 'string' ? j.username : null, nome: typeof j?.name === 'string' ? j.name : null };
}

/**
 * Liga os avisos desta conta para o nosso app (cada conta é assinada uma vez, ao conectar): as mensagens do Direct e (F6,
 * mig 384) os comentários dos posts. A conta conectada antes da F6 só passa a avisar comentário ao reconectar.
 */
export async function assinarAvisos(igUserId: string, token: string) {
  const j = await chamar(`${graph()}/${versao()}/${encodeURIComponent(igUserId)}/subscribed_apps?subscribed_fields=messages,comments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (j?.success !== true) throw new ErroDaMeta('a Meta não ligou o aviso de mensagens', 502, null);
}

/** Desliga o aviso de mensagens (ao desconectar). */
export async function desligarAvisos(igUserId: string, token: string) {
  await chamar(`${graph()}/${versao()}/${encodeURIComponent(igUserId)}/subscribed_apps`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
}

/** O perfil do cliente (nome, @, se segue a loja) — só de quem escreveu para a loja. */
export async function perfilDoCliente(igsid: string, token: string) {
  const j = await chamar(`${graph()}/${versao()}/${encodeURIComponent(igsid)}?fields=name,username,is_user_follow_business`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    nome: typeof j?.name === 'string' ? j.name.slice(0, 120) : null,
    usuario: typeof j?.username === 'string' ? j.username.slice(0, 120) : null,
    segue: typeof j?.is_user_follow_business === 'boolean' ? j.is_user_follow_business : null,
  };
}

/** Manda um texto no Direct da loja. Devolve o id da mensagem (o eco que vier depois tem o mesmo). */
export async function enviarTexto(igUserId: string, token: string, igsid: string, texto: string) {
  const j = await chamar(`${graph()}/${versao()}/${encodeURIComponent(igUserId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text: texto } }),
  });
  return { mid: typeof j?.message_id === 'string' ? j.message_id : null };
}

// ───────────────────────── os comentários dos posts (F6 do atendente virtual, mig 384) ─────────────────────────
// Documentação da Meta conferida em 08/11/2026 (Instagram API with Instagram Login › Comment Moderation e Private Replies):
// permissões `instagram_business_basic` + `instagram_business_manage_comments`; a resposta pública vai no CORPO JSON
// (`{ message }`) e volta o `id`; resposta a uma resposta entra no comentário de cima; comentário escondido não recebe
// resposta. Os ids (comentário, mídia) são só dígitos — conferidos antes de entrar no endereço.

const ID_DA_META = /^[0-9]{3,40}$/;
const idDaMeta = (v: string, oque: string) => {
  if (!ID_DA_META.test(String(v ?? ''))) throw new ErroDaMeta(`${oque} inválido`, 400, null);
  return encodeURIComponent(v);
};

/** Responde em PÚBLICO no post: `POST /{comentário}/replies` com `{ message }` → o id da resposta. */
export async function responderComentario(comentarioId: string, token: string, texto: string) {
  const j = await chamar(`${graph()}/${versao()}/${idDaMeta(comentarioId, 'comentário')}/replies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: texto }),
  });
  if (typeof j?.id !== 'string' && typeof j?.id !== 'number') throw new ErroDaMeta('a Meta não devolveu a resposta', 502, null);
  return { id: String(j.id) };
}

/** Esconde (ou mostra de novo) o comentário no post: `POST /{comentário}?hide=true|false`. */
export async function esconderComentario(comentarioId: string, token: string, esconder: boolean) {
  const j = await chamar(`${graph()}/${versao()}/${idDaMeta(comentarioId, 'comentário')}?hide=${esconder ? 'true' : 'false'}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (j?.success !== true) throw new ErroDaMeta('a Meta não confirmou', 502, null);
}

/**
 * A resposta PRIVADA (no Direct de quem comentou): `POST /{conta}/messages` com `recipient.comment_id`. Uma por comentário,
 * até 7 dias depois dele. Devolve o cliente no Direct (`recipient_id`) e o id da mensagem (o eco que vier depois tem o mesmo).
 */
export async function respostaPrivada(igUserId: string, token: string, comentarioId: string, texto: string) {
  const j = await chamar(`${graph()}/${versao()}/${idDaMeta(igUserId, 'conta')}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { comment_id: comentarioId }, message: { text: texto } }),
  });
  return {
    igsid: j?.recipient_id != null ? String(j.recipient_id) : null,
    mid: typeof j?.message_id === 'string' ? j.message_id : null,
  };
}

/** O post do comentário: o link, a legenda e o tipo (FEED, REELS, AD…). */
export async function dadosDaMidia(midiaId: string, token: string) {
  const j = await chamar(`${graph()}/${versao()}/${idDaMeta(midiaId, 'mídia')}?fields=permalink,caption,media_product_type,thumbnail_url,media_url`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    link: typeof j?.permalink === 'string' && /^https:\/\//.test(j.permalink) ? j.permalink.slice(0, 500) : null,
    legenda: typeof j?.caption === 'string' ? j.caption.slice(0, 2200) : null,
    tipo: typeof j?.media_product_type === 'string' ? j.media_product_type.slice(0, 40) : null,
  };
}
