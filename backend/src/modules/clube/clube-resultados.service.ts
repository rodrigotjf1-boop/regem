import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO } from '../../common/data';
import { noPeriodo } from '../../common/fuso-sql';
import { DIAS_PARA_VOLTAR, periodoDosResultados, type PeriodoDosResultados } from './clube.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ResultadosDoClube = {
  periodo: PeriodoDosResultados;
  titulo: string;
  /** Os prêmios dados no período (todos os gatilhos e ferramentas). */
  ganharam: number;
  /** Desses, os que o cliente revelou (o escolhido do álbum e da meta já nasce revelado). */
  revelaram: number;
  /** Desses, os que viraram desconto num pedido que não foi cancelado. */
  usaram: number;
  /** O desconto que esses cupons deram (o do frete grátis conta). */
  desconto: number;
  /** O que foi vendido nos pedidos com o prêmio. */
  vendido: number;
  /** As campanhas com prêmio surpresa do período: quem recebeu e quem voltou em até 15 dias (nulo = nenhuma). */
  campanhas: { receberam: number; voltaram: number; dias: number } | null;
};

// CLUBE — OS RESULTADOS (fase A4 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`, Marketing
// › Clube › Resultados). Só NUVEM e só leitura. A coorte é a dos prêmios DADOS no período (dia da operação): quantos
// revelaram, quantos usaram (o cupom num pedido não cancelado), o desconto e o vendido nesses pedidos. O desconto sai dos
// valores por origem que o pedido grava (`descontos`, mig 241): a parte "cupom" do código e o frete grátis do mesmo cupom.
// A comparação com o grupo de controle fica para quando a campanha guardar quem ficou de fora (o cartão diz só quem voltou).
@Injectable()
export class ClubeResultadosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  async resultados(tenantId: string, periodo: unknown): Promise<ResultadosDoClube> {
    const p = periodoDosResultados(periodo, hojeISO());
    const [x] = this.rows(
      await this.db.execute(sql`
        with d as (
          select d.id, d.revelado_em, d.cupom_id, c.codigo
            from clube_direito d left join cupom c on c.id = d.cupom_id
           where d.tenant_id = ${tenantId}::uuid and ${noPeriodo('d.criado_em', p.de, p.ate)}
        ),
        usos as (
          select distinct d.id as direito, p.id as pedido, p.total, p.descontos, d.codigo
            from d
            join cupom_uso u on u.cupom_id = d.cupom_id and u.tenant_id = ${tenantId}::uuid
            join pedido_externo p on p.id = u.pedido_id and p.tenant_id = ${tenantId}::uuid and p.status <> 'cancelado'
        ),
        ped as (select distinct on (pedido) pedido, total, descontos, codigo from usos)
        select (select count(*) from d)::int as ganharam,
               (select count(*) from d where revelado_em is not null)::int as revelaram,
               (select count(distinct direito) from usos)::int as usaram,
               (select coalesce(sum(total), 0) from ped)::float8 as vendido,
               (select coalesce(sum((e ->> 'valor')::numeric), 0)
                  from ped, jsonb_array_elements(case when jsonb_typeof(ped.descontos) = 'array' then ped.descontos else '[]'::jsonb end) e
                 where (e ->> 'origem' = 'cupom' and upper(e ->> 'campanha') = upper(ped.codigo))
                    or (e ->> 'origem' = 'frete' and upper(e ->> 'rotulo') like 'CUPOM ' || upper(ped.codigo) || '%'))::float8 as desconto`),
    );
    const [c] = this.rows(
      await this.db.execute(sql`
        with e as (
          select distinct on (coalesce(e.cliente_id::text, e.telefone)) e.cliente_id, e.telefone, e.enviado_em
            from campanha_envio e join campanha ca on ca.id = e.campanha_id
           where e.tenant_id = ${tenantId}::uuid and ca.clube_premio_id is not null and e.status = 'enviado'
             and e.enviado_em is not null and ${noPeriodo('e.enviado_em', p.de, p.ate)}
           order by coalesce(e.cliente_id::text, e.telefone), e.enviado_em
        )
        select count(*)::int as receberam,
               count(*) filter (where e.cliente_id is not null and exists (
                 select 1 from pedido_externo pe
                  where pe.tenant_id = ${tenantId}::uuid and pe.cliente_id = e.cliente_id and pe.status <> 'cancelado'
                    and pe.criado_em > e.enviado_em and pe.criado_em <= e.enviado_em + make_interval(days => ${DIAS_PARA_VOLTAR})))::int as voltaram
          from e`),
    );
    const receberam = Number(c?.receberam ?? 0);
    return {
      periodo: p.periodo,
      titulo: p.titulo,
      ganharam: Number(x?.ganharam ?? 0),
      revelaram: Number(x?.revelaram ?? 0),
      usaram: Number(x?.usaram ?? 0),
      desconto: Math.round(Number(x?.desconto ?? 0) * 100) / 100,
      vendido: Math.round(Number(x?.vendido ?? 0) * 100) / 100,
      campanhas: receberam > 0 ? { receberam, voltaram: Number(c?.voltaram ?? 0), dias: DIAS_PARA_VOLTAR } : null,
    };
  }
}
