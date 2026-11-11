import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CANCELAMENTO PARCIAL DA 99 (aviso `orderPartialCancel` — auditoria do KDS de 11/11/2026, achado O8). Fonte: 99Food
// Open Platform, conferida em 11/11/2026:
//   • Order Webhooks › Event5 `orderPartialCancel`: "triggered when a portion of the order is canceled" — o corpo só traz
//     o `order_id`;
//   • Order API › Get Order Details: em cada item, `submit_refund_amount` = quantos saíram ("Amount −
//     submit_refund_amount = Actual number of items currently in order"); `price.refund_price` = o total devolvido.
// Até aqui o Regem tratava este aviso como o cancelamento do pedido INTEIRO: estornava a venda e tirava o pedido da
// cozinha — e o cliente ficava sem o resto. Agora: lê o detalhe (nunca o corpo do aviso — CL-3); a 99 cancelou o pedido
// (situação 9xx) ou não sobrou item → é cancelamento, pelo serviço de sempre; senão, a equipe recebe um caso "Mudança no
// pedido" com o que saiu. A venda não muda sozinha: tirar item de pedido já pago fica com a equipe (decisão 4A do pedido
// alterado, 03/11/2026).

export type ItemTirado99 = {
  /** O id do item no pedido da 99 (`mdu_id`; sem ele, o `app_item_id`). */
  mdu: string;
  nome: string;
  /** Quantos saíram. */
  quantidade: number;
  /** Quantos o cliente tinha pedido. */
  pedido: number;
};

export type CancelamentoParcial99 = {
  /** A 99 cancelou o pedido (situação 9xx) ou não sobrou item nenhum: é o cancelamento do pedido inteiro. */
  cancelado: boolean;
  tirados: ItemTirado99[];
  /** O total que a 99 devolveu ao cliente (R$), quando ela diz. */
  devolvido: number | null;
};

const inteiro = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

/** O cancelamento parcial lido do DETALHE do pedido (a resposta do `order/detail`, com ou sem o `order_info`). */
export function lerCancelamentoParcial(detalhe: any): CancelamentoParcial99 {
  const o = detalhe?.order_info ?? detalhe ?? {};
  const status = Number(o?.status);
  const itens: any[] = Array.isArray(o?.order_items) ? o.order_items : [];
  const tirados: ItemTirado99[] = [];
  let sobrou = false;
  itens.forEach((it, i) => {
    const pedido = inteiro(it?.amount);
    const saiu = Math.min(pedido, inteiro(it?.submit_refund_amount));
    if (pedido - saiu > 0) sobrou = true;
    if (saiu > 0)
      tirados.push({
        mdu: String(it?.mdu_id ?? it?.app_item_id ?? `item-${i}`),
        nome: String(it?.name ?? '').trim() || 'Item',
        quantidade: saiu,
        pedido,
      });
  });
  // Os códigos 901–981 da tabela "Order Status" da doc são todos de cancelamento.
  const canceladoNa99 = Number.isFinite(status) && status >= 900 && status < 1000;
  const centavos = Number(o?.price?.refund_price);
  return {
    cancelado: canceladoNa99 || (itens.length > 0 && !sobrou),
    tirados,
    devolvido: Number.isFinite(centavos) && centavos > 0 ? Math.round(centavos) / 100 : null,
  };
}

/**
 * A chave do caso (`externo_id`): o pedido e o que saiu até agora. A 99 reenviando o mesmo aviso não abre outro caso; a 99
 * tirando MAIS um item depois abre um caso novo, com tudo o que saiu. Os pedidos do cliente usam o `apply_id` (só dígitos)
 * — o prefixo não deixa as chaves se encontrarem.
 */
export function chaveDoParcial(pedidoExterno: string, tirados: ItemTirado99[]): string {
  const assinatura = tirados
    .map((t) => `${t.mdu}:${t.quantidade}`)
    .sort()
    .join(',');
  return `parcial-${pedidoExterno}-${createHash('sha256').update(assinatura).digest('hex').slice(0, 16)}`;
}

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

/** O texto do caso, como a equipe lê na central ("O que o cliente precisa") e no app de atendimento. */
export function mensagemDoParcial(c: CancelamentoParcial99): string {
  const linhas = ['A 99 cancelou parte do pedido.'];
  if (c.tirados.length) {
    const itens = c.tirados.map((t) => `${t.quantidade}× ${t.nome}${t.pedido > t.quantidade ? ` (ficam ${t.pedido - t.quantidade})` : ''}`);
    linhas.push(`Saiu: ${itens.join('; ')}.`);
  } else {
    linhas.push('O detalhe da 99 não diz o que saiu: confira o pedido no portal da 99.');
  }
  if (c.devolvido != null) linhas.push(`A 99 devolveu ${brl(c.devolvido)} ao cliente.`);
  linhas.push('Avise a cozinha e quem embala para não mandar o que saiu. A venda no Regem não muda sozinha.');
  return linhas.join('\n');
}

type Emitir = (evento: string, dados: any) => unknown;

/** Situações do pedido em que ele ainda está na loja (a cozinha e quem embala ainda podem deixar de mandar o item). */
const NA_LOJA = ['novo', 'confirmado', 'pronto'];

/**
 * Abre o caso "Mudança no pedido" (canal '99food') do cancelamento parcial, uma vez só por pedido e por "o que saiu" —
 * índice único por empresa, canal e `externo_id` (mig 351). Urgente enquanto o pedido está na loja. `achou = false`: o
 * pedido ainda não chegou ao Regem — a 99 reenvia o aviso (ERR-061).
 */
export async function registrarCancelamentoParcial(
  db: any,
  emitir: Emitir,
  ig: { tenantId: string; unidadeId: string | null },
  pedidoExterno: string,
  c: CancelamentoParcial99,
): Promise<{ achou: boolean; aberto: boolean; id: string | null }> {
  const ped: any = ((
    await db.execute(sql`
      select id, unidade_id, numero, cliente_nome, status from pedido_externo
       where tenant_id = ${ig.tenantId} and canal = '99food' and external_id = ${pedidoExterno}
       order by criado_em
       limit 1`)
  ).rows ?? [])[0];
  if (!ped) return { achou: false, aberto: false, id: null };
  const prioridade = NA_LOJA.includes(String(ped.status)) ? 'urgente' : 'normal';
  const detalhe = { plataforma: '99food', parcial99: { pedidoExterno, tirados: c.tirados, devolvido: c.devolvido } };
  const r: any = await db.execute(sql`
    insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_id, pedido_numero, mensagem,
                                     prioridade, externo_id, detalhe, status)
    values (${ig.tenantId}, ${ped.unidade_id ?? ig.unidadeId ?? null}, 'mudanca', '99food', ${ped.cliente_nome ?? null},
            ${ped.id}, ${ped.numero != null ? String(ped.numero) : null}, ${mensagemDoParcial(c)},
            ${prioridade}, ${chaveDoParcial(pedidoExterno, c.tirados)}, ${JSON.stringify(detalhe)}::jsonb, 'aberto')
    on conflict (tenant_id, canal, externo_id) where externo_id is not null do nothing
    returning *`);
  const row = (r.rows ?? r)[0];
  if (row) emitir('atendimento.novo', { tenantId: ig.tenantId, chamado: row });
  return { achou: true, aberto: !!row, id: row?.id ?? null };
}
