import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { brutoPedido, comandaEhDeCanal, pedidoVale } from '../../common/faturamento';
import { sqlUnidade, sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { noFuso, noPeriodo } from '../../common/fuso-sql';
import { MOTIVO_PERDA_CANCELAMENTO } from '../desperdicio/motivos';
import { GrupoDoCancelamento, ITENS_DO_PICO, ItemDoPico, LinhaDaContagem, LinhaDoDesperdicio, PARES_DO_PICO, ParDoPico, VIRADA_DO_DIA } from './mister-analises';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS LEITURAS DAS ANÁLISES DO MISTER (versão 7, V7e). Só o que a conta oficial não traz: os itens da faixa de pico, os
// cancelamentos por motivo e a mercadoria perdida. Cada uma é UMA consulta por conjunto (nada de consulta por dia), presa à
// empresa e à loja, com o período no relógio da loja. A venda em si NÃO é somada aqui: vem de `linhasDaVendaOficial`.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
/** Teto de grupos lidos dos cancelamentos: o total vem de outra conta e o que passar disto entra em "outros". */
export const MAX_GRUPOS_DE_CANCELAMENTO = 3000;
/** Teto de linhas da mercadoria perdida: uma por item do cadastro (e unidade ou loja), para a soma nunca ficar pela metade. */
export const MAX_ITENS_DA_MERCADORIA = 5000;
/** A comida perdida num cancelamento é gravada sem item, com o motivo fixo: entra com este nome, nunca com o texto do registro. */
export const ITEM_DA_PERDA_NO_CANCELAMENTO = 'Comida perdida em cancelamentos';

/**
 * Os itens e os pares da faixa de pico: as vendas que CONTAM na conta oficial (a comanda da loja, pela hora em que fechou; a do
 * pedido de canal que vale, pela hora em que ele chegou), nos dias de trabalho e nas horas pedidos. Um par conta uma vez por
 * pedido, em qualquer quantidade.
 */
export async function lerItensDaFaixa(
  db: DrizzleDB,
  o: { tenantId: string; atual: string | null; de: string; ate: string; dias: string[]; horas: number[] },
): Promise<{ itens: ItemDoPico[]; pares: ParDoPico[]; pedidosComItens: number }> {
  if (!o.dias.length || !o.horas.length) return { itens: [], pares: [], pedidosComItens: 0 };
  const ini = `${o.de} 00:00:00`;
  const fim = `${o.ate} 23:59:59`;
  const virada = sql.raw(`interval '${VIRADA_DO_DIA} hours'`);
  const diasSql = sql.join(o.dias.map((d) => sql`${d}::date`), sql`, `);
  const horasSql = sql.join(o.horas.map((h) => sql`${h}::int`), sql`, `);
  const base = sql`
    with venda as (
      select c.id as comanda_id, ${noFuso('c.fechada_em')} as quando
        from comanda c
       where c.tenant_id = ${o.tenantId} ${sqlUnidade('c.unidade_id', o.atual)} and c.status = 'fechada'
         and ${noPeriodo('c.fechada_em', ini, fim)} and not ${comandaEhDeCanal('c')}
      union all
      select pe.comanda_id, ${noFuso('pe.criado_em')}
        from pedido_externo pe
       where pe.tenant_id = ${o.tenantId} ${sqlUnidade('pe.unidade_id', o.atual)} and ${pedidoVale('pe')}
         and pe.comanda_id is not null and ${noPeriodo('pe.criado_em', ini, fim)}
    ),
    na_faixa as (
      select distinct comanda_id from venda
       where (quando - ${virada})::date in (${diasSql}) and extract(hour from quando)::int in (${horasSql})
    ),
    item as (
      select ci.comanda_id, trim(ci.descricao) as descricao, sum(ci.quantidade) as quantidade
        from comanda_item ci
        join na_faixa f on f.comanda_id = ci.comanda_id
       where ci.tenant_id = ${o.tenantId} and trim(ci.descricao) <> ''
       group by 1, 2
    )`;
  // Uma depois da outra: uma análise segura no máximo uma conexão do pool da API.
  const totais = await db.execute(sql`${base} select count(distinct comanda_id)::int as n from item`);
  const maisVendidos = await db.execute(sql`${base}
      select descricao as item, sum(quantidade) as quantidade, count(*)::int as pedidos
        from item group by 1 order by 2 desc, 1 limit ${ITENS_DO_PICO}`);
  const juntos = await db.execute(sql`${base}
      select a.descricao as a, b.descricao as b, count(*)::int as juntos
        from item a join item b on b.comanda_id = a.comanda_id and a.descricao < b.descricao
       group by 1, 2 order by 3 desc, 1, 2 limit ${PARES_DO_PICO}`);
  return {
    pedidosComItens: Number(linhas(totais)[0]?.n) || 0,
    itens: linhas(maisVendidos).map((l) => ({ item: String(l.item), quantidade: Number(l.quantidade) || 0, pedidos: Number(l.pedidos) || 0 })),
    pares: linhas(juntos).map((l) => ({ a: String(l.a), b: String(l.b), juntos: Number(l.juntos) || 0 })),
  };
}

/**
 * Os cancelamentos do período, com as MESMAS regras da consulta `cancelamentos`: o pedido de canal cancelado e a venda da loja
 * cancelada que não veio de canal, cada parte só com a permissão dela. Volta o texto do motivo para o classificador: ele NÃO
 * pode sair da análise.
 */
export async function lerCancelamentos(
  db: DrizzleDB,
  o: { tenantId: string; atual: string | null; de: string; ate: string; verPedidos: boolean; verVendas: boolean },
): Promise<{ total: { pedidos: number; centavos: number }; grupos: GrupoDoCancelamento[] }> {
  if (!o.verPedidos && !o.verVendas) return { total: { pedidos: 0, centavos: 0 }, grupos: [] };
  const ini = `${o.de} 00:00:00`;
  const fim = `${o.ate} 23:59:59`;
  const quandoPe = 'coalesce(pe.cancelado_em, pe.criado_em)';
  const quandoC = 'coalesce(c.cancelada_em, c.created_at)';
  const partes = [
    ...(o.verPedidos
      ? [
          sql`select left(pe.motivo_cancelamento, 200) as motivo, ${noFuso(quandoPe)} as quando, ${brutoPedido('pe')} as valor
                from pedido_externo pe
               where pe.tenant_id = ${o.tenantId} and pe.status = 'cancelado' and pe.deleted_at is null
                 ${sqlUnidadeOuRede('pe.unidade_id', o.atual)} and ${noPeriodo(quandoPe, ini, fim)}`,
        ]
      : []),
    ...(o.verVendas
      ? [
          sql`select left(c.motivo_cancelamento, 200) as motivo, ${noFuso(quandoC)} as quando, coalesce(c.total, 0) as valor
                from comanda c
               where c.tenant_id = ${o.tenantId} and c.status = 'cancelada' ${sqlUnidade('c.unidade_id', o.atual)}
                 and ${noPeriodo(quandoC, ini, fim)} and not ${comandaEhDeCanal('c')}`,
        ]
      : []),
  ];
  const uniao = sql.join(partes, sql` union all `);
  const tot = await db.execute(sql`select count(*)::int as pedidos, coalesce(sum(round(valor * 100)), 0)::bigint as centavos from (${uniao}) x`);
  const grupos = await db.execute(sql`
      select motivo, extract(dow from quando)::int as dow, extract(hour from quando)::int as hora,
             count(*)::int as pedidos, coalesce(sum(round(valor * 100)), 0)::bigint as centavos
        from (${uniao}) x
       group by 1, 2, 3
       order by 4 desc, 1, 2, 3
       limit ${MAX_GRUPOS_DE_CANCELAMENTO}`);
  const t = linhas(tot)[0];
  return {
    total: { pedidos: Number(t?.pedidos) || 0, centavos: Number(t?.centavos) || 0 },
    grupos: linhas(grupos).map((g) => ({ motivo: g.motivo, dow: Number(g.dow), hora: Number(g.hora), pedidos: Number(g.pedidos) || 0, centavos: Number(g.centavos) || 0 })),
  };
}

/**
 * O desperdício do período por item. O nome é o do CADASTRO: o registro sem item ligado (só com o texto da pessoa) entra num
 * grupo só, sem o texto. Registro sem custo (ou com custo zero) conta na quantidade e não no valor.
 */
export async function lerDesperdicio(db: DrizzleDB, o: { tenantId: string; atual: string | null; de: string; ate: string }): Promise<LinhaDoDesperdicio[]> {
  const r = await db.execute(sql`
    select coalesce(i.nome, case when d.motivo = ${MOTIVO_PERDA_CANCELAMENTO}::text then ${ITEM_DA_PERDA_NO_CANCELAMENTO}::text end) as item,
           coalesce(d.unidade_medida, i.unidade_medida) as unidade,
           count(*)::int as registros,
           coalesce(sum(d.quantidade), 0) as quantidade,
           coalesce(sum(case when d.custo_unitario > 0 and d.quantidade > 0 then round(d.quantidade * d.custo_unitario * 100) else 0 end), 0)::bigint as centavos,
           count(*) filter (where coalesce(d.custo_unitario, 0) <= 0 or coalesce(d.quantidade, 0) <= 0)::int as sem_custo
      from desperdicio d
      left join item_estoque i on i.id = d.item_id and i.tenant_id = d.tenant_id
     where d.tenant_id = ${o.tenantId} and d.deleted_at is null ${sqlUnidadeOuRede('d.unidade_id', o.atual)}
       and d.data between ${o.de}::date and ${o.ate}::date
     group by 1, 2
     order by 5 desc, 3 desc, 1
     limit ${MAX_ITENS_DA_MERCADORIA}`);
  return linhas(r).map((l) => ({
    item: l.item === null || l.item === undefined ? null : String(l.item),
    unidade: l.unidade ? String(l.unidade) : null,
    registros: Number(l.registros) || 0,
    quantidade: Number(l.quantidade) || 0,
    centavos: Number(l.centavos) || 0,
    semCusto: Number(l.sem_custo) || 0,
  }));
}

/**
 * A diferença das contagens concluídas no período, por item. Vale o ajuste que foi LANÇADO (é contra o saldo do instante da
 * contagem); sem ajuste, a diferença contra o saldo da abertura. O valor é pelo custo médio da loja da lista (ou do cadastro).
 */
export async function lerContagem(
  db: DrizzleDB,
  o: { tenantId: string; atual: string | null; de: string; ate: string },
): Promise<{ itensContados: number; linhas: LinhaDaContagem[] }> {
  const base = sql`
    with contado as (
      select ci.id, ci.item_id, l.unidade_id,
             coalesce(m.quantidade, ci.contado - ci.saldo_sistema) as diferenca
        from contagem_item ci
        join contagem_execucao e on e.id = ci.execucao_id and e.tenant_id = ci.tenant_id
        join contagem_lista l on l.id = e.lista_id and l.tenant_id = e.tenant_id
        left join lateral (
          select sum(mv.quantidade) as quantidade
            from movimento_estoque mv
           where mv.tenant_id = ci.tenant_id and mv.ref_tipo = 'contagem_item' and mv.ref_id = ci.id and mv.tipo = 'ajuste'
        ) m on true
       where ci.tenant_id = ${o.tenantId} and e.status = 'concluida' and ci.contado is not null
         and e.data between ${o.de}::date and ${o.ate}::date ${sqlUnidadeOuRede('l.unidade_id', o.atual)}
    )`;
  const tot = await db.execute(sql`${base} select count(*)::int as n from contado`);
  // Por item E loja: a falta de uma loja não se abate com a sobra de outra.
  const r = await db.execute(sql`${base}
      select i.nome as item, i.unidade_medida as unidade, sum(c.diferenca) as diferenca,
             case when coalesce(iu.custo_medio, i.custo_medio) > 0
                  then round(abs(sum(c.diferenca)) * coalesce(iu.custo_medio, i.custo_medio) * 100) end as centavos
        from contado c
        join item_estoque i on i.id = c.item_id and i.tenant_id = ${o.tenantId}
        left join item_estoque_unidade iu on iu.item_id = c.item_id and iu.unidade_id = c.unidade_id and iu.deleted_at is null
       group by i.id, i.nome, i.unidade_medida, c.unidade_id, iu.custo_medio, i.custo_medio
      having abs(sum(c.diferenca)) > 0.000001
       order by 4 desc nulls last, 1
       limit ${MAX_ITENS_DA_MERCADORIA}`);
  return {
    itensContados: Number(linhas(tot)[0]?.n) || 0,
    linhas: linhas(r).map((l) => ({
      item: String(l.item),
      unidade: l.unidade ? String(l.unidade) : null,
      diferenca: Number(l.diferenca) || 0,
      centavos: l.centavos === null || l.centavos === undefined ? null : Number(l.centavos),
    })),
  };
}
