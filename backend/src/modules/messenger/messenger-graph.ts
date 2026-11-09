/* eslint-disable @typescript-eslint/no-explicit-any */
import { ID_DO_MESSENGER_RE } from '../../common/conversa-do-robo';
import { VERSAO_PADRAO } from './messenger';

// O CLIENTE DA META para o Messenger (mig 386): as chamadas da documentação oficial (Facebook Login e Messenger Platform),
// nada a mais. Os endereços são da distribuição (variáveis do ambiente; os testes apontam para um Facebook de mentira local
// — nunca vêm da loja, V68). O acesso vai no cabeçalho `Authorization` sempre que a Meta aceita; a troca do código e do
// acesso longo leva o segredo do app NA CONSULTA (é como a Meta pede): esse endereço nunca vai para o registro. Erro da
// Meta vira `ErroDaMeta` com a mensagem dela (sem o acesso) e o código (190 = o acesso não vale mais).

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
export const graph = () => base(process.env.FACEBOOK_GRAPH_URL, 'https://graph.facebook.com');
export const login = () => base(process.env.FACEBOOK_LOGIN_URL, 'https://www.facebook.com');
export const versao = () => (/^v\d+\.\d+$/.test(String(process.env.FACEBOOK_GRAPH_VERSAO ?? '')) ? String(process.env.FACEBOOK_GRAPH_VERSAO) : VERSAO_PADRAO);
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
    const msg = typeof err.message === 'string' ? err.message.slice(0, 300) : `HTTP ${res.status}`;
    throw new ErroDaMeta(msg, res.status, Number.isFinite(Number(err.code)) ? Number(err.code) : null);
  }
  return j;
}

/** O id (página, cliente) entra no endereço só no formato da Meta: dígitos. */
const idNoEndereco = (v: string, oque: string) => {
  if (!ID_DO_MESSENGER_RE.test(String(v ?? ''))) throw new ErroDaMeta(`${oque} inválido`, 400, null);
  return encodeURIComponent(v);
};

/** O código do login → o acesso do usuário (curto). Só do servidor: leva o segredo do app. */
export async function trocarCodigo(o: { appId: string; segredo: string; redirect: string; codigo: string }) {
  const q = new URLSearchParams({ client_id: o.appId, redirect_uri: o.redirect, client_secret: o.segredo, code: o.codigo });
  const j = await chamar(`${graph()}/${versao()}/oauth/access_token?${q.toString()}`);
  if (typeof j?.access_token !== 'string' || !j.access_token) throw new ErroDaMeta('a Meta não devolveu o acesso', 502, null);
  return { token: String(j.access_token) };
}

/** O acesso curto do usuário → o longo (o acesso de cada página tirado dele não vence). Só do servidor: leva o segredo. */
export async function acessoLongo(o: { appId: string; segredo: string; curto: string }) {
  const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: o.appId, client_secret: o.segredo, fb_exchange_token: o.curto });
  const j = await chamar(`${graph()}/${versao()}/oauth/access_token?${q.toString()}`);
  if (typeof j?.access_token !== 'string' || !j.access_token) throw new ErroDaMeta('a Meta não devolveu o acesso longo', 502, null);
  return { token: String(j.access_token) };
}

/** As páginas de quem entrou, com o acesso de cada uma e as tarefas que a pessoa tem nela (até 100). */
export async function paginas(tokenDoUsuario: string): Promise<any[]> {
  const j = await chamar(`${graph()}/${versao()}/me/accounts?fields=id,name,access_token,tasks&limit=100`, {
    headers: { authorization: `Bearer ${tokenDoUsuario}` },
  });
  return Array.isArray(j?.data) ? j.data : [];
}

/** As permissões que a pessoa concedeu (e as que recusou). */
export async function permissoes(tokenDoUsuario: string): Promise<any[]> {
  const j = await chamar(`${graph()}/${versao()}/me/permissions`, { headers: { authorization: `Bearer ${tokenDoUsuario}` } });
  return Array.isArray(j?.data) ? j.data : [];
}

/** Liga os avisos desta página para o nosso app: as mensagens e os toques nos botões (cada página é assinada ao conectar). */
export async function assinarAvisos(paginaId: string, tokenDaPagina: string) {
  const j = await chamar(`${graph()}/${versao()}/${idNoEndereco(paginaId, 'página')}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenDaPagina}` },
  });
  if (j?.success !== true) throw new ErroDaMeta('a Meta não ligou o aviso de mensagens da página', 502, null);
}

/** Desliga os avisos da página (ao desconectar ou trocar de página). */
export async function desligarAvisos(paginaId: string, tokenDaPagina: string) {
  await chamar(`${graph()}/${versao()}/${idNoEndereco(paginaId, 'página')}/subscribed_apps`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${tokenDaPagina}` },
  });
}

/** O perfil do cliente (nome e sobrenome) — só de quem escreveu para a página. */
export async function perfilDoCliente(psid: string, tokenDaPagina: string) {
  const j = await chamar(`${graph()}/${versao()}/${idNoEndereco(psid, 'cliente')}?fields=first_name,last_name`, {
    headers: { authorization: `Bearer ${tokenDaPagina}` },
  });
  return { first_name: j?.first_name, last_name: j?.last_name };
}

/**
 * Manda um texto no Messenger da página (Send API): `POST /{página}/messages` com `{ recipient: { id }, messaging_type:
 * 'RESPONSE', message: { text } }` — a resposta dentro das 24 h. Devolve o id da mensagem (o eco que vier depois tem o mesmo).
 */
export async function enviarTexto(paginaId: string, tokenDaPagina: string, psid: string, texto: string) {
  const j = await chamar(`${graph()}/${versao()}/${idNoEndereco(paginaId, 'página')}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenDaPagina}`, 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: texto } }),
  });
  return { mid: typeof j?.message_id === 'string' ? j.message_id : null };
}
