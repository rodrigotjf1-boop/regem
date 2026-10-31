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
