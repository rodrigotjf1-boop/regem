import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno } from '../../db/schema';
import { condUnidadeOuRede } from '../../common/filtro-unidade';

// TOTEM EM DINHEIRO ESPERANDO PAGAMENTO — o pedido que o cliente fez no totem para pagar no
// balcão e que ainda não foi cobrado. É de onde saem o ícone com a contagem e o aviso do PDV.
//   • 02/10/2026: passou de 8 minutos, com a loja em "produzir só depois de pagar", o PDV avisava.
//   • 16/11/2026 (pedido do dono): o ícone aparece JÁ na chegada, em todos os PDVs, e conta também
//     o pedido que a loja manda para a cozinha antes de cobrar (já aceito, em preparo ou PRONTO) —
//     o pronto e não pago é o mais urgente: a comida está no balcão e ninguém cobrou.
//
// É SÓ LEITURA, para o aviso: não cancela, não aceita, não muda o pedido. Quem decide o que
// fazer (receber ou cancelar) é o operador, na tela Retirada / Encomendas.
//
// O recorte:
//  • canal do totem, não pago, forma DINHEIRO — pedido de totem sem forma gravada é o de dinheiro
//    de antes do retido; fora o cartão/PIX em aprovação (paga no totem e expira sozinho em 5 min);
//  • `novo` sem comanda (esperando o "Receber pagamento") OU já aceito, em preparo ou pronto
//    (a loja produz antes de cobrar e cobra no "Cobrar e entregar");
//  • fora: concluído, cancelado, apagado.

/** Minutos sem pagar a partir dos quais o pedido passa a "atrasado" (a faixa do PDV). */
export const MINUTOS_ALERTA_TOTEM = 8;
/**
 * Só o movimento do turno: pedido esquecido há mais que isto não é mais "cliente esperando no
 * balcão" — é pendência antiga, que aparece (e se baixa) ao fechar o turno.
 */
export const HORAS_JANELA_ALERTA_TOTEM = 12;
const CANAIS_TOTEM = ['totem', 'gogem'];
const LIMITE = 30;

export interface TotemAPagar {
  id: string;
  /** A senha que o cliente leva impressa (é por ela que o operador acha o pedido). */
  senha: string | null;
  clienteNome: string | null;
  total: number;
  criadoEm: Date;
  minutos: number;
  /** novo (esperando o "Receber pagamento") | confirmado (na cozinha) | pronto. */
  status: string;
  /** A cozinha terminou e ninguém cobrou: o caso que pede o aviso na hora. */
  pronto: boolean;
  /** Espera há mais de `MINUTOS_ALERTA_TOTEM`. */
  atrasado: boolean;
}

export async function totemDinheiroAPagar(
  db: DrizzleDB,
  tenantId: string,
  unidadeId: string | null,
  agora = new Date(),
): Promise<TotemAPagar[]> {
  const janela = new Date(agora.getTime() - HORAS_JANELA_ALERTA_TOTEM * 3_600_000);
  const linhas = await db
    .select({
      id: pedidoExterno.id,
      displayId: pedidoExterno.displayId,
      numero: pedidoExterno.numero,
      clienteNome: pedidoExterno.clienteNome,
      total: pedidoExterno.total,
      criadoEm: pedidoExterno.criadoEm,
      status: pedidoExterno.status,
    })
    .from(pedidoExterno)
    .where(
      and(
        eq(pedidoExterno.tenantId, tenantId),
        condUnidadeOuRede(pedidoExterno.unidadeId, unidadeId),
        inArray(pedidoExterno.canal, CANAIS_TOTEM),
        eq(pedidoExterno.pago, false),
        isNull(pedidoExterno.deletedAt),
        sql`lower(trim(coalesce(${pedidoExterno.formaPagamento}, 'dinheiro'))) = 'dinheiro'`,
        or(
          and(eq(pedidoExterno.status, 'novo'), isNull(pedidoExterno.comandaId)),
          inArray(pedidoExterno.status, ['confirmado', 'pronto']),
        ),
        gte(pedidoExterno.criadoEm, janela),
      ),
    )
    // o pronto e não pago primeiro; depois o que espera há mais tempo
    .orderBy(sql`(${pedidoExterno.status} = 'pronto') desc`, asc(pedidoExterno.criadoEm), asc(pedidoExterno.id))
    .limit(LIMITE);
  return linhas.map((p) => {
    const minutos = Math.max(0, Math.floor((agora.getTime() - p.criadoEm.getTime()) / 60_000));
    return {
      id: p.id,
      senha: p.displayId ? String(p.displayId).replace(/^#/, '') : p.numero != null ? String(p.numero) : null,
      clienteNome: p.clienteNome,
      total: Number(p.total) || 0,
      criadoEm: p.criadoEm,
      minutos,
      status: p.status,
      pronto: p.status === 'pronto',
      atrasado: minutos >= MINUTOS_ALERTA_TOTEM,
    };
  });
}
