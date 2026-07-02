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

  // Linha do tempo operacional do dia: faixas de turno, tarefas com horário e
  // janelas de pico — tudo em horas decimais (ex.: 13.5 = 13h30) p/ o front posicionar.
  async timeline(tenantId: string, data: string) {
    const turnos: any = await this.db.execute(sql`
      select nome,
        extract(hour from hora_inicio) + extract(minute from hora_inicio) / 60.0 as inicio,
        extract(hour from hora_fim)   + extract(minute from hora_fim)   / 60.0 as fim
      from turno
      where tenant_id = ${tenantId} and deleted_at is null
      order by hora_inicio`);

    const tarefas: any = await this.db.execute(sql`
      select d.titulo,
        extract(hour from d.horario) + extract(minute from d.horario) / 60.0 as horario,
        i.estado, s.nome as setor, e.sigla as etiqueta
      from tarefa_instancia i
      join tarefa_def d on d.id = i.tarefa_def_id
      left join setor s on s.id = d.setor_id
      left join etiqueta e on e.id = i.etiqueta_id
      where i.tenant_id = ${tenantId} and i.data = ${data}
        and i.deleted_at is null and d.horario is not null
      order by d.horario`);

    const picos: any = await this.db.execute(sql`
      select nome,
        extract(hour from hora_inicio) + extract(minute from hora_inicio) / 60.0 as inicio,
        extract(hour from hora_fim)   + extract(minute from hora_fim)   / 60.0 as fim
      from janela_pico
      where tenant_id = ${tenantId} and deleted_at is null
        and (dia_semana is null or dia_semana = extract(dow from ${data}::date))
      order by hora_inicio`);

    const faixa = (r: any) => ({
      nome: r.nome,
      inicio: Number(r.inicio),
      fim: Number(r.fim),
    });

    return {
      data,
      turnos: (turnos.rows ?? turnos).map(faixa),
      picos: (picos.rows ?? picos).map(faixa),
      tarefas: (tarefas.rows ?? tarefas).map((r: any) => ({
        titulo: r.titulo,
        horario: Number(r.horario),
        estado: r.estado,
        setor: r.setor,
        etiqueta: r.etiqueta,
      })),
    };
  }
}
