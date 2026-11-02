import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO DE CANCELAMENTO E DE REEMBOLSO DO CLIENTE DA 99 NA CENTRAL DE ATENDIMENTO (Onda 1, PR 3). Fonte: 99Food Open
// Platform (conferida em 02/11/2026) — Order Webhooks (`orderCancelApply`, `orderRefundApply`), Order API › Handle
// Cancellation Requests / Handle Refund Requests e Store API › Set Store Cancellation/Refund.
//   • CANCELAMENTO: chega com o que o cliente escreveu (`apply_reason`) e os motivos aceitos para recusar (`reason_list`).
//     A loja tem 5 min (a página do ajuste da loja diz 10); o aviso se repete a cada 2 min; sem resposta, a 99 RECUSA.
//   • REEMBOLSO: chega com o texto, as FOTOS (`images`) e os motivos de recusa com id (`base_reason_list`); o aviso se
//     repete de hora em hora por 24 h; sem resposta, a 99 ACEITA (reembolsa).
// Decisões do dono (01–02/11/2026): o cancelamento vai para a fila e, sem resposta, vale a recusa da própria 99 (o ajuste
// desligado faz o Regem aceitar na hora, como antes); o reembolso vai para a fila e, sem resposta no tempo do ajuste, o
// REGEM recusa com o motivo do ajuste (antes das 24 h). Só gerente e presidente respondem.

export type TipoDoPedido99 = 'cancelamento' | 'reembolso';

export type PedidoDoCliente99 = {
  tipo: TipoDoPedido99;
  pedidoExterno: string;
  applyId: string;
  motivoDoCliente: string | null;
  /** Cancelamento: os motivos que a 99 aceita na recusa (texto, como a 99 manda). */
  motivosDeRecusa: string[];
  /** Reembolso: os motivos de recusa com id (`base_reason_id` + `base_reason`). */
  motivosDoReembolso: Array<{ id: string; motivo: string }>;
  fotos: string[];
};

/** O ajuste da loja para a 99 (em `integracao.config.atendimento99`, só na nuvem). */
export type Ajuste99 = {
  /** Ligado (padrão): o pedido de cancelamento vai para a fila (sem resposta, a 99 recusa). Desligado: o Regem aceita. */
  decidirCancelamento: boolean;
  /** Em quantas horas sem resposta o Regem recusa o pedido de reembolso (1 a 20; a 99 reembolsa sozinha em 24 h). */
  reembolsoRecusarEmHoras: number;
  /** O motivo da recusa automática do reembolso, pelo NOME que a 99 manda (casa com a lista de cada pedido). */
  reembolsoMotivo: string;
  /** O texto que vai junto (`custom_reason`). */
  reembolsoExplicacao: string;
};

export const AJUSTE_99_PADRAO: Ajuste99 = {
  decidirCancelamento: true,
  reembolsoRecusarEmHoras: 4,
  reembolsoMotivo: 'Other',
  reembolsoExplicacao: 'Pedido conferido na saída',
};

export const HORAS_PERMITIDAS = [1, 2, 4, 8, 12, 20] as const;

/** O ajuste salvo, completado pelo padrão; valores fora do permitido voltam ao padrão. */
export function ajusteDa99(config: any): Ajuste99 {
  const a = config?.atendimento99 ?? {};
  const horas = Number(a.reembolsoRecusarEmHoras);
  return {
    decidirCancelamento: typeof a.decidirCancelamento === 'boolean' ? a.decidirCancelamento : AJUSTE_99_PADRAO.decidirCancelamento,
    reembolsoRecusarEmHoras: (HORAS_PERMITIDAS as readonly number[]).includes(horas) ? horas : AJUSTE_99_PADRAO.reembolsoRecusarEmHoras,
    reembolsoMotivo: typeof a.reembolsoMotivo === 'string' && a.reembolsoMotivo.trim() ? a.reembolsoMotivo.trim().slice(0, 120) : AJUSTE_99_PADRAO.reembolsoMotivo,
    reembolsoExplicacao: typeof a.reembolsoExplicacao === 'string' ? a.reembolsoExplicacao.trim().slice(0, 200) : AJUSTE_99_PADRAO.reembolsoExplicacao,
  };
}

/**
 * O motivo da recusa automática do reembolso, escolhido na lista QUE VEIO NESTE PEDIDO: o do ajuste (pelo nome); se não
 * veio, o "Other"; se nem ele, o último da lista (a 99 põe o "Other" no fim). Lista vazia: nenhum (não dá para recusar).
 */
export function motivoDaRecusaAutomatica(lista: Array<{ id: string; motivo: string }>, ajuste: Ajuste99): { id: string; motivo: string } | null {
  if (!lista.length) return null;
  const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return lista.find((m) => igual(m.motivo, ajuste.reembolsoMotivo)) ?? lista.find((m) => igual(m.motivo, 'Other')) ?? lista[lista.length - 1];
}

const texto = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/**
 * O pedido do cliente lido do CORPO CRU do aviso. Os ids (64 bits) vêm por expressão, como texto — nunca pelo JSON (que
 * os corromperia); o resto vem do JSON. Sem pedido ou sem `apply_id`: nada a registrar.
 */
export function lerPedidoDoCliente(raw: string, tipo: TipoDoPedido99): PedidoDoCliente99 | null {
  const pedidoExterno = (raw.match(/"order_id"\s*:\s*"?(\d+)"?/) || [])[1];
  const applyId = (raw.match(/"apply_id"\s*:\s*"?(\d+)"?/) || [])[1];
  if (!pedidoExterno || !applyId) return null;
  let d: any = {};
  try {
    d = JSON.parse(raw)?.data ?? {};
  } catch {
    /* corpo sem JSON válido: fica só com os ids */
  }
  const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  return {
    tipo,
    pedidoExterno,
    applyId,
    motivoDoCliente: texto(d.apply_reason),
    motivosDeRecusa: lista(d.reason_list).map((r) => String(r?.reason ?? '')).filter(Boolean),
    motivosDoReembolso: lista(d.base_reason_list)
      .map((r) => ({ id: String(r?.base_reason_id ?? ''), motivo: String(r?.base_reason ?? '') }))
      .filter((r) => r.id && r.motivo),
    fotos: lista(d.images).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 6),
  };
}

type Emitir = (evento: string, dados: any) => unknown;

/**
 * Abre o CASO do pedido do cliente (canal '99food'), uma vez só: a 99 reenvia o aviso (a cada 2 min no cancelamento, de
 * hora em hora no reembolso) — índice único por empresa, canal e `apply_id` (mig 351). Prazo: cancelamento = 5 min (o da
 * 99); reembolso = o tempo do ajuste (quando o Regem recusa). `resolvidoComo` = o caso já nasce resolvido (o ajuste
 * desligado: o Regem aceitou na hora). Devolve se abriu agora.
 */
export async function registrarPedidoDoCliente(
  db: any,
  emitir: Emitir,
  ig: { tenantId: string; unidadeId: string | null },
  p: PedidoDoCliente99,
  ajuste: Ajuste99,
  resolvidoComo: string | null = null,
): Promise<{ aberto: boolean; id: string | null }> {
  const ped: any = ((
    await db.execute(sql`
      select id, unidade_id, numero, display_id, cliente_nome from pedido_externo
       where tenant_id = ${ig.tenantId} and canal = '99food' and external_id = ${p.pedidoExterno}
       limit 1`)
  ).rows ?? [])[0];
  const prazoMs = p.tipo === 'cancelamento' ? 5 * 60_000 : ajuste.reembolsoRecusarEmHoras * 3_600_000;
  const prazo = resolvidoComo ? null : new Date(Date.now() + prazoMs).toISOString();
  const tipoDoCaso = p.tipo === 'cancelamento' ? 'cancelamento_99' : 'reembolso_99';
  const r: any = await db.execute(sql`
    insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_id, pedido_numero, mensagem,
                                     prioridade, prazo_em, externo_id, detalhe, status, decisao, resolvido_em)
    values (${ig.tenantId}, ${ped?.unidade_id ?? ig.unidadeId ?? null}, ${tipoDoCaso}, '99food', ${ped?.cliente_nome ?? null},
            ${ped?.id ?? null}, ${ped?.numero != null ? String(ped.numero) : null}, ${p.motivoDoCliente},
            'normal', ${prazo}, ${p.applyId}, ${JSON.stringify({ plataforma: '99food', pedido99: p })}::jsonb,
            ${resolvidoComo ? 'resolvido' : 'aberto'}, ${resolvidoComo}, ${resolvidoComo ? new Date().toISOString() : null})
    on conflict (tenant_id, canal, externo_id) where externo_id is not null do nothing
    returning *`);
  const row = (r.rows ?? r)[0];
  if (row && !resolvidoComo) emitir('atendimento.novo', { tenantId: ig.tenantId, chamado: row });
  return { aberto: !!row, id: row?.id ?? null };
}
