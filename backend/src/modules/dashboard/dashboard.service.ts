import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private async row(query: SQL) {
    const r: any = await this.db.execute(query);
    return r.rows[0];
  }

  async resumo(tenantId: string, data: string) {
    const t = await this.row(sql`
      select count(*) as total,
        count(*) filter (where estado = 'feita')     as feitas,
        count(*) filter (where estado = 'pendente')  as pendentes,
        count(*) filter (where estado = 'nao_feita') as nao_feitas,
        count(*) filter (where conclusao_em_massa)   as em_massa
      from tarefa_instancia
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null`);

    const e = await this.row(sql`
      select count(*) as vagas, count(colaborador_id) as preenchidas
      from escala_alocacao
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null`);

    const d = await this.row(sql`
      select count(*) as total, coalesce(sum(quantidade), 0) as qtd
      from desperdicio
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null`);

    const v = await this.row(sql`
      select count(*) as total from vistoria
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null`);

    const est = await this.row(sql`
      select count(*) as total from (
        select i.id, i.estoque_minimo,
          coalesce(sum(case m.tipo
            when 'entrada' then m.quantidade
            when 'saida'   then -m.quantidade
            else m.quantidade end), 0) as saldo
        from item_estoque i
        left join movimento_estoque m on m.item_id = i.id
        where i.tenant_id = ${tenantId} and i.deleted_at is null
        group by i.id
      ) s where s.saldo < s.estoque_minimo`);

    const total = Number(t.total);
    const feitas = Number(t.feitas);

    return {
      data,
      tarefas: {
        total,
        feitas,
        pendentes: Number(t.pendentes),
        naoFeitas: Number(t.nao_feitas),
        emMassa: Number(t.em_massa),
        pctConclusao: total ? Math.round((feitas / total) * 100) : 0,
      },
      escala: { vagas: Number(e.vagas), preenchidas: Number(e.preenchidas) },
      desperdicio: { total: Number(d.total), quantidade: Number(d.qtd) },
      vistorias: Number(v.total),
      estoqueAbaixoMinimo: Number(est.total),
    };
  }
}
