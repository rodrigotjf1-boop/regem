import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O QUE O iFOOD MANDA E O REGEM AINDA NÃO TRATA (09/11/2026, ERR-421). O poller confirmava e jogava fora, sem rastro, todo
// evento fora da lista dele — inclusive a mudança de endereço (DAR) e o pedido alterado (OPA), que a doc "Order events"
// documenta, e o que o iFood manda quando a loja aceita no Gestor o pedido do cliente de "adicionar observação" (que a doc
// não traz). Agora cada um vai à telemetria da distribuição (`telemetria_evento`, só nuvem): uma linha por empresa e
// código, com a contagem e a FORMA do último (os nomes dos campos e os tipos de mudança) — nunca os valores (endereço,
// texto do cliente). É o que falta para tratar cada um pelo caminho certo.

/** Os códigos que o poller trata (doc "Order events"). */
export const EVENTOS_TRATADOS = new Set([
  'PLC', 'PLACED', 'CFM', 'CONFIRMED', 'RTP', 'READY_TO_PICKUP', 'DSP', 'DISPATCHED', 'CON', 'CONCLUDED',
  'CAN', 'CANCELLED', 'HSD', 'HANDSHAKE_DISPUTE', 'HSS', 'HANDSHAKE_SETTLEMENT',
]);

/** Só informativos para o Regem: confirmados sem anotar (o andamento do entregador do iFood, o preparo, o pedido de cancelar). */
export const EVENTOS_SO_INFORMATIVOS = new Set([
  'SPS', 'SEPARATION_STARTED', 'SPE', 'SEPARATION_ENDED', 'CAR', 'CANCELLATION_REQUESTED', 'CARF', 'CANCELLATION_REQUEST_FAILED',
  'ADR', 'ASSIGN_DRIVER', 'GTO', 'GOING_TO_ORIGIN', 'AAO', 'ARRIVED_AT_ORIGIN', 'CLT', 'COLLECTED', 'AAD', 'ARRIVED_AT_DESTINATION',
  'RPS', 'RECOMMENDED_PREPARATION_START', 'PRS', 'PREPARATION_STARTED', 'DGAC', 'DELIVERY_GROUP_ASSOCIATED', 'KEEPALIVE',
]);

const codigoDe = (ev: any) => String(ev?.code ?? ev?.fullCode ?? '').toUpperCase();

/** Vai à telemetria? Todo código que o poller não trata e que não é só informativo (o desconhecido também). */
export function deveAnotar(ev: any): boolean {
  const c = codigoDe(ev);
  const f = String(ev?.fullCode ?? '').toUpperCase();
  if (!c) return false;
  return !EVENTOS_TRATADOS.has(c) && !EVENTOS_TRATADOS.has(f) && !EVENTOS_SO_INFORMATIVOS.has(c) && !EVENTOS_SO_INFORMATIVOS.has(f);
}

export type FormaDoEvento = { code: string; fullCode: string; campos: string[]; mudancas: string[] };

/**
 * A FORMA do evento, sem nenhum valor: os nomes dos campos do `metadata` (e um nível dentro — de objeto e do 1º item de
 * lista) e os `changeType` das mudanças (`metadata.changes[]`, como no ORDER_PATCHED).
 */
export function formaDoEvento(ev: any): FormaDoEvento {
  const m = ev?.metadata && typeof ev.metadata === 'object' && !Array.isArray(ev.metadata) ? ev.metadata : {};
  const campos: string[] = [];
  for (const [k, v] of Object.entries(m)) {
    campos.push(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k2 of Object.keys(v)) campos.push(`${k}.${k2}`);
    else if (Array.isArray(v) && v[0] && typeof v[0] === 'object') for (const k2 of Object.keys(v[0])) campos.push(`${k}[].${k2}`);
  }
  const mudancas = (Array.isArray((m as any).changes) ? (m as any).changes : [])
    .map((c: any) => String(c?.changeType ?? '').slice(0, 40))
    .filter(Boolean);
  return {
    code: String(ev?.code ?? '').toUpperCase().slice(0, 40),
    fullCode: String(ev?.fullCode ?? '').toUpperCase().slice(0, 80),
    campos: campos.slice(0, 60).map((c) => c.slice(0, 80)),
    mudancas: [...new Set<string>(mudancas)].slice(0, 20),
  };
}

/**
 * Anota na telemetria (origem 'ifood', nível aviso). Uma linha por empresa e código (o mesmo índice de repetição da
 * telemetria: `coalesce(tenant_id, …), hash`), que soma as ocorrências e guarda a forma e o pedido da última. Nunca
 * rejeita: anotar é diagnóstico, não segura a confirmação de leitura do evento.
 */
export async function anotarEventoNaoTratado(
  db: any,
  ig: { tenantId: string; unidadeId: string | null },
  ev: any,
  aviso: (m: string) => void = () => undefined,
): Promise<boolean> {
  try {
    const f = formaDoEvento(ev);
    const codigo = f.fullCode || f.code;
    const tipo = 'ifood_evento_nao_tratado';
    const mensagem = `O iFood mandou o evento ${codigo}${f.code && f.fullCode && f.code !== f.fullCode ? ` (${f.code})` : ''} e o Regem ainda não trata`;
    const hash = createHash('sha256').update(`ifood|${tipo}|${codigo}`).digest('hex').slice(0, 32);
    const contexto = {
      ...f,
      pedido: ev?.orderId ? String(ev.orderId).slice(0, 64) : null,
      em: ev?.createdAt ? String(ev.createdAt).slice(0, 40) : null,
    };
    await db.execute(sql`
      insert into telemetria_evento (tenant_id, unidade_id, origem, nivel, tipo, mensagem, hash, contexto)
      values (${ig.tenantId}, ${ig.unidadeId ?? null}, 'ifood', 'warn', ${tipo}, ${mensagem}, ${hash}, ${JSON.stringify(contexto)}::jsonb)
      on conflict (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), hash) do update
        set ocorrencias = telemetria_evento.ocorrencias + 1, ultimo_em = now(), resolvido = false,
            contexto = excluded.contexto`);
    return true;
  } catch (e: any) {
    aviso(`telemetria do evento ${codigoDe(ev)} do iFood não gravada: ${e?.message ?? e}`);
    return false;
  }
}
