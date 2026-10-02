import { and, asc, eq, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno } from '../../db/schema';
import { condUnidadeOuRede } from '../../common/filtro-unidade';

// PENDÊNCIAS DO TURNO — os pedidos que ainda não foram baixados (concluídos ou cancelados) na hora
// de fechar o caixa. Decisão do dono (02/10/2026):
//   • turno do DELIVERY: só fecha sem entrega pendente (gerente/presidente pode fechar justificando);
//   • turno do BALCÃO: avisa das retiradas pendentes antes de fechar (não bloqueia).
// Funções sem estado: recebem o `db` e a hora. Não mexem em caixa, estoque, canal nem cliente.

/** Tudo o que ainda não acabou. `entregue` = o entregador marcou e falta a conferência do atendente. */
export const STATUS_PENDENTE = ['novo', 'confirmado', 'pronto', 'despachado', 'entregue'] as const;
/** Pedido parado há mais que isto é "antigo" (candidato à baixa administrativa). */
export const HORAS_PENDENCIA_ANTIGA = 24;
/** Quantos pedidos a tela recebe (a contagem é sempre a real). */
const LIMITE_LISTA = 100;
export const MOTIVO_BAIXA_NAO_ACEITO = 'Baixa administrativa: pedido antigo que não foi aceito';

export type EscopoTurno = 'delivery' | 'pdv';
/** O caixa do delivery cuida das ENTREGAS; o do balcão, das RETIRADAS. */
export const escopoDoTurno = (origem?: string | null): EscopoTurno => (origem === 'delivery' ? 'delivery' : 'pdv');

export interface PendenciaTurno {
  id: string;
  numero: string | null;
  canal: string;
  tipo: string;
  status: string;
  clienteNome: string | null;
  total: number;
  pago: boolean;
  criadoEm: Date;
  agendamento: Date | null;
  /** Parado há mais de 24 h. */
  antiga: boolean;
}

/**
 * A condição de "pendente no turno": da empresa (e da loja, ou sem loja — pedido de marketplace
 * chega sem unidade), não concluído nem cancelado, do tipo do turno, e que já devia ter
 * acontecido — encomenda agendada para mais tarde não é pendência deste turno.
 */
function condPendentes(tenantId: string, unidadeId: string | null, escopo: EscopoTurno, agora: Date): SQL {
  return and(
    eq(pedidoExterno.tenantId, tenantId),
    condUnidadeOuRede(pedidoExterno.unidadeId, unidadeId),
    inArray(pedidoExterno.status, [...STATUS_PENDENTE]),
    escopo === 'delivery' ? ne(pedidoExterno.tipo, 'retirada') : eq(pedidoExterno.tipo, 'retirada'),
    or(isNull(pedidoExterno.agendamento), lte(pedidoExterno.agendamento, agora)),
  ) as SQL;
}

/** O instante a partir do qual o pedido "está parado": a hora marcada, ou a de criação. */
const paradoDesde = sql`coalesce(${pedidoExterno.agendamento}, ${pedidoExterno.criadoEm})`;
const corteAntiga = (agora: Date) => new Date(agora.getTime() - HORAS_PENDENCIA_ANTIGA * 3_600_000);

export async function pendenciasDoTurno(db: DrizzleDB, tenantId: string, unidadeId: string | null, escopo: EscopoTurno, agora = new Date()) {
  const cond = condPendentes(tenantId, unidadeId, escopo, agora);
  const corte = corteAntiga(agora);
  const [conta] = await db
    .select({
      total: sql<number>`count(*)::int`,
      antigas: sql<number>`count(*) filter (where ${paradoDesde} < ${corte})::int`,
      // o que a baixa administrativa alcança: antigo e fora de rota
      baixaveis: sql<number>`count(*) filter (where ${paradoDesde} < ${corte} and ${pedidoExterno.status} not in ('despachado', 'entregue'))::int`,
    })
    .from(pedidoExterno)
    .where(cond);
  const linhas = await db
    .select({
      id: pedidoExterno.id,
      displayId: pedidoExterno.displayId,
      numero: pedidoExterno.numero,
      canal: pedidoExterno.canal,
      tipo: pedidoExterno.tipo,
      status: pedidoExterno.status,
      clienteNome: pedidoExterno.clienteNome,
      total: pedidoExterno.total,
      pago: pedidoExterno.pago,
      criadoEm: pedidoExterno.criadoEm,
      agendamento: pedidoExterno.agendamento,
    })
    .from(pedidoExterno)
    .where(cond)
    // os mais novos primeiro: são os que o operador ainda consegue resolver agora
    .orderBy(sql`${paradoDesde} desc`, asc(pedidoExterno.id))
    .limit(LIMITE_LISTA);
  const itens: PendenciaTurno[] = linhas.map((p) => ({
    id: p.id,
    numero: p.displayId ?? (p.numero != null ? String(p.numero) : null),
    canal: p.canal,
    tipo: p.tipo,
    status: p.status,
    clienteNome: p.clienteNome,
    total: Number(p.total) || 0,
    pago: p.pago,
    criadoEm: p.criadoEm,
    agendamento: p.agendamento,
    antiga: (p.agendamento ?? p.criadoEm).getTime() < corte.getTime(),
  }));
  return {
    escopo,
    total: conta?.total ?? 0,
    antigas: conta?.antigas ?? 0,
    baixaveis: conta?.baixaveis ?? 0,
    horasAntiga: HORAS_PENDENCIA_ANTIGA,
    itens,
  };
}

/**
 * BAIXA ADMINISTRATIVA das pendências antigas (paradas há mais de 24 h) — um clique do gestor,
 * duas instruções no banco, nada por pedido:
 *   • aceito e fora de rota (confirmado, pronto) → `concluido`;
 *   • nunca aceito (novo)                        → `cancelado`, com o motivo.
 * É só o registro do pedido que fecha. De propósito NÃO baixa estoque, NÃO lança nada no caixa,
 * NÃO avisa o canal nem o cliente: são pedidos que a loja resolveu fora do sistema há dias, e
 * refazer esses efeitos agora, às centenas, distorceria o estoque de hoje. Também não muda o
 * faturamento: os relatórios contam o pedido pela data de criação a partir do aceite — aceito
 * continua contando, não aceito continua fora. Pedido em rota (despachado/entregue) fica de fora:
 * tem entregador e acerto, e se resolve um a um.
 */
export async function baixarPendenciasAntigas(db: DrizzleDB, tenantId: string, unidadeId: string | null, escopo: EscopoTurno, agora = new Date()) {
  const corte = corteAntiga(agora);
  const base = and(condPendentes(tenantId, unidadeId, escopo, agora), lt(paradoDesde, corte)) as SQL;
  return db.transaction(async (tx) => {
    const concluidos = await tx
      .update(pedidoExterno)
      .set({ status: 'concluido', concluidoEm: agora, updatedAt: agora })
      .where(and(base, inArray(pedidoExterno.status, ['confirmado', 'pronto'])))
      .returning({ id: pedidoExterno.id, canal: pedidoExterno.canal });
    const cancelados = await tx
      .update(pedidoExterno)
      .set({ status: 'cancelado', canceladoEm: agora, motivoCancelamento: MOTIVO_BAIXA_NAO_ACEITO, updatedAt: agora })
      .where(and(base, eq(pedidoExterno.status, 'novo')))
      .returning({ id: pedidoExterno.id, canal: pedidoExterno.canal });
    const porCanal: Record<string, number> = {};
    for (const p of [...concluidos, ...cancelados]) porCanal[p.canal] = (porCanal[p.canal] ?? 0) + 1;
    return { concluidos: concluidos.length, cancelados: cancelados.length, porCanal, ids: [...concluidos, ...cancelados].map((p) => p.id) };
  });
}
