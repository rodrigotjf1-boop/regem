import { and, eq, isNull, sql } from 'drizzle-orm';
import { pedidoExterno } from '../../db/schema';

// R4 — quem está VENCIDO esperando pagamento eletrônico.
//
// Separado do serviço porque é uma consulta que CANCELA pedido de cliente: um filtro a
// menos aqui e o job passa a cancelar venda boa. Tem teste contra Postgres real.
//
// Fica de fora, de propósito:
//  • DINHEIRO — o cliente está indo até o caixa, e a fila pode passar de 5 min;
//  • pedido já pago, já virado comanda, ou já cancelado;
//  • qualquer canal que não seja o totem.
export async function retidosVencidos(
  db: any,
  minutos: number,
  limite = 100,
): Promise<{ id: string; tenantId: string }[]> {
  const corte = new Date(Date.now() - minutos * 60_000);
  return db
    .select({ id: pedidoExterno.id, tenantId: pedidoExterno.tenantId })
    .from(pedidoExterno)
    .where(
      and(
        eq(pedidoExterno.canal, 'totem'),
        eq(pedidoExterno.status, 'novo'),
        eq(pedidoExterno.pago, false),
        isNull(pedidoExterno.comandaId),
        sql`lower(coalesce(${pedidoExterno.formaPagamento}, '')) <> 'dinheiro'`,
        sql`${pedidoExterno.criadoEm} < ${corte}`,
      ),
    )
    .limit(limite);
}
