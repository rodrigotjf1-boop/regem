import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Relatórios de venda — camada de LEITURA sobre comanda/comanda_item (vendas
// fechadas). Canal é derivado (mesa / delivery-app / balcão) sem coluna nova.
@Injectable()
export class RelatoriosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private periodo(inicio?: string, fim?: string) {
    const hoje = new Date().toISOString().slice(0, 10);
    const ini =
      inicio || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return { ini, fim: fim || hoje };
  }
  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  // Resumo + quebras (forma, canal, dia, hora).
  async vendas(tenantId: string, inicio?: string, fim?: string) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const base = sql`from comanda c
      where c.tenant_id = ${tenantId}
        and c.status = 'fechada'
        and c.fechada_em::date between ${ini} and ${f}`;

    const [resumo] = await this.rows(sql`
      select count(*)::int as vendas,
             coalesce(sum(c.total),0) as faturado,
             coalesce(avg(c.total),0) as ticket_medio
      ${base}`);
    const [{ canceladas }] = await this.rows(sql`
      select count(*)::int as canceladas from comanda c
      where c.tenant_id = ${tenantId} and c.status='cancelada'
        and c.cancelada_em::date between ${ini} and ${f}`);

    const porForma = await this.rows(sql`
      select coalesce(c.forma,'—') as forma, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 3 desc`);
    const porCanal = await this.rows(sql`
      select case when c.mesa_id is not null then 'mesa'
                  when c.forma='online' then 'delivery/app'
                  else 'balcão' end as canal,
             count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 3 desc`);
    const porDia = await this.rows(sql`
      select c.fechada_em::date as dia, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 1`);
    const porHora = await this.rows(sql`
      select extract(hour from c.fechada_em)::int as hora, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 1`);

    return {
      periodo: { inicio: ini, fim: f },
      resumo: {
        vendas: Number(resumo.vendas),
        faturado: Number(resumo.faturado),
        ticketMedio: Number(Number(resumo.ticket_medio).toFixed(2)),
        canceladas: Number(canceladas),
      },
      porForma: porForma.map((r) => ({ forma: r.forma, qtd: Number(r.qtd), total: Number(r.total) })),
      porCanal: porCanal.map((r) => ({ canal: r.canal, qtd: Number(r.qtd), total: Number(r.total) })),
      porDia: porDia.map((r) => ({ dia: r.dia, qtd: Number(r.qtd), total: Number(r.total) })),
      porHora: porHora.map((r) => ({ hora: Number(r.hora), qtd: Number(r.qtd), total: Number(r.total) })),
    };
  }

  // Curva ABC dos produtos por faturamento (A<=80%, B<=95%, C resto).
  async produtos(tenantId: string, inicio?: string, fim?: string) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const rows = await this.rows(sql`
      select ci.descricao,
             coalesce(sum(ci.quantidade),0) as qtd,
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as faturamento
      from comanda_item ci
      join comanda c on c.id = ci.comanda_id
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em::date between ${ini} and ${f}
      group by ci.descricao
      order by faturamento desc`);
    const total = rows.reduce((s, r) => s + Number(r.faturamento), 0) || 1;
    let acum = 0;
    return {
      periodo: { inicio: ini, fim: f },
      total: Number(total.toFixed(2)),
      itens: rows.map((r) => {
        const fat = Number(r.faturamento);
        acum += fat;
        const pctAcum = (acum / total) * 100;
        const classe = pctAcum <= 80 ? 'A' : pctAcum <= 95 ? 'B' : 'C';
        return {
          descricao: r.descricao,
          qtd: Number(r.qtd),
          faturamento: Number(fat.toFixed(2)),
          pct: Number(((fat / total) * 100).toFixed(1)),
          pctAcum: Number(pctAcum.toFixed(1)),
          classe,
        };
      }),
    };
  }

  // Desempenho por atendente (quem abriu a venda).
  async atendentes(tenantId: string, inicio?: string, fim?: string) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const rows = await this.rows(sql`
      select coalesce(col.nome,'—') as nome,
             count(*)::int as vendas,
             coalesce(sum(c.total),0) as total,
             coalesce(avg(c.total),0) as ticket_medio
      from comanda c
      left join colaborador col on col.id = c.aberta_por_id
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em::date between ${ini} and ${f}
      group by col.nome
      order by total desc`);
    return {
      periodo: { inicio: ini, fim: f },
      atendentes: rows.map((r) => ({
        nome: r.nome,
        vendas: Number(r.vendas),
        total: Number(r.total),
        ticketMedio: Number(Number(r.ticket_medio).toFixed(2)),
      })),
    };
  }
}
