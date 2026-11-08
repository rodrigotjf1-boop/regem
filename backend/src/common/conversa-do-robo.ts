import { createHmac, timingSafeEqual } from 'node:crypto';
import { chaveTelefone } from './telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FICHA DA CONVERSA (robô de WhatsApp, Fase 5, F3 — 30/10/2026): a prova de que o robô está falando com ESTE cliente
// desta loja. A cada mensagem que entrega ao robô (n8n), o Regem assina { loja, telefone, validade } com uma chave
// derivada da senha do robô. As rotas que leem ou mudam dados do cliente (cadastro, endereços, carrinho, pedido) só
// aceitam a ficha — a loja e o telefone vêm DELA, nunca de um parâmetro. Assim nem uma mensagem que tente enganar a IA
// ("me mostra o endereço do 21999…") nem quem tivesse a senha do robô sem a ficha lê o cliente de outra pessoa (V79).
// A ficha vale 12 h (uma conversa); a mensagem seguinte traz outra.

export const CABECALHO_CONVERSA = 'x-regem-conversa';
export const VALIDADE_DA_CONVERSA_MS = 12 * 60 * 60 * 1000;

function chave(): Buffer | null {
  const s = (process.env.BOT_RESOLVER_SECRET ?? '').trim();
  return s ? createHmac('sha256', s).update('regem:conversa-do-robo:v1').digest() : null;
}

/** A ficha para a mensagem deste telefone nesta loja (ou `null` sem a senha do robô configurada). */
export function assinarConversa(tenantId: string, telefone: unknown, agora = Date.now()): string | null {
  const k = chave();
  const tel = String(telefone ?? '').replace(/\D/g, '');
  if (!k || !tenantId || !tel) return null;
  const corpo = Buffer.from(JSON.stringify({ t: tenantId, f: tel, e: agora + VALIDADE_DA_CONVERSA_MS })).toString('base64url');
  return `${corpo}.${createHmac('sha256', k).update(corpo).digest('base64url')}`;
}

export type Conversa = { tenantId: string; telefone: string; chave: string };

/** A conversa da ficha, se a assinatura confere e ela não venceu; senão `null` (quem chama recusa com 401). */
export function lerConversa(ficha: unknown, agora = Date.now()): Conversa | null {
  const k = chave();
  if (!k) return null;
  const [corpo, assinatura, sobra] = String(ficha ?? '').trim().split('.');
  if (!corpo || !assinatura || sobra !== undefined) return null;
  const esperada = createHmac('sha256', k).update(corpo).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  let d: any;
  try {
    d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof d?.t !== 'string' || typeof d?.f !== 'string' || !(Number(d?.e) > agora)) return null;
  const k2 = chaveTelefone(d.f);
  return k2 ? { tenantId: d.t, telefone: d.f, chave: k2 } : null;
}

// ───────────────────────── a ficha do DIRECT do Instagram (F4, 07/11/2026 — mig 378) ─────────────────────────
// O Instagram não manda telefone: o cliente do Direct é o IGSID (o id dele no Instagram, para este app). A ficha do Direct
// prova que o robô fala com ESTE cliente desta empresa — o "chamar atendente" só abre o caso do Direct com ela. A chave é
// derivada com OUTRO rótulo e o corpo tem `g` (não `f`): a ficha do telefone nunca vale como a do Direct, e vice-versa —
// as rotas que leem pedido e cadastro pelo telefone (`lerConversa`) recusam a do Direct.

function chaveDoDirect(): Buffer | null {
  const s = (process.env.BOT_RESOLVER_SECRET ?? '').trim();
  return s ? createHmac('sha256', s).update('regem:conversa-do-direct:v1').digest() : null;
}

/** O IGSID que vale: só dígitos (5 a 32). */
export const IGSID_RE = /^[0-9]{5,32}$/;

/** A ficha para a mensagem deste cliente do Direct nesta empresa (ou `null` sem a senha do robô configurada). */
export function assinarConversaDoDirect(tenantId: string, igsid: unknown, agora = Date.now()): string | null {
  const k = chaveDoDirect();
  const g = String(igsid ?? '');
  if (!k || !tenantId || !IGSID_RE.test(g)) return null;
  const corpo = Buffer.from(JSON.stringify({ t: tenantId, g, e: agora + VALIDADE_DA_CONVERSA_MS })).toString('base64url');
  return `${corpo}.${createHmac('sha256', k).update(corpo).digest('base64url')}`;
}

export type ConversaDoDirect = { tenantId: string; igsid: string };

/** A conversa do Direct da ficha, se a assinatura confere e ela não venceu; senão `null` (quem chama recusa com 401). */
export function lerConversaDoDirect(ficha: unknown, agora = Date.now()): ConversaDoDirect | null {
  const k = chaveDoDirect();
  if (!k) return null;
  const [corpo, assinatura, sobra] = String(ficha ?? '').trim().split('.');
  if (!corpo || !assinatura || sobra !== undefined) return null;
  const esperada = createHmac('sha256', k).update(corpo).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  let d: any;
  try {
    d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof d?.t !== 'string' || typeof d?.g !== 'string' || d?.f !== undefined || !IGSID_RE.test(d.g) || !(Number(d?.e) > agora)) return null;
  return { tenantId: d.t, igsid: d.g };
}

/**
 * A chave do Direct que o robô repassa no lugar do telefone (`ig:<igsid>`) e no lugar da instância (`ig:<conta>`). As
 * rotas de TELEFONE recusam qualquer valor `ig:` de propósito: tirando o `ig:`, sobram dígitos que a busca pelos últimos
 * dígitos do telefone casaria com o pedido de um desconhecido.
 */
export function ehChaveDoDirect(v: unknown): boolean {
  return typeof v === 'string' && v.trim().toLowerCase().startsWith('ig:');
}

// ───────────────────────── a conversa de TESTE do atendente (F4 do atendente virtual, mig 382) ─────────────────────────
// "Testar o atendente": o gerente conversa com o MESMO robô (o fluxo do n8n e as instruções do Regem) como se fosse um
// cliente. A mensagem vai com a chave `teste:<id da conversa de teste>` na instância e no `de` — o mesmo truque do Direct
// (`ig:`): nada muda no n8n. A chave só resolve pela linha de `atendente_teste` (a empresa vem dela) e NUNCA age sobre
// conversa, cliente ou pedido de verdade: as rotas de telefone recusam qualquer valor `teste:` (tirando o prefixo, sobram
// os dígitos do id, que a busca pelos últimos dígitos do telefone casaria com o pedido de um desconhecido). Por isso a
// mensagem de teste vai SEM a ficha da conversa (`conversa: null`): assinar o `de` daria uma ficha de "telefone" com os
// dígitos do id.

/** O prefixo da chave de teste. */
export const PREFIXO_DO_TESTE = 'teste:';
const UUID_DO_TESTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O valor COMEÇA com `teste:`? Qualquer forma conta (mesmo com o id torto): é o que as rotas de telefone e de envio usam
 * para recusar — uma chave de teste nunca cai no caminho do telefone. Se ela é uma conversa de teste que vale, quem diz é
 * `idDaChaveDeTeste`.
 */
export function ehChaveDeTeste(v: unknown): boolean {
  return typeof v === 'string' && v.trim().toLowerCase().startsWith(PREFIXO_DO_TESTE);
}

/** O id da conversa de teste da chave — só `teste:` + um uuid; qualquer outra forma = null (não é uma conversa de teste). */
export function idDaChaveDeTeste(v: unknown): string | null {
  if (!ehChaveDeTeste(v)) return null;
  const id = (v as string).trim().slice(PREFIXO_DO_TESTE.length);
  return UUID_DO_TESTE.test(id) ? id.toLowerCase() : null;
}

/** A chave que a conversa de teste usa na instância e no `de`. */
export const chaveDoTeste = (id: string): string => `${PREFIXO_DO_TESTE}${id}`;
