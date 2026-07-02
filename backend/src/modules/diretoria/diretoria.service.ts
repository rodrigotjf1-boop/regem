import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

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
      select unidade_id, count(*) as total from (
        select i.id, i.unidade_id, i.estoque_minimo,
          coalesce(sum(case m.tipo
            when 'entrada' then m.quantidade
            when 'saida'   then -m.quantidade
            else m.quantidade end), 0) as saldo
        from item_estoque i
        left join movimento_estoque m on m.item_id = i.id
        where i.tenant_id = ${tenantId} and i.deleted_at is null
        group by i.id
      ) s where s.saldo < s.estoque_minimo group by unidade_id`);

    const by = (arr: any[], id: string) => arr.find((r) => r.unidade_id === id);

    return unidades.map((u: any) => {
      const t = by(tarefas, u.id);
      const total = Number(t?.total ?? 0);
      const feitas = Number(t?.feitas ?? 0);
      const d = by(desp, u.id);
      const e = by(escala, u.id);
      const es = by(estoque, u.id);
      return {
        id: u.id,
        nome: u.nome,
        tarefas: { total, feitas, pct: total ? Math.round((feitas / total) * 100) : 0 },
        desperdicio: { total: Number(d?.total ?? 0), quantidade: Number(d?.qtd ?? 0) },
        escala: { vagas: Number(e?.vagas ?? 0), preenchidas: Number(e?.preenchidas ?? 0) },
        estoqueAbaixoMinimo: Number(es?.total ?? 0),
      };
    });
  }
}
