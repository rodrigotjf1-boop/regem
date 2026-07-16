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

  async resumo(
    tenantId: string,
    data: string,
    verFinanceiro = false,
    unidadeId?: string | null,
  ) {
    // Fragmento de filtro por unidade (vazio = rede toda). `uni` sem alias; `uniI`
    // para subquery com alias `i` (item_estoque).
    const uni = unidadeId ? sql`and unidade_id = ${unidadeId}` : sql``;
    const uniI = unidadeId ? sql`and i.unidade_id = ${unidadeId}` : sql``;
    const t = await this.row(sql`
      select count(*) as total,
        count(*) filter (where estado = 'feita')     as feitas,
        count(*) filter (where estado = 'pendente')  as pendentes,
        count(*) filter (where estado = 'nao_feita') as nao_feitas,
        count(*) filter (where conclusao_em_massa)   as em_massa
      from tarefa_instancia
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null ${uni}`);

    const e = await this.row(sql`
      select count(*) as vagas, count(colaborador_id) as preenchidas
      from escala_alocacao
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null ${uni}`);

    const d = await this.row(sql`
      select count(*) as total, coalesce(sum(quantidade), 0) as qtd
      from desperdicio
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null ${uni}`);

    const v = await this.row(sql`
      select count(*) as total from vistoria
      where tenant_id = ${tenantId} and data = ${data} and deleted_at is null ${uni}`);

    const est = await this.row(sql`
      select count(*) as total from (
        select i.id, i.estoque_minimo,
          coalesce(sum(case m.tipo
            when 'entrada' then m.quantidade
            when 'saida'   then -m.quantidade
            else m.quantidade end), 0) as saldo
        from item_estoque i
        left join movimento_estoque m on m.item_id = i.id
        where i.tenant_id = ${tenantId} and i.deleted_at is null ${uniI}
        group by i.id
      ) s where s.saldo < s.estoque_minimo`);

    // Comercial: vendas do dia (comandas fechadas, no fuso SP) + delivery ativo.
    const vend = await this.row(sql`
      select count(*)::int as vendas,
             coalesce(sum(total), 0) as faturado,
             coalesce(avg(total), 0) as ticket
      from comanda
      where tenant_id = ${tenantId} and status = 'fechada' ${uni}
        and (fechada_em at time zone 'America/Sao_Paulo')::date = ${data}::date`);

    const deliv = await this.row(sql`
      select count(*)::int as pendentes from pedido_externo
      where tenant_id = ${tenantId} ${uni}
        and status in ('novo', 'confirmado', 'pronto', 'despachado')`);

    // Produção do dia (unidades = operacional; custo = financeiro).
    const prod = await this.row(sql`
      select count(*)::int as producoes,
             coalesce(sum((detalhe->>'quantidade')::numeric), 0) as unidades,
             coalesce(sum((detalhe->>'custoTotal')::numeric), 0) as custo
      from audit_log
      where tenant_id = ${tenantId} and acao = 'produziu_ficha' ${uni}
        and (created_at at time zone 'America/Sao_Paulo')::date = ${data}::date`);

    const total = Number(t.total);
    const feitas = Number(t.feitas);

    const base: any = {
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
      // Volume operacional (sem valores em R$): nº de vendas, produção e delivery aberto.
      vendas: { total: Number(vend.vendas) },
      producaoHoje: { producoes: Number(prod.producoes), unidades: Number(Number(prod.unidades).toFixed(3)) },
      deliveryPendentes: Number(deliv.pendentes),
    };

    // Bloco COMERCIAL/FINANCEIRO — RBAC no servidor: só presidente/C&O recebe
    // valores em R$ (faturamento, ticket, delivery, custo). Gerente NUNCA recebe.
    if (verFinanceiro) {
      const delivFat = await this.row(sql`
        select coalesce(sum(total), 0) as faturado
        from pedido_externo
        where tenant_id = ${tenantId} and status not in ('novo', 'cancelado') ${uni}
          and (criado_em at time zone 'America/Sao_Paulo')::date = ${data}::date`);
      base.comercial = {
        faturado: Number(Number(vend.faturado).toFixed(2)),
        ticketMedio: Number(Number(vend.ticket).toFixed(2)),
        deliveryFaturado: Number(Number(delivFat.faturado).toFixed(2)),
        producaoCusto: Number(Number(prod.custo).toFixed(2)),
      };
    }

    return base;
  }

  // Linha do tempo operacional do dia: faixas de turno, tarefas com horário e
  // janelas de pico — tudo em horas decimais (ex.: 13.5 = 13h30) p/ o front posicionar.
  // Linha do tempo operacional — por SETOR, a partir da escala do dia (fonte da
  // verdade): quem está escalado (turno) + tarefas com horário + janelas de pico
  // + marcador "agora" (só se `data` = hoje no fuso America/Sao_Paulo).
  async timeline(tenantId: string, data: string, unidadeId?: string | null) {
    const rows = (r: any) => (r.rows ?? r) as any[];
    const uniA = unidadeId ? sql`and a.unidade_id = ${unidadeId}` : sql``;
    const uniI = unidadeId ? sql`and i.unidade_id = ${unidadeId}` : sql``;
    const uniN = unidadeId ? sql`and unidade_id = ${unidadeId}` : sql``;

    // Alocações da escala do dia (colaborador × turno × etiqueta → setor).
    const aloc: any = await this.db.execute(sql`
      select s.id as setor_id, s.nome as setor,
        c.nome as colaborador, f.nome as funcao, et.sigla as etiqueta, t.nome as turno,
        extract(hour from t.hora_inicio) + extract(minute from t.hora_inicio) / 60.0 as inicio,
        extract(hour from t.hora_fim)   + extract(minute from t.hora_fim)   / 60.0 as fim
      from escala_alocacao a
      join turno t on t.id = a.turno_id
      join etiqueta et on et.id = a.etiqueta_id
      join setor s on s.id = et.setor_id
      left join funcao f on f.id = et.funcao_id
      left join colaborador c on c.id = a.colaborador_id
      where a.tenant_id = ${tenantId} and a.data = ${data}
        and a.deleted_at is null and a.status = 'ativa' ${uniA}
      order by s.nome, inicio`);

    // Tarefas com horário do dia (por setor).
    const tar: any = await this.db.execute(sql`
      select d.titulo,
        extract(hour from d.horario) + extract(minute from d.horario) / 60.0 as horario,
        i.estado, s.id as setor_id, s.nome as setor
      from tarefa_instancia i
      join tarefa_def d on d.id = i.tarefa_def_id
      left join setor s on s.id = d.setor_id
      where i.tenant_id = ${tenantId} and i.data = ${data}
        and i.deleted_at is null and d.horario is not null ${uniI}
      order by d.horario`);

    const picos: any = await this.db.execute(sql`
      select nome,
        extract(hour from hora_inicio) + extract(minute from hora_inicio) / 60.0 as inicio,
        extract(hour from hora_fim)   + extract(minute from hora_fim)   / 60.0 as fim
      from janela_pico
      where tenant_id = ${tenantId} and deleted_at is null ${uniN}
        and (
          dia_semana is null
          or (dia_semana_fim is null and dia_semana = extract(dow from ${data}::date))
          or (dia_semana_fim is not null and (
            (dia_semana <= dia_semana_fim and extract(dow from ${data}::date) between dia_semana and dia_semana_fim)
            or (dia_semana > dia_semana_fim and (extract(dow from ${data}::date) >= dia_semana or extract(dow from ${data}::date) <= dia_semana_fim))
          ))
        )
      order by hora_inicio`);

    const nowRow: any = await this.db.execute(sql`
      select case when (now() at time zone 'America/Sao_Paulo')::date = ${data}::date
        then extract(hour from now() at time zone 'America/Sao_Paulo')
           + extract(minute from now() at time zone 'America/Sao_Paulo') / 60.0
        else null end as agora`);
    const agoraVal = rows(nowRow)[0]?.agora;
    const agora = agoraVal == null ? null : Number(agoraVal);

    // Agrupa por setor (preservando setores que só têm tarefas).
    const mapa = new Map<string, any>();
    const getSetor = (id: string | null, nome: string | null) => {
      const key = id ?? nome ?? '—';
      if (!mapa.has(key))
        mapa.set(key, { setor: nome ?? 'Sem setor', alocacoes: [], tarefas: [] });
      return mapa.get(key);
    };
    for (const r of rows(aloc)) {
      getSetor(r.setor_id, r.setor).alocacoes.push({
        colaborador: r.colaborador ?? 'A definir',
        funcao: r.funcao ?? null,
        etiqueta: r.etiqueta ?? null,
        turno: r.turno ?? null,
        inicio: Number(r.inicio),
        fim: Number(r.fim),
      });
    }
    for (const r of rows(tar)) {
      getSetor(r.setor_id, r.setor).tarefas.push({
        titulo: r.titulo,
        horario: Number(r.horario),
        estado: r.estado,
      });
    }

    const faixa = (r: any) => ({
      nome: r.nome,
      inicio: Number(r.inicio),
      fim: Number(r.fim),
    });

    return {
      data,
      agora,
      setores: [...mapa.values()],
      picos: rows(picos).map(faixa),
    };
  }
}
