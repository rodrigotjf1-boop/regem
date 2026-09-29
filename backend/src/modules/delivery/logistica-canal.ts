import { sql } from 'drizzle-orm';
import { STATUS_ENTREGA_99 } from '../integracoes/food99/entregador-99';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENTREGADOR DO PEDIDO DE MARKETPLACE como o canal vê (mig 294) — para o painel do delivery e o
// KDS. Lê `pedido_logistica`, que existe nos dois lados (a nuvem escreve, o servidor da loja recebe).

export type LogisticaResumo = {
  modo: 'logistica_canal' | 'propria_canal';
  canal: string;
  status: number | null;
  /** "chegou na loja", "saiu com o pedido"… (logística do canal) */
  situacao: string | null;
  entregadorNome: string | null;
  entregadorTelefone: string | null;
  chegadaLojaPrevista: string | null;
  /** Entrega da loja: quando o "saiu para entrega" foi avisado ao canal, ou por que não foi. */
  saidaAvisadaEm: string | null;
  saidaErro: string | null;
};

const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

export function resumoLogistica(l: any): LogisticaResumo {
  const status = l.status == null ? null : Number(l.status);
  return {
    modo: l.modo,
    canal: l.canal,
    status,
    situacao: status != null && l.canal === '99food' ? STATUS_ENTREGA_99[status] ?? null : null,
    entregadorNome: l.entregador_nome ?? null,
    entregadorTelefone: l.modo === 'logistica_canal' ? l.entregador_telefone ?? null : null,
    chegadaLojaPrevista: iso(l.chegada_loja_prevista),
    saidaAvisadaEm: iso(l.despacho_enviado_em),
    saidaErro: l.despacho_enviado_em ? null : l.despacho_erro ?? null,
  };
}

/** A logística de uma lista de pedidos (por id do pedido). Um literal de array (V31). */
export async function logisticaDosPedidos(db: any, tenantId: string, pedidoIds: string[]) {
  const mapa = new Map<string, LogisticaResumo>();
  const ids = [...new Set(pedidoIds.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))))];
  if (!ids.length) return mapa;
  const r: any = await db.execute(sql`
    select * from pedido_logistica
     where tenant_id = ${tenantId} and pedido_id = any(${`{${ids.join(',')}}`}::uuid[])`);
  for (const l of r.rows ?? r) mapa.set(String(l.pedido_id), resumoLogistica(l));
  return mapa;
}

/** A logística pelos pedidos das COMANDAS (o KDS enxerga a comanda, não o pedido externo). */
export async function logisticaDasComandas(db: any, tenantId: string, comandaIds: string[]) {
  const mapa = new Map<string, LogisticaResumo & { codigoColeta: string | null }>();
  const ids = [...new Set(comandaIds.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))))];
  if (!ids.length) return mapa;
  const r: any = await db.execute(sql`
    select l.*, p.comanda_id, p.raw->>'handover_code' as codigo_coleta
      from pedido_externo p
      join pedido_logistica l on l.pedido_id = p.id
     where p.tenant_id = ${tenantId} and p.comanda_id = any(${`{${ids.join(',')}}`}::uuid[])`);
  for (const l of r.rows ?? r)
    mapa.set(String(l.comanda_id), {
      ...resumoLogistica(l),
      // Código de 4 dígitos loja ↔ entregador da 99 na retirada do pedido (logística da 99).
      codigoColeta: l.modo === 'logistica_canal' && l.codigo_coleta ? String(l.codigo_coleta) : null,
    });
  return mapa;
}
