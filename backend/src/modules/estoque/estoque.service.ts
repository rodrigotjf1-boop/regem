import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { itemEstoque, movimentoEstoque, alertaEstoque } from '../../db/schema';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';
import { furoCmv } from '../../common/regras-negocio';

@Injectable()
export class EstoqueService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async createItem(tenantId: string, dto: CreateItemDto) {
    const [row] = await this.db
      .insert(itemEstoque)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        nome: dto.nome,
        unidadeMedida: dto.unidadeMedida ?? 'un',
        estoqueMinimo:
          dto.estoqueMinimo != null ? String(dto.estoqueMinimo) : undefined,
        categoria: dto.categoria,
      })
      .returning();
    return row;
  }

  // Saldo derivado do ledger (entrada +, saida -, ajuste sinalizado).
  async listItens(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select i.id, i.nome, i.unidade_medida as "unidadeMedida",
             i.estoque_minimo as "estoqueMinimo",
             i.custo_medio as "custoMedio",
             coalesce(sum(case m.tipo
               when 'entrada' then m.quantidade
               when 'saida'   then -m.quantidade
               else m.quantidade end), 0) as saldo
      from item_estoque i
      left join movimento_estoque m on m.item_id = i.id
      where i.tenant_id = ${tenantId} and i.deleted_at is null
      group by i.id
      order by i.nome
    `);
    const rows = res.rows ?? res;
    // Valor em estoque = saldo × custo médio (derivado, nunca armazenado).
    return rows.map((r: any) => ({
      ...r,
      valorEstoque: Number(r.saldo) * Number(r.custoMedio ?? 0),
    }));
  }

  async createMovimento(tenantId: string, dto: CreateMovimentoDto) {
    const [it] = await this.db
      .select({ id: itemEstoque.id })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.id, dto.itemId),
          eq(itemEstoque.tenantId, tenantId),
          isNull(itemEstoque.deletedAt),
        ),
      );
    if (!it) throw new BadRequestException('Item inválido para este tenant');

    const [row] = await this.db
      .insert(movimentoEstoque)
      .values({
        tenantId,
        itemId: dto.itemId,
        tipo: dto.tipo,
        quantidade: String(dto.quantidade),
        motivo: dto.motivo,
        data: dto.data,
      })
      .returning();
    return row;
  }

  listMovimentos(tenantId: string, itemId: string) {
    return this.db
      .select()
      .from(movimentoEstoque)
      .where(
        and(
          eq(movimentoEstoque.tenantId, tenantId),
          eq(movimentoEstoque.itemId, itemId),
        ),
      )
      .orderBy(desc(movimentoEstoque.createdAt));
  }

  // G2/G3/G4 — Inteligência de estoque (tudo derivado do ledger + custo médio).
  // Valorização (valor em estoque + compras), reposição (ROP) e curva ABC no período.
  // Lead time é POR FORNECEDOR (item.fornecedor_id → fornecedor.lead_time_dias);
  // item sem fornecedor cai no padrão.
  async inteligencia(tenantId: string, inicio: string, fim: string) {
    const LEAD_TIME_PADRAO = 7;
    const COBERTURA_ALVO_DIAS = 7;
    const res: any = await this.db.execute(sql`
      select i.id, i.nome, i.unidade_medida as "unidadeMedida",
             i.estoque_minimo as "estoqueMinimo", i.custo_medio as "custoMedio",
             i.dias_seguranca as "diasSeguranca",
             f.lead_time_dias as "leadTimeDias", f.nome as "fornecedorNome",
             coalesce(sum(case m.tipo when 'entrada' then m.quantidade
               when 'saida' then -m.quantidade else m.quantidade end),0) as saldo,
             coalesce(sum(case when m.tipo='saida' and m.data between ${inicio} and ${fim}
               then m.quantidade else 0 end),0) as "saidaPeriodo",
             coalesce(sum(case when m.tipo='entrada' and m.motivo='recebimento'
               and m.data between ${inicio} and ${fim}
               then m.quantidade * coalesce(m.custo_unitario, i.custo_medio) else 0 end),0) as "comprasValor"
      from item_estoque i
      left join fornecedor f on f.id = i.fornecedor_id and f.deleted_at is null
      left join movimento_estoque m on m.item_id = i.id
      where i.tenant_id = ${tenantId} and i.deleted_at is null
      group by i.id, f.lead_time_dias, f.nome
      order by i.nome
    `);
    const rows = res.rows ?? res;

    const d0 = new Date(inicio);
    const d1 = new Date(fim);
    const dias = Math.max(
      1,
      Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1,
    );

    let itens = rows.map((r: any) => {
      const saldo = Number(r.saldo);
      const custoMedio = Number(r.custoMedio ?? 0);
      const saidaPeriodo = Number(r.saidaPeriodo);
      const consumoDiario = saidaPeriodo / dias;
      const diasCobertura = consumoDiario > 0 ? saldo / consumoDiario : null;
      // §1.4: ES = CMD × dias_seguranca; ROP = CMD × lead_time + ES.
      // Lead time do fornecedor do item (fallback = padrão).
      const diasSeguranca = Number(r.diasSeguranca ?? 2);
      const leadTime = Number(r.leadTimeDias ?? LEAD_TIME_PADRAO);
      const es = consumoDiario * diasSeguranca;
      const rop = consumoDiario * leadTime + es;
      const qtdSugerida = Math.max(
        0,
        consumoDiario * COBERTURA_ALVO_DIAS + es - saldo,
      );
      return {
        id: r.id,
        nome: r.nome,
        unidadeMedida: r.unidadeMedida,
        estoqueMinimo: Number(r.estoqueMinimo ?? 0),
        custoMedio,
        saldo,
        valorEstoque: saldo * custoMedio,
        consumoDiario: Number(consumoDiario.toFixed(3)),
        diasCobertura: diasCobertura != null ? Number(diasCobertura.toFixed(1)) : null,
        valorConsumido: saidaPeriodo * custoMedio,
        estoqueSeguranca: Number(es.toFixed(2)),
        leadTime,
        fornecedorNome: r.fornecedorNome ?? null,
        rop: Number(rop.toFixed(2)),
        qtdSugerida: Number(qtdSugerida.toFixed(2)),
        repor: saldo <= rop && rop > 0,
        abaixoMinimo: saldo < Number(r.estoqueMinimo ?? 0),
        comprasValor: Number(r.comprasValor),
      };
    });

    // Curva ABC pelo valor consumido no período (A ≤80% acumulado, B ≤95%, C resto).
    const totalConsumo = itens.reduce((s: number, i: any) => s + i.valorConsumido, 0);
    const ordenados = [...itens].sort((a, b) => b.valorConsumido - a.valorConsumido);
    let acum = 0;
    const classe: Record<string, string> = {};
    for (const it of ordenados) {
      acum += it.valorConsumido;
      const pct = totalConsumo > 0 ? (acum / totalConsumo) * 100 : 100;
      classe[it.id] = it.valorConsumido === 0 ? 'C' : pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
    }
    itens = itens.map((i: any) => ({ ...i, classeAbc: classe[i.id] }));

    const resumo = {
      valorEstoque: itens.reduce((s: number, i: any) => s + i.valorEstoque, 0),
      comprasPeriodo: itens.reduce((s: number, i: any) => s + i.comprasValor, 0),
      valorConsumido: totalConsumo,
      itensAbaixoMinimo: itens.filter((i: any) => i.abaixoMinimo).length,
      itensRepor: itens.filter((i: any) => i.repor).length,
      leadTimePadrao: LEAD_TIME_PADRAO,
      dias,
    };
    return { resumo, itens };
  }

  // §1.6 — Validades FEFO: lotes por vencimento com status (crítico/atenção/vencido).
  // (Obs.: saídas ainda não decrementam lotes; usa lote.quantidade como saldo aproximado.)
  async validades(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select l.id, l.item_id as "itemId", i.nome as "itemNome",
             i.unidade_medida as "unidadeMedida", l.validade,
             l.quantidade, l.custo_unitario as "custoUnitario",
             (l.validade - current_date) as "diasParaVencer"
      from lote l
      join item_estoque i on i.id = l.item_id
      where l.tenant_id = ${tenantId} and l.esgotado = false
        and l.validade is not null and l.deleted_at is null
      order by l.validade asc
    `);
    const rows = res.rows ?? res;
    return rows.map((r: any) => {
      const d = Number(r.diasParaVencer);
      const status = d < 0 ? 'vencido' : d <= 2 ? 'critico' : d <= 5 ? 'atencao' : 'ok';
      return {
        id: r.id,
        itemId: r.itemId,
        itemNome: r.itemNome,
        unidadeMedida: r.unidadeMedida,
        validade: r.validade,
        quantidade: Number(r.quantidade),
        custoUnitario: r.custoUnitario != null ? Number(r.custoUnitario) : null,
        diasParaVencer: d,
        status,
        valor: Number(r.quantidade) * Number(r.custoUnitario ?? 0),
      };
    });
  }

  // §1.3 — Grava o snapshot de estoque de UMA data (saldo até a data × custo médio atual).
  // Upsert: reexecutar no mesmo dia atualiza. (custo_medio é o cache atual — snapshot é "ao vivo".)
  async gerarSnapshot(tenantId: string, data?: string) {
    const d = data ?? new Date().toISOString().slice(0, 10);
    await this.db.execute(sql`
      insert into estoque_snapshot (tenant_id, unidade_id, item_id, data, saldo, custo_medio)
      select i.tenant_id, i.unidade_id, i.id, ${d}::date,
        coalesce(sum(case m.tipo when 'entrada' then m.quantidade
          when 'saida' then -m.quantidade else m.quantidade end),0),
        i.custo_medio
      from item_estoque i
      left join movimento_estoque m on m.item_id = i.id and m.data <= ${d}
      where i.tenant_id = ${tenantId} and i.deleted_at is null
      group by i.id
      on conflict (tenant_id, item_id, data)
        do update set saldo = excluded.saldo, custo_medio = excluded.custo_medio
    `);
    return { ok: true, data: d };
  }

  // §1.3 — CMV real (EI + Compras − EF) × CMV teórico consumido → desvio.
  async cmvReal(tenantId: string, inicio: string, fim: string) {
    // Valor do snapshot mais recente com data <= alvo (EI/EF).
    const valorSnapshot = async (alvo: string): Promise<number> => {
      const r: any = await this.db.execute(sql`
        with ult as (
          select item_id, max(data) as data from estoque_snapshot
          where tenant_id=${tenantId} and data <= ${alvo} group by item_id
        )
        select coalesce(sum(s.saldo * s.custo_medio),0) as v
        from estoque_snapshot s
        join ult on ult.item_id = s.item_id and ult.data = s.data
        where s.tenant_id = ${tenantId}
      `);
      return Number((r.rows ?? r)[0].v);
    };
    const valorAtual = async (): Promise<number> => {
      const r: any = await this.db.execute(sql`
        select coalesce(sum(saldo * custo_medio),0) as v from (
          select i.custo_medio,
            coalesce(sum(case m.tipo when 'entrada' then m.quantidade
              when 'saida' then -m.quantidade else m.quantidade end),0) as saldo
          from item_estoque i
          left join movimento_estoque m on m.item_id = i.id
          where i.tenant_id=${tenantId} and i.deleted_at is null
          group by i.id
        ) t
      `);
      return Number((r.rows ?? r)[0].v);
    };

    const estoqueInicial = await valorSnapshot(inicio);
    const semSnapshotInicial = estoqueInicial === 0;

    let estoqueFinal = await valorSnapshot(fim);
    let efFonte = 'snapshot';
    if (estoqueFinal === 0) {
      estoqueFinal = await valorAtual(); // sem snapshot final → valorização atual
      efFonte = 'atual';
    }

    const somaMov = async (
      cond: any,
    ): Promise<number> => {
      const r: any = await this.db.execute(sql`
        select coalesce(sum(m.quantidade * coalesce(m.custo_unitario, i.custo_medio)),0) as v
        from movimento_estoque m join item_estoque i on i.id = m.item_id
        where m.tenant_id=${tenantId} and m.data between ${inicio} and ${fim} and ${cond}
      `);
      return Number((r.rows ?? r)[0].v);
    };
    const compras = await somaMov(sql`m.tipo='entrada' and m.motivo='recebimento'`);
    const cmvTeorico = await somaMov(
      sql`m.tipo='saida' and m.motivo in ('venda','producao')`,
    );
    // Desperdício valorizado no período (saídas com motivo 'desperdicio').
    const desperdicioValor = await somaMov(
      sql`m.tipo='saida' and m.motivo='desperdicio'`,
    );

    const cmvReal = estoqueInicial + compras - estoqueFinal;
    const desvio = cmvReal - cmvTeorico;
    // Furo = parte do desvio não explicada pelo desperdício registrado
    // (porção fora do padrão + perda/erro de contagem). §1.3.
    const furo = furoCmv(desvio, desperdicioValor);
    return {
      periodo: { inicio, fim },
      estoqueInicial: Number(estoqueInicial.toFixed(2)),
      compras: Number(compras.toFixed(2)),
      estoqueFinal: Number(estoqueFinal.toFixed(2)),
      efFonte,
      semSnapshotInicial,
      cmvReal: Number(cmvReal.toFixed(2)),
      cmvTeorico: Number(cmvTeorico.toFixed(2)),
      desvio: Number(desvio.toFixed(2)),
      desperdicioValor: Number(desperdicioValor.toFixed(2)),
      furo: Number(furo.toFixed(2)),
    };
  }

  // ── Alertas de estoque (ROP/FEFO) persistidos ────────────────────────────────
  // Mantém UM alerta aberto por (tenant, tipo): atualiza o existente ou cria.
  async registrarAlerta(
    tenantId: string,
    tipo: 'ponto_pedido' | 'validade',
    dados: { titulo: string; detalhe?: string; prioridade?: string; unidadeId?: string },
  ) {
    const atualizado = await this.db
      .update(alertaEstoque)
      .set({
        titulo: dados.titulo,
        detalhe: dados.detalhe,
        prioridade: dados.prioridade ?? 'alta',
        criadoEm: new Date(),
      })
      .where(
        and(
          eq(alertaEstoque.tenantId, tenantId),
          eq(alertaEstoque.tipo, tipo),
          isNull(alertaEstoque.resolvidoEm),
        ),
      )
      .returning();
    if (atualizado.length) return atualizado[0];
    const [novo] = await this.db
      .insert(alertaEstoque)
      .values({
        tenantId,
        unidadeId: dados.unidadeId,
        tipo,
        titulo: dados.titulo,
        detalhe: dados.detalhe,
        prioridade: dados.prioridade ?? 'alta',
      })
      .returning();
    return novo;
  }

  listarAlertas(tenantId: string) {
    return this.db
      .select()
      .from(alertaEstoque)
      .where(
        and(
          eq(alertaEstoque.tenantId, tenantId),
          isNull(alertaEstoque.resolvidoEm),
        ),
      )
      .orderBy(desc(alertaEstoque.criadoEm));
  }

  // Auto-resolve (pelo sistema) quando a condição some — mantém a lista limpa.
  async resolverAlertasSistema(tenantId: string, tipo: string) {
    await this.db
      .update(alertaEstoque)
      .set({ resolvidoEm: new Date() })
      .where(
        and(
          eq(alertaEstoque.tenantId, tenantId),
          eq(alertaEstoque.tipo, tipo),
          isNull(alertaEstoque.resolvidoEm),
        ),
      );
  }

  async resolverAlerta(tenantId: string, id: string, colaboradorId: string) {
    await this.db
      .update(alertaEstoque)
      .set({ resolvidoEm: new Date(), resolvidoPor: colaboradorId })
      .where(
        and(eq(alertaEstoque.id, id), eq(alertaEstoque.tenantId, tenantId)),
      );
    return { ok: true };
  }
}
