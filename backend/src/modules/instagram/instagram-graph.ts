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

/** Liga o aviso de mensagens desta conta para o nosso app (cada conta é assinada uma vez, ao conectar). */
export async function assinarAvisos(igUserId: string, token: string) {
  const j = await chamar(`${graph()}/${versao()}/${encodeURIComponent(igUserId)}/subscribed_apps?subscribed_fields=messages`, {
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
