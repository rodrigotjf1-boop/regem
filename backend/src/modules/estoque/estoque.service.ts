import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { itemEstoque, movimentoEstoque } from '../../db/schema';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';

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
  // Lead time padrão de 7 dias (prazo por fornecedor = pendência, exige migration).
  async inteligencia(tenantId: string, inicio: string, fim: string) {
    const LEAD_TIME_DIAS = 7;
    const res: any = await this.db.execute(sql`
      select i.id, i.nome, i.unidade_medida as "unidadeMedida",
             i.estoque_minimo as "estoqueMinimo", i.custo_medio as "custoMedio",
             coalesce(sum(case m.tipo when 'entrada' then m.quantidade
               when 'saida' then -m.quantidade else m.quantidade end),0) as saldo,
             coalesce(sum(case when m.tipo='saida' and m.data between ${inicio} and ${fim}
               then m.quantidade else 0 end),0) as "saidaPeriodo",
             coalesce(sum(case when m.tipo='entrada' and m.motivo='recebimento'
               and m.data between ${inicio} and ${fim}
               then m.quantidade * coalesce(m.custo_unitario, i.custo_medio) else 0 end),0) as "comprasValor"
      from item_estoque i
      left join movimento_estoque m on m.item_id = i.id
      where i.tenant_id = ${tenantId} and i.deleted_at is null
      group by i.id
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
      const rop = consumoDiario * LEAD_TIME_DIAS + Number(r.estoqueMinimo ?? 0);
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
        rop: Number(rop.toFixed(2)),
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
      leadTimeDias: LEAD_TIME_DIAS,
      dias,
    };
    return { resumo, itens };
  }
}
