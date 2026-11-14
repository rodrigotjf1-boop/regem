import { sql } from 'drizzle-orm';
import { brutoPedido } from '../../common/faturamento';
import { sqlUnidade, sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { FUSO_SQL, noPeriodo } from '../../common/fuso-sql';
import { GATEWAYS_DO_PIX } from '../../common/prazo-estorno-pix';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONCILIAÇÃO DO MISTER (F3.5): o que não fecha entre a VENDA, o DINHEIRO e a NOTA FISCAL num período, por loja. Só
// leitura. Cada parte é um sinal exato, e não estimativa (levantamento de 14/11/2026):
//  1. Pix pago em pedido cancelado sem o estorno feito — a MESMA condição da rotina do estorno (`estorno-pix.service.ts`,
//     V74: a `estorno-pix-pg.spec.ts` prova que as duas veem os mesmos pedidos).
//  2. Pedido cancelado com a venda ainda de pé (a comanda fechada): o cancelamento pelo canal não desfez a venda.
//  3. Pedido concluído sem o pagamento registrado: na prática, o pago na entrega que não passou pelo "FINALIZAR" — o
//     dinheiro ficou fora do caixa do Regem.
//  4. Venda desfeita com a nota fiscal ainda autorizada: fora do totem, cancelar a venda não cancela a nota.
//  5. Venda fechada com a nota recusada, denegada ou sem resposta, e nenhuma nota válida.
// O período é o da OPERAÇÃO (`noPeriodo`), pelo momento do fato de cada parte. Nada daqui grava.

/** Quantos exemplos cada parte devolve (os mais recentes). */
export const EXEMPLOS_DA_CONCILIACAO = 5;
/** Antes disto o "não fechou" pode ser só a rotina que ainda não passou (o estorno roda a cada minuto). */
export const FOLGA_DA_CONCILIACAO_MIN = 10;

export interface EscopoDaConciliacao {
  tenantId: string;
  /** A loja em uso (`@UnidadeAtual`); null = todas as da empresa. */
  unidade: string | null;
  /** O período, em horário da operação: 'AAAA-MM-DD HH:MM:SS'. */
  ini: string;
  fim: string;
}

export interface ParteDaConciliacao {
  quantos: number;
  valor: number;
  exemplos: any[];
}

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const parte = (total: any, exemplos: any[]): ParteDaConciliacao => ({ quantos: Number(total?.qtd) || 0, valor: numero(total?.valor), exemplos });

/**
 * 1) Pix pago em pedido cancelado sem o estorno feito: sem pedido de estorno há mais de 10 min, estorno que falhou, ou
 * pendente/processando parado há mais de 10 min. Mais o Pix do item posto depois (mig 373) que falhou ao estornar.
 */
export async function pixSemEstorno(db: any, e: EscopoDaConciliacao): Promise<ParteDaConciliacao & { adicionaisQueFalharam: number; valorDosAdicionais: number }> {
  const onde = sql`
    from pedido_externo pe
    left join pedido_estorno es on es.pedido_id = pe.id
   where pe.tenant_id = ${e.tenantId}::uuid and pe.deleted_at is null
     and pe.status = 'cancelado' and pe.pago and pe.status_pagamento = 'aprovado' and pe.gateway_payment_id is not null
     and pe.gateway_provider in (${sql.join(GATEWAYS_DO_PIX.map((g) => sql`${g}`), sql`, `)})
     and pe.sinal_status is null
     ${sqlUnidadeOuRede('pe.unidade_id', e.unidade)} and ${noPeriodo('pe.cancelado_em', e.ini, e.fim)}
     and pe.cancelado_em < now() - make_interval(mins => ${FOLGA_DA_CONCILIACAO_MIN})
     and (es.id is null or es.situacao = 'falhou'
          or (es.situacao in ('pendente', 'processando') and es.atualizado_em < now() - make_interval(mins => ${FOLGA_DA_CONCILIACAO_MIN})))`;
  const [total] = linhas(await db.execute(sql`select count(*)::int as qtd, coalesce(sum(pe.total), 0) as valor ${onde}`));
  const exemplos = linhas(
    await db.execute(sql`
      select pe.canal, pe.numero, pe.display_id as "displayId", pe.total as valor, pe.gateway_provider as provedor,
             to_char(pe.cancelado_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando,
             case when es.id is null then 'sem_pedido_de_estorno' when es.situacao = 'falhou' then 'estorno_falhou' else 'estorno_parado' end as situacao,
             es.erro
        ${onde}
       order by pe.cancelado_em desc
       limit ${EXEMPLOS_DA_CONCILIACAO}`),
  );
  // O Pix do item posto depois que falhou ao estornar (a tabela é a do adicional; o valor é só o do item).
  const adicionais = linhas(
    await db.execute(sql`
      select count(*)::int as qtd, coalesce(sum(a.valor), 0) as valor
        from pedido_adicional_pix a
        join pedido_externo pe on pe.id = a.pedido_id and pe.tenant_id = a.tenant_id
       where a.tenant_id = ${e.tenantId}::uuid and a.situacao = 'falhou'
         ${sqlUnidadeOuRede('pe.unidade_id', e.unidade)} and ${noPeriodo('a.atualizado_em', e.ini, e.fim)}`),
  );
  return { ...parte(total, exemplos), adicionaisQueFalharam: Number(adicionais[0]?.qtd) || 0, valorDosAdicionais: numero(adicionais[0]?.valor) };
}

/** 2) Pedido cancelado com a venda ainda de pé: a comanda dele continua fechada. */
export async function canceladoComVendaDePe(db: any, e: EscopoDaConciliacao): Promise<ParteDaConciliacao> {
  const onde = sql`
    from pedido_externo pe
    join comanda c on c.id = pe.comanda_id and c.tenant_id = pe.tenant_id
   where pe.tenant_id = ${e.tenantId}::uuid and pe.deleted_at is null and pe.status = 'cancelado' and c.status = 'fechada'
     ${sqlUnidadeOuRede('pe.unidade_id', e.unidade)} and ${noPeriodo('coalesce(pe.cancelado_em, pe.criado_em)', e.ini, e.fim)}
     and coalesce(pe.cancelado_em, pe.criado_em) < now() - make_interval(mins => ${FOLGA_DA_CONCILIACAO_MIN})`;
  const [total] = linhas(await db.execute(sql`select count(*)::int as qtd, coalesce(sum(${brutoPedido('pe')}), 0) as valor ${onde}`));
  const exemplos = linhas(
    await db.execute(sql`
      select pe.canal, pe.numero, pe.display_id as "displayId", ${brutoPedido('pe')} as valor,
             to_char(coalesce(pe.cancelado_em, pe.criado_em) at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
        ${onde}
       order by coalesce(pe.cancelado_em, pe.criado_em) desc
       limit ${EXEMPLOS_DA_CONCILIACAO}`),
  );
  return parte(total, exemplos);
}

/** 3) Pedido concluído sem o pagamento registrado (o pago na entrega que não passou pelo "FINALIZAR"), por canal. */
export async function concluidoSemPagamento(db: any, e: EscopoDaConciliacao): Promise<ParteDaConciliacao & { porCanal: Record<string, number> }> {
  const quando = 'coalesce(pe.concluido_em, pe.criado_em)';
  const onde = sql`
    from pedido_externo pe
   where pe.tenant_id = ${e.tenantId}::uuid and pe.deleted_at is null and pe.status = 'concluido' and not coalesce(pe.pago, false)
     ${sqlUnidadeOuRede('pe.unidade_id', e.unidade)} and ${noPeriodo(quando, e.ini, e.fim)}`;
  const [total] = linhas(await db.execute(sql`select count(*)::int as qtd, coalesce(sum(${brutoPedido('pe')}), 0) as valor ${onde}`));
  const porCanal = linhas(await db.execute(sql`select pe.canal, count(*)::int as qtd ${onde} group by 1 order by 2 desc, 1`));
  const exemplos = linhas(
    await db.execute(sql`
      select pe.canal, pe.numero, pe.display_id as "displayId", ${brutoPedido('pe')} as valor, pe.forma_pagamento as forma,
             to_char(${sql.raw(quando)} at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
        ${onde}
       order by ${sql.raw(quando)} desc
       limit ${EXEMPLOS_DA_CONCILIACAO}`),
  );
  return { ...parte(total, exemplos), porCanal: Object.fromEntries(porCanal.map((c) => [String(c.canal ?? 'outro'), Number(c.qtd) || 0])) };
}

/** 4) Venda desfeita com a nota fiscal ainda autorizada (a de teste, simulada, não conta). */
export async function vendaDesfeitaComNota(db: any, e: EscopoDaConciliacao): Promise<ParteDaConciliacao> {
  const quando = 'coalesce(c.cancelada_em, c.created_at)';
  const onde = sql`
    from comanda c
    join nota_fiscal n on n.comanda_id = c.id and n.tenant_id = c.tenant_id and n.status = 'autorizada' and not coalesce(n.simulada, false)
    left join pedido_externo pe on pe.comanda_id = c.id and pe.tenant_id = c.tenant_id
   where c.tenant_id = ${e.tenantId}::uuid and c.status = 'cancelada'
     ${sqlUnidade('c.unidade_id', e.unidade)} and ${noPeriodo(quando, e.ini, e.fim)}`;
  const [total] = linhas(await db.execute(sql`select count(*)::int as qtd, coalesce(sum(n.valor_total), 0) as valor ${onde}`));
  const exemplos = linhas(
    await db.execute(sql`
      select n.numero as "notaNumero", n.serie as "notaSerie", n.ambiente, n.valor_total as valor,
             pe.canal, pe.numero, pe.display_id as "displayId",
             to_char(${sql.raw(quando)} at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
        ${onde}
       order by ${sql.raw(quando)} desc
       limit ${EXEMPLOS_DA_CONCILIACAO}`),
  );
  return parte(total, exemplos);
}

/**
 * 5) Venda fechada cuja ÚLTIMA nota foi recusada, denegada ou está sem resposta há mais de 10 min, sem nenhuma nota válida
 * (autorizada ou em contingência). A de teste, simulada, não conta.
 */
export async function vendaComNotaComProblema(db: any, e: EscopoDaConciliacao): Promise<ParteDaConciliacao> {
  const onde = sql`
    from comanda c
    join lateral (
      select n.status, n.numero, n.serie, n.ambiente, n.motivo, n.valor_total, n.created_at from nota_fiscal n
       where n.comanda_id = c.id and n.tenant_id = c.tenant_id and not coalesce(n.simulada, false)
       order by n.created_at desc limit 1) n on true
    left join pedido_externo pe on pe.comanda_id = c.id and pe.tenant_id = c.tenant_id
   where c.tenant_id = ${e.tenantId}::uuid and c.status = 'fechada'
     ${sqlUnidade('c.unidade_id', e.unidade)} and ${noPeriodo('coalesce(c.fechada_em, c.created_at)', e.ini, e.fim)}
     and (n.status in ('rejeitada', 'denegada')
          or (n.status = 'pendente' and n.created_at < now() - make_interval(mins => ${FOLGA_DA_CONCILIACAO_MIN})))
     and not exists (select 1 from nota_fiscal v where v.comanda_id = c.id and v.tenant_id = c.tenant_id
                       and v.status in ('autorizada', 'contingencia') and not coalesce(v.simulada, false))`;
  const [total] = linhas(await db.execute(sql`select count(*)::int as qtd, coalesce(sum(c.total), 0) as valor ${onde}`));
  const exemplos = linhas(
    await db.execute(sql`
      select n.status as "situacaoDaNota", n.numero as "notaNumero", n.serie as "notaSerie", n.ambiente, left(n.motivo, 160) as motivo,
             c.total as valor, pe.canal, pe.numero, pe.display_id as "displayId",
             to_char(coalesce(c.fechada_em, c.created_at) at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
        ${onde}
       order by coalesce(c.fechada_em, c.created_at) desc
       limit ${EXEMPLOS_DA_CONCILIACAO}`),
  );
  return parte(total, exemplos);
}
