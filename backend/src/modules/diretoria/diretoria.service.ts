import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  comandaEhDeCanal,
  faturamentoComanda,
  faturamentoPedido,
  gorjetaComanda,
  gorjetaPedido,
  pedidoVale,
} from '../../common/faturamento';
import { sqlLojasDoItem, sqlMinimoDaLoja } from '../../common/custo-loja';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class DiretoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private async rows(query: SQL): Promise<any[]> {
    const r: any = await this.db.execute(query);
    return r.rows ?? r;
  }

  // Consolida métricas por unidade (mês corrente p/ tarefas e desperdício;
  // snapshot de hoje p/ escala e estoque). Restrito à diretoria.
  async multiunidade(tenantId: string) {
    const unidades = await this.rows(sql`
      select id, nome from unidade
      where tenant_id = ${tenantId} and deleted_at is null order by nome`);

    const tarefas = await this.rows(sql`
      select unidade_id,
             count(*) as total,
             count(*) filter (where estado = 'feita') as feitas
      from tarefa_instancia
      where tenant_id = ${tenantId}
        and data >= date_trunc('month', current_date) and deleted_at is null
      group by unidade_id`);

    const desp = await this.rows(sql`
      select unidade_id, count(*) as total, coalesce(sum(quantidade), 0) as qtd
      from desperdicio
      where tenant_id = ${tenantId}
        and data >= date_trunc('month', current_date) and deleted_at is null
      group by unidade_id`);

    const escala = await this.rows(sql`
      select unidade_id, count(*) as vagas, count(colaborador_id) as preenchidas
      from escala_alocacao
      where tenant_id = ${tenantId} and data = current_date and deleted_at is null
      group by unidade_id`);

    const estoque = await this.rows(sql`
      -- POR LOJA (mig 253). Antes agrupava pela loja do INSUMO somando os movimentos de
      -- todas: insumo compartilhado caía na linha "sem loja" e não contava em loja nenhuma,
      -- e o saldo era o das duas juntas. Agora cada insumo é avaliado em cada loja que o usa,
      -- com o saldo dela.
      -- Mínimo DA LOJA (mig 257): o de cada uma, não o do cadastro.
      select u.uid as unidade_id, count(*) as total
        from item_estoque i
        ${sqlLojasDoItem(null)}
        cross join lateral (
          select coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                  when 'saida'   then -m.quantidade
                                  else m.quantidade end), 0) as saldo
            from movimento_estoque m
           where m.item_id = i.id and m.unidade_id = u.uid
        ) mv
       where i.tenant_id = ${tenantId} and i.deleted_at is null
         and u.uid is not null and mv.saldo < ${sqlMinimoDaLoja}
       group by u.uid`);

    // Faturamento do mês por loja, na definição única (ver `common/faturamento.ts`):
    // balcão + canais, cada um contado uma vez. Antes somava só `comanda.total`, que
    // (a) embutia a gorjeta do garçom como receita e (b) para pedido de canal continha
    // apenas os itens — a taxa de entrega da loja ficava de fora da Visão C&O.
    const vendas = await this.rows(sql`
      select unidade_id,
             coalesce(sum(faturado),0) as faturado,
             coalesce(sum(gorjeta),0)  as gorjeta,
             coalesce(sum(qtd),0)::int as vendas
      from (
        select c.unidade_id,
               ${faturamentoComanda('c')} as faturado,
               ${gorjetaComanda('c')}     as gorjeta,
               1 as qtd
          from comanda c
         where c.tenant_id = ${tenantId} and c.status = 'fechada'
           and c.fechada_em >= date_trunc('month', current_date)
           and not ${comandaEhDeCanal('c')}
        union all
        select pe.unidade_id,
               ${faturamentoPedido('pe')} as faturado,
               ${gorjetaPedido('pe')}     as gorjeta,
               1 as qtd
          from pedido_externo pe
         where pe.tenant_id = ${tenantId} and ${pedidoVale('pe')}
           and pe.criado_em >= date_trunc('month', current_date)
      ) u
      group by unidade_id`);

    const by = (arr: any[], id: string) => arr.find((r) => r.unidade_id === id);

    const linhas = unidades.map((u: any) => {
      const t = by(tarefas, u.id);
      const total = Number(t?.total ?? 0);
      const feitas = Number(t?.feitas ?? 0);
      const d = by(desp, u.id);
      const e = by(escala, u.id);
      const es = by(estoque, u.id);
      const v = by(vendas, u.id);
      return {
        id: u.id,
        nome: u.nome,
        faturamento: Number(Number(v?.faturado ?? 0).toFixed(2)),
        // Gorjeta: passa pelo caixa da loja, mas é repasse ao funcionário — fora do
        // faturamento. Exposta para a diretoria enxergar o valor em separado.
        gorjeta: Number(Number(v?.gorjeta ?? 0).toFixed(2)),
        vendas: Number(v?.vendas ?? 0),
        tarefas: { total, feitas, pct: total ? Math.round((feitas / total) * 100) : 0 },
        desperdicio: { total: Number(d?.total ?? 0), quantidade: Number(d?.qtd ?? 0) },
        escala: { vagas: Number(e?.vagas ?? 0), preenchidas: Number(e?.preenchidas ?? 0) },
        estoqueAbaixoMinimo: Number(es?.total ?? 0),
      };
    });

    // Consolidado da rede (KPIs do topo).
    const soma = (f: (l: any) => number) => linhas.reduce((s, l) => s + f(l), 0);
    const conclTotal = soma((l) => l.tarefas.total);
    const conclFeitas = soma((l) => l.tarefas.feitas);
    const rede = {
      faturamento: Number(soma((l) => l.faturamento).toFixed(2)),
      gorjeta: Number(soma((l) => l.gorjeta).toFixed(2)),
      vendas: soma((l) => l.vendas),
      desperdicios: soma((l) => l.desperdicio.total),
      conclusaoMedia: conclTotal ? Math.round((conclFeitas / conclTotal) * 100) : 0,
      estoqueCritico: soma((l) => l.estoqueAbaixoMinimo),
      lojas: linhas.length,
    };

    return { unidades: linhas, rede };
  }
}
