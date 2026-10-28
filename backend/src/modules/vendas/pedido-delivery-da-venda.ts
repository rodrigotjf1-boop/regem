import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O pedido de delivery de uma venda, como a tela do cupom mostra. */
export type PedidoDaVenda = { id: string; rotulo: string; canal: string; status: string };

const NOME_DO_CANAL: Record<string, string> = {
  ifood: 'iFood',
  '99food': '99 Food',
  anotaai: 'Anota AI',
  cardapio_web: 'Cardápio Web',
  rappi: 'Rappi',
  keeta: 'Keeta',
  delivery_direto: 'Delivery Direto',
};

/**
 * A venda é de um pedido de delivery AINDA EM ANDAMENTO (não concluído nem cancelado)? Então ela se cancela pelo painel
 * do delivery: lá o cancelamento avisa o canal (iFood, 99…), devolve o cashback e os pontos do cliente e tira o pedido
 * da tela. Cancelar a venda pelo PDV ("Cupons") deixava o pedido ativo no painel e no canal, sem nenhum estorno.
 *
 * Fica de fora o pedido do TOTEM: ele se cancela por aqui mesmo, com o aviso de estorno ao GoGeM. E o pedido já
 * concluído: o painel não cancela pedido concluído, e a venda dele segue cancelável aqui (devolução depois da entrega).
 *
 * `db` = o banco ou a transação do cancelamento.
 */
export async function pedidoDeliveryEmAndamento(db: any, tenantId: string, comandaId: string): Promise<PedidoDaVenda | null> {
  const r: any = await db.execute(sql`
    select id, canal, status, numero, display_id, external_id
      from pedido_externo
     where tenant_id = ${tenantId} and comanda_id = ${comandaId}
       and status not in ('cancelado', 'concluido')
       and canal not in ('totem', 'gogem')
     order by criado_em desc
     limit 1`);
  const p = (r.rows ?? r)[0];
  if (!p) return null;
  const numero = p.display_id ?? (p.numero != null ? String(p.numero) : null);
  const canal = NOME_DO_CANAL[String(p.canal)];
  const rotulo = [numero ? `#${numero}` : null, canal ? `(${canal})` : null].filter(Boolean).join(' ') || 'do cardápio';
  return { id: p.id, rotulo, canal: String(p.canal), status: String(p.status) };
}
