import { chaveTelefone } from './telefone-chave';

// O ECO DOS AVISOS AUTOMÁTICOS (F5 do robô, 31/10/2026 — ERR-332). Na API oficial em COEXISTÊNCIA, o que sai do número
// por OUTRO aparelho (o celular da loja, o WhatsApp Web ou a Evolution ligada por QR no mesmo número) volta ao Regem
// como "eco" (smb_message_echoes) — e o eco PAUSA o robô ("o dono respondeu pelo app"). Os avisos de pedido saem pelo
// fluxo do n8n, que pode mandar pela Evolution: no teste do dono, o "código de entrega" pausou o robô logo depois do
// pedido. Aqui o Regem anota para quem ACABOU de pedir um aviso automático; o eco que chega nos minutos seguintes para
// esse número não pausa o robô.
// Memória do processo, como `evolution-envios.ts` (a segunda trava de lá): se a API reiniciar no meio, o pior caso é o
// de antes — o eco pausa. Custo aceito: se a loja responder pelo celular nesses 3 minutos, o robô não pausa.

export const JANELA_DO_ECO_MS = 3 * 60_000;
const avisos = new Map<string, number>(); // empresa:chave do telefone → até quando

const chave = (tenantId: string, telefone: unknown) => {
  const t = chaveTelefone(telefone);
  return tenantId && t ? `${tenantId}:${t}` : null;
};

/** O Regem pediu um aviso automático (status, código de entrega) para este número agora. */
export function marcarAvisoAutomatico(tenantId: string, telefone: unknown, agora = Date.now()): void {
  const k = chave(tenantId, telefone);
  if (!k) return;
  if (avisos.size > 5000) for (const [x, ate] of avisos) if (ate <= agora) avisos.delete(x);
  avisos.set(k, agora + JANELA_DO_ECO_MS);
}

/** O eco que chegou para este número é, provavelmente, o de um aviso automático (não pausa o robô)? */
export function ecoDeAvisoAutomatico(tenantId: string, telefone: unknown, agora = Date.now()): boolean {
  const k = chave(tenantId, telefone);
  const ate = k ? avisos.get(k) : undefined;
  return !!ate && ate > agora;
}

/** Só para teste. */
export function esquecerAvisosAutomaticos(): void {
  avisos.clear();
}
