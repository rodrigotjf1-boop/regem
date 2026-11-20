import { sql } from 'drizzle-orm';
import { hojeISO } from '../../common/data';
import { FUSO_SQL, instanteDe } from '../../common/fuso-sql';
import { REGRAS_DO_PERFIL } from './calculo-do-perfil';
import { somarDias } from './calendario-regra';
import { ClienteParaMedir, medirSensibilidades } from './sensibilidade-a-eventos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SENSIBILIDADE A EVENTOS DE UMA EMPRESA (F3 parte 2, mig 463): lê a cópia do calendário por loja e dia (mig 461, gravada
// pela rotina noturna) e os pedidos DIRETOS dos clientes que têm perfil (iFood e 99 fora — D1; quem pediu "não analisar"
// não tem perfil), mede (`sensibilidade-a-eventos.ts`) e grava numa transação: o que mediu e, apagado, o que não vale mais.
// Sem a cópia do calendário ainda (a rotina não rodou desde a mig 461): não mede (null).

const rows = (r: any): any[] => r?.rows ?? r ?? [];
/** O período medido: os últimos 400 dias de operação, até ontem. */
const DIAS = 400;

export async function calcularSensibilidadeDaEmpresa(db: any, tenantId: string) {
  const ate = somarDias(hojeISO(), -1);
  const inicio = somarDias(ate, -(DIAS - 1));
  const corte = REGRAS_DO_PERFIL.corteDiaOperacaoHoras;
  const hh = `${String(corte).padStart(2, '0')}:00:00`;

  const cal = rows(await db.execute(sql`
    select unidade_id::text as loja, to_char(dia, 'YYYY-MM-DD') as dia, eventos
      from calendario_loja_dia
     where tenant_id = ${tenantId}::uuid and dia between ${inicio}::date and ${ate}::date`));
  if (!cal.length) return null;
  const calendarios = new Map<string, Map<string, Set<string>>>();
  for (const r of cal) {
    const m = calendarios.get(r.loja) ?? new Map<string, Set<string>>();
    m.set(r.dia, new Set((Array.isArray(r.eventos) ? r.eventos : []).map((e: any) => String(e?.grupo ?? ''))));
    calendarios.set(r.loja, m);
  }
  const lojaPadrao = [...calendarios.keys()].sort()[0];

  const ped = rows(await db.execute(sql`
    select p.cliente_id::text as cliente, p.unidade_id::text as loja,
           to_char(((p.criado_em at time zone ${FUSO_SQL}) - make_interval(hours => ${corte}::int))::date, 'YYYY-MM-DD') as dia,
           count(*)::int as n,
           to_char(((min(cp.primeiro_pedido_em) at time zone ${FUSO_SQL}) - make_interval(hours => ${corte}::int))::date, 'YYYY-MM-DD') as primeiro
      from pedido_externo p
      join cliente_perfil cp on cp.cliente_id = p.cliente_id and cp.tenant_id = p.tenant_id
     where p.tenant_id = ${tenantId}::uuid and p.status <> 'cancelado' and coalesce(p.canal, '') not in ('ifood', '99food')
       and p.criado_em >= ${instanteDe(`${inicio} ${hh}`)} and p.criado_em < ${instanteDe(`${somarDias(ate, 1)} ${hh}`)}
     group by 1, 2, 3`));

  const porCliente = new Map<string, { pedidos: Map<string, number>; lojas: Map<string, number>; primeiro: string }>();
  for (const r of ped) {
    const c = porCliente.get(r.cliente) ?? { pedidos: new Map(), lojas: new Map(), primeiro: r.primeiro ?? inicio };
    c.pedidos.set(r.dia, (c.pedidos.get(r.dia) ?? 0) + Number(r.n));
    const loja = r.loja && calendarios.has(r.loja) ? r.loja : lojaPadrao;
    c.lojas.set(loja, (c.lojas.get(loja) ?? 0) + Number(r.n));
    if (r.primeiro && r.primeiro < c.primeiro) c.primeiro = r.primeiro;
    porCliente.set(r.cliente, c);
  }
  const clientes: ClienteParaMedir[] = [...porCliente].map(([id, c]) => ({
    id,
    // A loja onde ele mais pede (empate: a de menor id — estável).
    loja: [...c.lojas].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0],
    inicio: c.primeiro > inicio ? c.primeiro : inicio,
    pedidos: c.pedidos,
  }));

  const { linhas, rrDaLoja } = medirSensibilidades(clientes, calendarios, ate);
  const json = JSON.stringify(
    linhas.map((l) => ({
      cliente: l.cliente,
      tipo: l.tipo,
      rr: Math.round(l.rr * 100) / 100,
      prob: Math.round(Math.min(1, Math.max(0, l.prob)) * 1000) / 1000,
      pedidos: l.pedidos,
      esperado: Math.round(l.esperado * 100) / 100,
      dias: l.dias,
      selo: l.selo,
    })),
  );
  await db.transaction(async (tx: any) => {
    if (linhas.length)
      await tx.execute(sql`
        insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido, selo, calculado_em)
        select x.cliente::uuid, x.tipo, ${tenantId}::uuid, x.rr, x.prob, x.pedidos, x.esperado, x.dias, x.selo, now()
          from jsonb_to_recordset(${json}::jsonb)
               as x(cliente text, tipo text, rr numeric, prob numeric, pedidos int, esperado numeric, dias int, selo boolean)
        on conflict (cliente_id, tipo) do update set
          tenant_id = excluded.tenant_id, rr = excluded.rr, prob = excluded.prob, pedidos = excluded.pedidos,
          esperado = excluded.esperado, dias_com_pedido = excluded.dias_com_pedido, selo = excluded.selo,
          calculado_em = excluded.calculado_em`);
    // O que não foi medido nesta volta (o tipo deixou de mexer na loja, o cliente perdeu o perfil) sai.
    await tx.execute(sql`delete from cliente_evento_sensibilidade where tenant_id = ${tenantId}::uuid and calculado_em < now()`);
  });
  return { clientes: clientes.length, linhas: linhas.length, selos: linhas.filter((l) => l.selo).length, rrDaLoja };
}
