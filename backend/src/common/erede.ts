// Integração Rede (Itaú) — PIX pela API do e.Rede. REST direto (sem SDK).
//
// Credencial da LOJA (modo distribuição, como o Mercado Pago e o PagBank): o número do estabelecimento (PV) e a
// chave de integração que o usuário master gera no portal da Rede (e.Rede › para vender › e-commerce › chave de
// integração). Ficam na integração 'rede' — o PV em `client_id`, a chave CIFRADA em `client_secret`
// (`common/credencial-rede.ts`). O PIX do e.Rede só existe para quem tem conta no Itaú.
//
// Login: OAuth 2.0 client_credentials (clientId = PV, clientSecret = chave) → token de 24 min, guardado em memória
// por credencial e renovado antes de vencer; 401 numa chamada descarta o token e tenta 1× com um novo.
// Ambiente: produção por padrão; REDE_AMBIENTE=sandbox aponta o sandbox no dev/homologação.
// Docs: developer.userede.com.br/e-rede (cópia em OneDrive\Documentos\Integracoes\Rede-Itau).
//
// O que o sandbox mostrou (05/11/2026), e o código segue:
//  • PIX pendente: a consulta devolve `qrCodeResponse` com status "Pending", o QR e `expirationQrCode`;
//    pago: devolve `authorization` com status "Approved" (+ `capture`); devolvido por inteiro: "Canceled".
//  • A mesma `reference` duas vezes → 422 código 42; a consulta pela referência devolve o MESMO QR. É isso que
//    torna o "gerar de novo" (recarregar a página) idempotente: nunca nasce um 2º PIX para o mesmo pedido.
//  • Devolução: 359 = feita; 360 = em processamento; 355 = já devolvida por inteiro.
//  • A Rede NÃO avisa sozinha sem cadastrar a URL por telefone: o Regem confere pela consulta.

import { createHash } from 'node:crypto';
import { classificarFalhaGateway, FIN_TIMEOUT_CONSULTA_MS, FIN_TIMEOUT_CRIAR_MS, GatewayError } from './gateway-erro';

export type CredencialRede = { pv: string; chave: string };

export type PixCriado = {
  id: string; // tid da Rede
  status: string;
  qrCode: string | null; // copia-e-cola (EMV)
  qrCodeBase64: string | null; // imagem do QR (PNG em base64)
  ticketUrl: string | null; // a Rede não dá link de imagem
};

export type SituacaoPixRede = 'paid' | 'pending' | 'canceled' | 'outro';

export type ConsultaPixRede = {
  id: string;
  status: SituacaoPixRede;
  /** Até quando o QR aceita pagamento (só vem enquanto está pendente). */
  expiraEm: Date | null;
};

function sandbox(): boolean {
  return String(process.env.REDE_AMBIENTE ?? '').trim().toLowerCase() === 'sandbox';
}
function urlToken(): string {
  return sandbox() ? 'https://rl7-sandbox-api.useredecloud.com.br/oauth2/token' : 'https://api.userede.com.br/redelabs/oauth2/token';
}
function urlTransacoes(): string {
  return sandbox() ? 'https://sandbox-erede.useredecloud.com.br/v2/transactions' : 'https://api.userede.com.br/erede/v2/transactions';
}

const centavos = (reais: number) => Math.round(Number(reais) * 100);

/** "2026-11-05T04:14:06" na hora de Brasília — o formato que a Rede pede na validade do QR. */
export function horaDeBrasilia(d: Date): string {
  return d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false }).replace(' ', 'T');
}

// ===== Token (24 min) =====

type TokenGuardado = { token: string; renovarEm: number };
const tokens = new Map<string, TokenGuardado>();
const pedindo = new Map<string, Promise<string>>();

// A chave do cache é um resumo (nunca a chave em claro): trocar a chave na tela invalida o token sozinho.
const chaveDoCache = (c: CredencialRede) => createHash('sha256').update(`${urlToken()}|${c.pv}|${c.chave}`).digest('hex');

/** Só para os testes: esquece os tokens guardados. */
export function __esquecerTokensRede(): void {
  tokens.clear();
  pedindo.clear();
}

async function pedirToken(c: CredencialRede): Promise<string> {
  let res: Response;
  try {
    res = await fetch(urlToken(), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.pv}:${c.chave}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(FIN_TIMEOUT_CONSULTA_MS),
    });
  } catch (e) {
    // Sem token nada foi cobrado: é seguro cair no próximo gateway (não é estado ambíguo).
    throw new GatewayError(`Rede: sem resposta no login (${e instanceof Error ? e.message : e})`, { ambiguo: false, cause: e });
  }
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    const motivo = res.status === 401 || j?.error === 'invalid_client' ? 'PV ou chave de integração recusados' : `login recusado (${j?.error ?? 'sem detalhe'})`;
    throw new GatewayError(`Rede ${res.status}: ${motivo}`, { status: res.status, ambiguo: false });
  }
  const j: any = await res.json().catch(() => ({}));
  const token = String(j?.access_token ?? '');
  if (!token) throw new GatewayError('Rede: login sem token na resposta', { status: res.status, ambiguo: false });
  // Renova com folga: a Rede dá 1439 s; o token novo é pedido a partir de ~20 min.
  const validade = Math.max(60, Number(j?.expires_in) || 1440);
  tokens.set(chaveDoCache(c), { token, renovarEm: Date.now() + (validade - 240) * 1000 });
  return token;
}

async function obterToken(c: CredencialRede, novo = false): Promise<string> {
  const k = chaveDoCache(c);
  const g = tokens.get(k);
  if (!novo && g && g.renovarEm > Date.now()) return g.token;
  if (novo) tokens.delete(k);
  // Duas cobranças juntas da mesma loja pedem UM token.
  const andamento = pedindo.get(k);
  if (andamento) return andamento;
  const p = pedirToken(c).finally(() => pedindo.delete(k));
  pedindo.set(k, p);
  return p;
}

type Resposta = { status: number; j: any };

/** Chamada autenticada. 401 = token vencido ou revogado: descarta o guardado e tenta 1× com um novo. */
async function chamar(c: CredencialRede, url: string, init: { method: string; body?: unknown }, timeoutMs: number): Promise<Resposta> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await obterToken(c, tentativa > 0);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw classificarFalhaGateway(e); // rede/timeout: estado desconhecido
    }
    if (res.status === 401 && tentativa === 0) continue;
    return { status: res.status, j: await res.json().catch(() => ({})) };
  }
  // Inalcançável: a 2ª volta sempre retorna.
  throw new GatewayError('Rede: token recusado duas vezes', { status: 401, ambiguo: false });
}

const falha = (r: Resposta, oQue: string) =>
  `Rede ${oQue} ${r.status}${r.j?.returnCode ? ` (código ${r.j.returnCode})` : ''}: ${String(r.j?.returnMessage ?? 'sem detalhe').slice(0, 160)}`;

/** O bloco da transação: `authorization` depois de pago, `qrCodeResponse` enquanto pendente. */
function bloco(j: any): any {
  return j?.authorization ?? j?.qrCodeResponse ?? {};
}

function situacao(status: unknown): SituacaoPixRede {
  const s = String(status ?? '').toLowerCase();
  if (s === 'approved') return 'paid';
  if (s === 'pending' || s === '') return 'pending';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  return 'outro';
}

function pixDaConsulta(j: any): PixCriado {
  const b = bloco(j);
  return {
    id: String(b.tid ?? ''),
    status: situacao(b.status) === 'paid' ? 'approved' : 'pending',
    qrCode: b.qrCodeData ?? null,
    qrCodeBase64: b.qrCodeImage ?? null,
    ticketUrl: null,
  };
}

// ===== PIX =====

/**
 * Cria a cobrança PIX (QR dinâmico). `valor` em reais. `idempotencia` vira a `reference` da Rede (única por PV):
 * gerar de novo para o mesmo pedido devolve o MESMO QR, nunca um segundo PIX vivo.
 */
export async function criarPixRede(
  c: CredencialRede,
  dados: { valor: number; idempotencia: string; referenciaExterna: string; expiraEm?: Date },
): Promise<PixCriado> {
  const amount = centavos(dados.valor);
  if (!(amount > 0)) throw new GatewayError('Rede: valor do PIX precisa ser maior que zero', { ambiguo: false });
  const reference = String(dados.idempotencia);
  if (!reference || reference.length > 50) throw new GatewayError('Rede: referência do PIX inválida', { ambiguo: false });
  const orderId = String(dados.referenciaExterna).replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
  const vence = dados.expiraEm ?? new Date(Date.now() + 10 * 60 * 1000);
  const corpo = { kind: 'Pix', reference, ...(orderId ? { orderId } : {}), amount, qrCode: { dateTimeExpiration: horaDeBrasilia(vence) } };

  const r = await chamar(c, urlTransacoes(), { method: 'POST', body: corpo }, FIN_TIMEOUT_CRIAR_MS);
  if ((r.status === 200 || r.status === 201) && String(r.j?.returnCode) === '00') {
    const q = r.j?.qrCodeResponse ?? {};
    return { id: String(r.j.tid), status: 'pending', qrCode: q.qrCodeData ?? null, qrCodeBase64: q.qrCodeImage ?? null, ticketUrl: null };
  }
  if (r.status === 422 && String(r.j?.returnCode) === '42') {
    // Já existe um PIX com esta referência (1ª tentativa respondeu tarde, página recarregada): devolve ESSE.
    const existente = await buscarPorReferencia(c, reference);
    if (existente?.id) return existente;
    throw new GatewayError('Rede: PIX já existe, mas a consulta pela referência não o achou', { status: 422, ambiguo: true });
  }
  throw classificarFalhaGateway(new Error(falha(r, 'PIX')), r.status);
}

async function buscarPorReferencia(c: CredencialRede, reference: string): Promise<PixCriado | null> {
  const r = await chamar(c, `${urlTransacoes()}?reference=${encodeURIComponent(reference)}`, { method: 'GET' }, FIN_TIMEOUT_CONSULTA_MS);
  if (r.status === 404) return null;
  if (r.status !== 200) throw classificarFalhaGateway(new Error(falha(r, 'consulta pela referência')), r.status);
  return pixDaConsulta(r.j);
}

/** Situação do PIX pelo tid (polling, conferência de minuto e prazo). Lança em falha — quem chama decide. */
export async function consultarPagamentoRede(c: CredencialRede, tid: string): Promise<ConsultaPixRede> {
  const r = await chamar(c, `${urlTransacoes()}/${encodeURIComponent(tid)}`, { method: 'GET' }, FIN_TIMEOUT_CONSULTA_MS);
  if (r.status !== 200) throw new Error(falha(r, 'consulta'));
  const b = bloco(r.j);
  const vence = b.expirationQrCode ? new Date(String(b.expirationQrCode)) : null;
  return { id: String(b.tid ?? tid), status: situacao(b.status), expiraEm: vence && !Number.isNaN(vence.getTime()) ? vence : null };
}

/**
 * Devolve um PIX PAGO — total (sem `valor`) ou parcial (`valor` em reais). 359 = feita; 360 = em processamento.
 * Lança em falha para o chamador cair no fallback manual.
 */
export async function reembolsarPagamentoRede(c: CredencialRede, tid: string, valor?: number): Promise<{ id: string; status: string }> {
  let amount = valor != null ? centavos(valor) : 0;
  if (!amount) {
    const r = await chamar(c, `${urlTransacoes()}/${encodeURIComponent(tid)}`, { method: 'GET' }, FIN_TIMEOUT_CONSULTA_MS);
    if (r.status !== 200) throw new Error(falha(r, 'consulta para devolver'));
    amount = Number(r.j?.capture?.amount ?? bloco(r.j).amount ?? 0);
  }
  if (!(amount > 0)) throw new Error('Rede: valor da devolução não encontrado');
  const r = await chamar(c, `${urlTransacoes()}/${encodeURIComponent(tid)}/refunds`, { method: 'POST', body: { amount } }, FIN_TIMEOUT_CRIAR_MS);
  const rc = String(r.j?.returnCode ?? '');
  if (r.status >= 200 && r.status < 300 && (rc === '359' || rc === '360'))
    return { id: String(r.j?.refundId ?? tid), status: rc === '359' ? 'done' : 'processing' };
  throw new Error(falha(r, 'devolução'));
}

/** "Testar conexão": faz o login com o PV e a chave (sem cobrar nada). */
export async function validarCredencialRede(c: CredencialRede): Promise<{ ok: true; conta: string }> {
  await obterToken(c, true);
  return { ok: true, conta: `PV ${c.pv}` };
}
