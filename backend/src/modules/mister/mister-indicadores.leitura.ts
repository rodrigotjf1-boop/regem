import { sql, type SQL } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { brutoPedido, comandaEhDeCanal, descontoLojaProduto, faturamentoComanda, faturamentoPedido, pedidoVale } from '../../common/faturamento';
import { lerCustosMedios } from '../../common/custo-loja';
import { sqlUnidade } from '../../common/filtro-unidade';
import { FUSO_SQL, noPeriodo } from '../../common/fuso-sql';
import { carregarEstruturaDasFichas } from '../fichas/fichas-carga';
import {
  type CadastroDeCusto,
  type DadoInformado,
  type FichaDoCusto,
  type GrupoDeVenda,
  type LeituraDoPrazo,
  type LeituraDoReceber,
  type LinhaDaFicha,
  type ProdutoDoCusto,
  type SaidaDoMes,
  calculadoraDeFichas,
} from './mister-indicadores';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS LEITURAS DOS INDICADORES DO MISTER (versão 7, V7f). Cada uma é uma consulta por conjunto, presa à empresa e à loja, com o
// período no relógio da loja. A venda do período NÃO é somada aqui: vem de `linhasDaVendaOficial`. O que se lê daqui é como essa
// venda se divide entre os produtos, pelas MESMAS regras do que conta (a comanda da loja que não veio de canal; a do pedido que vale).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export type TipoDoDado = 'saldo_banco' | 'folha_mensal' | 'custo_campanha';

// ───────────────────────────── o cadastro de custo ─────────────────────────────

/**
 * Tudo o que o custo precisa, em poucas consultas e para a empresa inteira (nunca uma por produto): as fichas, os produtos (também
 * os excluídos: a venda antiga aponta para eles), as variações e o custo médio de cada item, no cadastro e por loja.
 */
export async function lerCadastroDeCusto(db: DrizzleDB, tenantId: string): Promise<CadastroDeCusto> {
  const { fichas, ings, fichaDoItem, mesmaEmbalagem } = await carregarEstruturaDasFichas(db, tenantId);
  const porFicha = new Map<string, LinhaDaFicha[]>();
  for (const i of ings) {
    const lista = porFicha.get(i.fichaId) ?? [];
    lista.push({
      nome: String(i.insumoNome ?? ''),
      quantidade: numero(i.quantidade),
      fatorCorrecao: numero(i.fatorCorrecao),
      custoGravado: numero(i.custoUnitario),
      itemId: i.subFichaId ? null : (i.itemId ?? null),
      subFichaId: i.subFichaId ?? null,
      fichaDoItemId: !i.subFichaId && i.itemId ? (fichaDoItem.get(i.itemId) ?? null) : null,
      somenteDelivery: !!i.somenteDelivery,
      somenteBalcao: !!i.somenteBalcao,
    });
    porFicha.set(i.fichaId, lista);
  }
  const mapa = new Map<string, FichaDoCusto>();
  for (const f of fichas) mapa.set(f.id, { rendimento: numero(f.rendimento), margemPerda: numero(f.margemPerda), linhas: porFicha.get(f.id) ?? [] });

  const produtos = new Map<string, ProdutoDoCusto>();
  for (const p of linhas(await db.execute(sql`select id::text as id, nome, tipo, ficha_id::text as ficha, preco_custo as custo from produto where tenant_id = ${tenantId}::uuid`)))
    produtos.set(p.id, { nome: String(p.nome), tipo: String(p.tipo), fichaId: p.ficha ?? null, precoCusto: p.custo === null || p.custo === undefined ? null : numero(p.custo) });
  const fatores = new Map<string, number>();
  for (const v of linhas(await db.execute(sql`select id::text as id, fator_ficha as fator from produto_variacao where tenant_id = ${tenantId}::uuid`))) fatores.set(v.id, numero(v.fator));
  // A mesma leitura da tela de fichas: o custo da loja, se houver; senão, o do cadastro.
  const custoDoItem = await lerCustosMedios(db, tenantId);
  return { produtos, fatores, custoDaFicha: calculadoraDeFichas(mapa, custoDoItem, mesmaEmbalagem) };
}

// ───────────────────────────── a venda por produto ─────────────────────────────

/**
 * Divide a venda de produto de cada comanda entre as linhas dela, proporcional ao valor de cada uma. Assim o desconto bancado pela
 * loja fica rateado, e a taxa de entrega e a de serviço ficam de fora (não têm custo de mercadoria).
 */
async function agruparLinhas(db: DrizzleDB, tenantId: string, venda: SQL): Promise<GrupoDeVenda[]> {
  const r = await db.execute(sql`
    with venda as (${venda}),
    linha as (
      select v.unidade_id, v.canal, v.base, ci.produto_id, ci.variacao_id, ci.descricao, ci.quantidade,
             greatest(ci.quantidade * ci.preco_unitario, 0) as bruto,
             sum(greatest(ci.quantidade * ci.preco_unitario, 0)) over (partition by v.comanda_id, v.canal) as bruto_da_venda,
             exists (
               select 1
                 from comanda_item_complemento cx
                 left join complemento_opcao co on co.id = cx.opcao_id and co.tenant_id = cx.tenant_id
                 left join opcao o on o.id = co.origem_opcao_id and o.tenant_id = cx.tenant_id
                where cx.comanda_item_id = ci.id and cx.tenant_id = ci.tenant_id and cx.tipo <> 'remover'
                  and (cx.preco_delta <> 0 or cx.item_id is not null or cx.produto_ref_id is not null or (o.tipo = 'ficha' and o.ficha_id is not null))
             ) as com_adicional
        from venda v
        join comanda_item ci on ci.comanda_id = v.comanda_id and ci.tenant_id = ${tenantId}::uuid
       where ci.quantidade > 0
    )
    select produto_id::text as produto, variacao_id::text as variacao, unidade_id::text as loja, canal, com_adicional,
           min(descricao) as descricao, sum(quantidade) as quantidade,
           coalesce(sum(case when bruto_da_venda > 0 then round(base * bruto / bruto_da_venda * 100) else 0 end), 0)::bigint as centavos
      from linha
     group by 1, 2, 3, 4, 5`);
  return linhas(r).map((l) => ({
    produtoId: l.produto ?? null,
    variacaoId: l.variacao ?? null,
    unidadeId: l.loja ?? null,
    canal: l.canal === 'delivery' ? 'delivery' : 'balcao',
    comAdicional: l.com_adicional === true,
    descricao: String(l.descricao ?? ''),
    quantidade: numero(l.quantidade),
    centavos: numero(l.centavos),
  }));
}

/** As vendas que contam na conta oficial do período, por produto. */
export function lerVendaPorProduto(db: DrizzleDB, o: { tenantId: string; atual: string | null; de: string; ate: string }): Promise<GrupoDeVenda[]> {
  const ini = `${o.de} 00:00:00`;
  const fim = `${o.ate} 23:59:59`;
  return agruparLinhas(
    db,
    o.tenantId,
    sql`
      select c.id as comanda_id, c.unidade_id, 'balcao'::text as canal, ${faturamentoComanda('c')} as base
        from comanda c
       where c.tenant_id = ${o.tenantId} ${sqlUnidade('c.unidade_id', o.atual)} and c.status = 'fechada'
         and ${noPeriodo('c.fechada_em', ini, fim)} and not ${comandaEhDeCanal('c')}
      union all
      select pe.comanda_id, pe.unidade_id, 'delivery'::text, greatest(${brutoPedido('pe')} - ${descontoLojaProduto('pe')}, 0)
        from pedido_externo pe
       where pe.tenant_id = ${o.tenantId} ${sqlUnidade('pe.unidade_id', o.atual)} and ${pedidoVale('pe')}
         and pe.comanda_id is not null and ${noPeriodo('pe.criado_em', ini, fim)}`,
  );
}

/**
 * A venda de produto do período, com as mesmas regras do que conta: é sobre ela que a cobertura se mede. A taxa de entrega e a de
 * serviço ficam fora (não têm custo de mercadoria), e o pedido sem itens gravados fica dentro (ele não tem custo conhecido).
 */
export async function lerTotalDeProduto(db: DrizzleDB, o: { tenantId: string; atual: string | null; de: string; ate: string }): Promise<number> {
  const ini = `${o.de} 00:00:00`;
  const fim = `${o.ate} 23:59:59`;
  const [l] = linhas(
    await db.execute(sql`
      select coalesce(sum(round(base * 100)), 0)::bigint as centavos from (
        select ${faturamentoComanda('c')} as base
          from comanda c
         where c.tenant_id = ${o.tenantId} ${sqlUnidade('c.unidade_id', o.atual)} and c.status = 'fechada'
           and ${noPeriodo('c.fechada_em', ini, fim)} and not ${comandaEhDeCanal('c')}
        union all
        select greatest(${brutoPedido('pe')} - ${descontoLojaProduto('pe')}, 0)
          from pedido_externo pe
         where pe.tenant_id = ${o.tenantId} ${sqlUnidade('pe.unidade_id', o.atual)} and ${pedidoVale('pe')}
           and ${noPeriodo('pe.criado_em', ini, fim)}
      ) x`),
  );
  return numero(l?.centavos);
}

// ───────────────────────────── contas a receber e a pagar ─────────────────────────────

export async function lerReceber(db: DrizzleDB, o: { tenantId: string; atual: string | null; hoje: string }): Promise<LeituraDoReceber> {
  const [l] = linhas(
    await db.execute(sql`
      select count(*)::int as abertas,
             coalesce(sum(round(t.valor * 100)), 0)::bigint as total,
             count(*) filter (where t.vencimento < ${o.hoje}::date)::int as vencidas,
             coalesce(sum(round(t.valor * 100)) filter (where t.vencimento < ${o.hoje}::date), 0)::bigint as vencido,
             (min(t.vencimento) filter (where t.vencimento < ${o.hoje}::date))::text as antiga
        from titulo_financeiro t
       where t.tenant_id = ${o.tenantId}::uuid and t.tipo = 'receber' and t.status = 'aberto' and t.valor > 0 ${sqlUnidade('t.unidade_id', o.atual)}`),
  );
  return { abertas: numero(l?.abertas), totalCentavos: numero(l?.total), vencidas: numero(l?.vencidas), vencidoCentavos: numero(l?.vencido), maisAntiga: l?.antiga ?? null };
}

/**
 * Os dias entre a compra (o recebimento da mercadoria) ou a criação da conta e o pagamento, pela DATA do lançamento de caixa que
 * vale (sem estorno). Cada conta conta uma vez.
 */
export async function lerPrazo(db: DrizzleDB, o: { tenantId: string; atual: string | null; de: string; ate: string }): Promise<LeituraDoPrazo> {
  const [l] = linhas(
    await db.execute(sql`
      with pago as (
        select t.id, coalesce(r.data, (t.created_at at time zone ${FUSO_SQL})::date) as inicio, max(c.data) as pagou
          from titulo_financeiro t
          join lancamento_caixa c on c.titulo_id = t.id and c.tenant_id = t.tenant_id and c.tipo = 'saida' and c.estorno_de is null
          left join recebimento r on t.origem = 'recebimento' and r.id = t.origem_id and r.tenant_id = t.tenant_id
         where t.tenant_id = ${o.tenantId}::uuid and t.tipo = 'pagar' and t.status = 'pago' ${sqlUnidade('t.unidade_id', o.atual)}
           and not exists (select 1 from lancamento_caixa e where e.tenant_id = c.tenant_id and e.estorno_de = c.id)
         group by t.id, r.data, t.created_at
      )
      select count(*)::int as titulos, avg(greatest(pagou - inicio, 0))::float8 as media
        from pago where pagou between ${o.de}::date and ${o.ate}::date`),
  );
  const titulos = numero(l?.titulos);
  return { titulos, mediaDias: titulos ? numero(l?.media) : null };
}

/** As saídas de um mês, da empresa inteira, por categoria. Fora o estorno e o lançamento que foi estornado. */
export async function lerSaidas(db: DrizzleDB, o: { tenantId: string; de: string; ate: string }): Promise<SaidaDoMes[]> {
  const r = await db.execute(sql`
    select coalesce(c.categoria, '') as categoria, coalesce(sum(round(c.valor * 100)), 0)::bigint as centavos
      from lancamento_caixa c
     where c.tenant_id = ${o.tenantId}::uuid and c.tipo = 'saida' and c.estorno_de is null
       and c.data between ${o.de}::date and ${o.ate}::date
       and not exists (select 1 from lancamento_caixa e where e.tenant_id = c.tenant_id and e.estorno_de = c.id)
     group by 1`);
  return linhas(r).map((l) => ({ categoria: String(l.categoria), centavos: numero(l.centavos) }));
}

// ───────────────────────────── a campanha ─────────────────────────────

export interface CampanhaDoRoi {
  id: string;
  cupom: string;
  /** AAAA-MM-DD, no relógio da loja. */
  desde: string;
}

const DA_CAMPANHA = sql`id::text as id, cupom_codigo as cupom, to_char(criado_em at time zone ${FUSO_SQL}, 'YYYY-MM-DD') as desde`;

/** As últimas campanhas com cupom: sem cupom não há como saber quais vendas vieram dela. */
export async function listarCampanhasComCupom(db: DrizzleDB, tenantId: string, limite = 8): Promise<CampanhaDoRoi[]> {
  const r = await db.execute(sql`
    select ${DA_CAMPANHA} from campanha
     where tenant_id = ${tenantId}::uuid and nullif(btrim(cupom_codigo), '') is not null
     order by criado_em desc, id limit ${limite}`);
  return linhas(r).map((c) => ({ id: c.id, cupom: String(c.cupom), desde: String(c.desde) }));
}

/** A campanha pelo código do cupom (sem diferença de caixa). Com o mesmo cupom em mais de uma, a mais nova. */
export async function acharCampanha(db: DrizzleDB, tenantId: string, cupom: string): Promise<CampanhaDoRoi | null> {
  const r = await db.execute(sql`
    select ${DA_CAMPANHA} from campanha
     where tenant_id = ${tenantId}::uuid and upper(btrim(cupom_codigo)) = upper(btrim(${cupom}))
     order by criado_em desc, id limit 1`);
  const c = linhas(r)[0];
  return c ? { id: c.id, cupom: String(c.cupom), desde: String(c.desde) } : null;
}

/**
 * Os pedidos da campanha: os que usaram o cupom dela, da criação até o fim dela (ou até a próxima campanha com o mesmo cupom), cada
 * um UMA vez (o `cupom_uso` pode repetir o pedido), só os que valem na conta oficial e na loja da pessoa.
 */
function pedidosDaCampanha(o: { tenantId: string; atual: string | null; campanhaId: string }): SQL {
  return sql`
    select distinct cu.pedido_id
      from campanha cp
      join cupom cc on cc.tenant_id = cp.tenant_id and upper(btrim(cc.codigo)) = upper(btrim(cp.cupom_codigo))
      join cupom_uso cu on cu.cupom_id = cc.id and cu.tenant_id = cp.tenant_id and cu.pedido_id is not null
     where cp.id = ${o.campanhaId}::uuid and cp.tenant_id = ${o.tenantId}::uuid
       and cu.usado_em >= cp.criado_em
       and (cp.termina_em is null or cu.usado_em <= cp.termina_em)
       and not exists (
         select 1 from campanha prox
          where prox.tenant_id = cp.tenant_id and upper(btrim(prox.cupom_codigo)) = upper(btrim(cp.cupom_codigo))
            and prox.criado_em > cp.criado_em and prox.criado_em <= cu.usado_em)`;
}

export async function lerVendasDaCampanha(
  db: DrizzleDB,
  o: { tenantId: string; atual: string | null; campanhaId: string },
): Promise<{ pedidos: number; faturamentoCentavos: number; baseCentavos: number; grupos: GrupoDeVenda[] }> {
  const usados = pedidosDaCampanha(o);
  const [t] = linhas(
    await db.execute(sql`
      select count(*)::int as pedidos,
             coalesce(sum(round(${faturamentoPedido('pe')} * 100)), 0)::bigint as faturamento,
             coalesce(sum(round(greatest(${brutoPedido('pe')} - ${descontoLojaProduto('pe')}, 0) * 100)), 0)::bigint as base
        from pedido_externo pe
       where pe.tenant_id = ${o.tenantId} ${sqlUnidade('pe.unidade_id', o.atual)} and ${pedidoVale('pe')}
         and pe.id in (${usados})`),
  );
  const pedidos = numero(t?.pedidos);
  if (!pedidos) return { pedidos: 0, faturamentoCentavos: 0, baseCentavos: 0, grupos: [] };
  const grupos = await agruparLinhas(
    db,
    o.tenantId,
    sql`
      select pe.comanda_id, pe.unidade_id, 'delivery'::text as canal, greatest(${brutoPedido('pe')} - ${descontoLojaProduto('pe')}, 0) as base
        from pedido_externo pe
       where pe.tenant_id = ${o.tenantId} ${sqlUnidade('pe.unidade_id', o.atual)} and ${pedidoVale('pe')}
         and pe.comanda_id is not null and pe.id in (${usados})`,
  );
  return { pedidos, faturamentoCentavos: numero(t?.faturamento), baseCentavos: numero(t?.base), grupos };
}

// ───────────────────────────── o que veio da conversa ─────────────────────────────

const dadoDe = (l: any): DadoInformado | null => (l ? { centavos: numero(l.centavos), dia: String(l.dia) } : null);

/** O último saldo e a última folha da empresa. A validade do saldo é do indicador (`saldoVale`). */
export async function lerSaldoEFolha(db: DrizzleDB, tenantId: string): Promise<{ saldo: DadoInformado | null; folha: DadoInformado | null }> {
  const r = linhas(
    await db.execute(sql`
      select distinct on (tipo) tipo, valor_centavos as centavos, data_referencia::text as dia
        from mister_dado_informado
       where tenant_id = ${tenantId}::uuid and tipo in ('saldo_banco', 'folha_mensal')
       order by tipo, data_referencia desc, criado_em desc, id`),
  );
  return { saldo: dadoDe(r.find((x) => x.tipo === 'saldo_banco')), folha: dadoDe(r.find((x) => x.tipo === 'folha_mensal')) };
}

export async function lerCustoDaCampanha(db: DrizzleDB, tenantId: string, campanhaId: string): Promise<number | null> {
  const [l] = linhas(
    await db.execute(sql`
      select valor_centavos as centavos from mister_dado_informado
       where tenant_id = ${tenantId}::uuid and tipo = 'custo_campanha' and campanha_id = ${campanhaId}::uuid
       order by criado_em desc, id limit 1`),
  );
  return l ? numero(l.centavos) : null;
}

/**
 * Grava o que a pessoa informou, UMA vez por toque (a chave). Devolve se a linha com aquela chave existe e tem o valor pedido:
 * é a conferência do efeito, e vale também para o segundo toque, que não grava nada.
 */
export async function gravarDadoInformado(
  db: DrizzleDB,
  d: { tenantId: string; tipo: TipoDoDado; centavos: number; dia: string; quem: string; campanhaId: string | null; chave: string },
): Promise<boolean> {
  await db.execute(sql`
    insert into mister_dado_informado (tenant_id, tipo, valor_centavos, data_referencia, informado_por, campanha_id, chave)
    values (${d.tenantId}::uuid, ${d.tipo}, ${d.centavos}::bigint, ${d.dia}::date, ${d.quem}::uuid, ${d.campanhaId}::uuid, ${d.chave})
    on conflict (tenant_id, chave) do nothing`);
  const [l] = linhas(await db.execute(sql`select valor_centavos as centavos, tipo from mister_dado_informado where tenant_id = ${d.tenantId}::uuid and chave = ${d.chave}`));
  return !!l && numero(l.centavos) === d.centavos && texto(l.tipo) === d.tipo;
}
