import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno } from '../../db/schema';
import { condUnidadeOuRede } from '../../common/filtro-unidade';

// TOTEM EM DINHEIRO ESPERANDO PAGAMENTO — o pedido que o cliente fez no totem para pagar no
// balcão e que ainda não foi cobrado. Pedido do dono (02/10/2026): passou de 8 minutos, com a
// loja em "produzir só depois de pagar", o PDV avisa.
//
// É SÓ LEITURA, para o aviso: não cancela, não aceita, não muda o pedido. Quem decide o que
// fazer (receber ou cancelar) é o operador, na tela Retirada / Encomendas.
//
// O mesmo recorte do cartão em aprovação (`totem-retido.query.ts`), com a forma invertida:
//  • canal do totem, ainda `novo`, não pago e sem comanda (não virou venda);
//  • forma DINHEIRO — pedido de totem sem forma gravada é o de dinheiro de antes do retido;
//  • fora: o cartão/PIX em aprovação (paga no totem e expira sozinho em 5 min).

/** Minutos sem pagar a partir dos quais o PDV avisa. */
export const MINUTOS_ALERTA_TOTEM = 8;
/**
 * Só o movimento do turno: pedido esquecido há mais que isto não é mais "cliente esperando no
 * balcão" — é pendência antiga, que aparece (e se baixa) ao fechar o turno.
 */
export const HORAS_JANELA_ALERTA_TOTEM = 12;
const CANAIS_TOTEM = ['totem', 'gogem'];
const LIMITE = 20;

export interface TotemAPagar {
  id: string;
  /** A senha que o cliente leva impressa (é por ela que o operador acha o pedido). */
  senha: string | null;
  clienteNome: string | null;
  total: number;
  criadoEm: Date;
  minutos: number;
}

export async function totemDinheiroSemPagar(
  db: DrizzleDB,
  tenantId: string,
  unidadeId: string | null,
  agora = new Date(),
  minutos = MINUTOS_ALERTA_TOTEM,
): Promise<TotemAPagar[]> {
  const corte = new Date(agora.getTime() - minutos * 60_000);
  const janela = new Date(agora.getTime() - HORAS_JANELA_ALERTA_TOTEM * 3_600_000);
  const linhas = await db
    .select({
      id: pedidoExterno.id,
      displayId: pedidoExterno.displayId,
      numero: pedidoExterno.numero,
      clienteNome: pedidoExterno.clienteNome,
      total: pedidoExterno.total,
      criadoEm: pedidoExterno.criadoEm,
    })
    .from(pedidoExterno)
    .where(
      and(
        eq(pedidoExterno.tenantId, tenantId),
        condUnidadeOuRede(pedidoExterno.unidadeId, unidadeId),
        inArray(pedidoExterno.canal, CANAIS_TOTEM),
        eq(pedidoExterno.status, 'novo'),
        eq(pedidoExterno.pago, false),
        isNull(pedidoExterno.comandaId),
        sql`lower(trim(coalesce(${pedidoExterno.formaPagamento}, 'dinheiro'))) = 'dinheiro'`,
        lt(pedidoExterno.criadoEm, corte),
        gte(pedidoExterno.criadoEm, janela),
      ),
    )
    // o que espera há mais tempo primeiro
    .orderBy(asc(pedidoExterno.criadoEm), asc(pedidoExterno.id))
    .limit(LIMITE);
  return linhas.map((p) => ({
    id: p.id,
    senha: p.displayId ? String(p.displayId).replace(/^#/, '') : p.numero != null ? String(p.numero) : null,
    clienteNome: p.clienteNome,
    total: Number(p.total) || 0,
    criadoEm: p.criadoEm,
    minutos: Math.floor((agora.getTime() - p.criadoEm.getTime()) / 60_000),
  }));
}
