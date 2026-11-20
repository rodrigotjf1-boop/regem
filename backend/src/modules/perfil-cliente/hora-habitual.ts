import { sql, type SQL } from 'drizzle-orm';
import { FUSO_OPERACAO } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { REGRAS_DO_PERFIL, faixa } from './calculo-do-perfil';

// A CAMPANHA NA HORA HABITUAL DE CADA CLIENTE (F7 parte 4b do docs/plano-perfil-cliente.md, §4.4 "melhor hora de contato" e
// §6.3; protótipo, aba "Marketing", cartão "Quando enviar"; mig 480). Um lugar só para a regra:
//  • o momento de envio de cada cliente em cada dia da semana (o dia de OPERAÇÃO — a madrugada é do dia anterior, como a
//    grade do perfil): a faixa em que ele mais pede NAQUELE dia (a grade da camada 4); sem pedido naquele dia, a faixa
//    habitual dele; sem perfil, a faixa de pico da loja naquele dia. A hora: a hora habitual dele quando a faixa é a habitual;
//    senão a hora média da loja naquela faixa e dia (ou só na faixa); loja sem pedido: 19h;
//  • a mensagem sai de 30 a 60 min ANTES dessa hora (espalhado por cliente, sempre o mesmo para o mesmo cliente e dia) — "o
//    alvo é o pedido, não a abertura";
//  • sempre dentro da janela de horário da campanha (quando tem) ou, sem janela, entre 8h e 23h — nada de marketing de
//    madrugada; quem pede de madrugada recebe às 23h;
//  • a fila manda quando o relógio chega no momento e por até 90 min depois; passou, fica para o mesmo dia da semana
//    seguinte que a campanha ainda estiver no ar (os tetos e os dias da campanha continuam valendo).
// O cálculo é UMA vez, no criar (set-based, junto com a lista de destinatários); a fila só compara o minuto de agora.

export const HORA_HABITUAL = {
  /** A mensagem sai entre 30 e 60 min antes da hora habitual. */
  antesMin: 30,
  antesMax: 60,
  /** Depois do momento marcado, ainda manda por 90 min. */
  janelaMin: 90,
  /** Sem janela de horário na campanha: nunca antes das 8h nem depois das 23h. */
  cedo: 8 * 60,
  tarde: 23 * 60,
  /** Com janela: o último momento é 10 min antes de ela fechar. */
  folgaNoFim: 10,
  /** O pico da loja: os pedidos diretos dos últimos 90 dias. */
  diasDaLoja: 90,
  /** Loja sem pedido nenhum: 19h. */
  padrao: 19 * 60,
} as const;

const CORTE_MIN = REGRAS_DO_PERFIL.corteDiaOperacaoHoras * 60;

/** Minuto do relógio → minuto do dia de operação (antes do corte é a madrugada do dia anterior: passa de 1440). */
export const minutoDaOperacao = (minutoDoRelogio: number): number =>
  minutoDoRelogio < CORTE_MIN ? minutoDoRelogio + 1440 : minutoDoRelogio;

const minutoDe = (t: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Os limites do momento de envio, em minutos do dia de operação: a janela da campanha (quando tem) ou 8h–23h. */
export function limitesDoEnvio(horaInicio?: string | null, horaFim?: string | null): { de: number; ate: number } {
  const ini = minutoDe(horaInicio);
  const fim = minutoDe(horaFim);
  if (ini != null && fim != null) {
    const de = minutoDaOperacao(ini);
    const ate = minutoDaOperacao(fim) - HORA_HABITUAL.folgaNoFim;
    if (ate > de) return { de, ate };
  }
  return { de: HORA_HABITUAL.cedo, ate: HORA_HABITUAL.tarde };
}

const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Agora no dia de operação: o dia da semana (1 = segunda … 7 = domingo) e o minuto (a madrugada passa de 1440). */
export function agoraDaOperacao(agora: Date = new Date()): { dia: number; minuto: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: FUSO_OPERACAO, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const dia = DIA_ISO[p.weekday] ?? 1;
  const minuto = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return minuto < CORTE_MIN ? { dia: dia === 1 ? 7 : dia - 1, minuto: minuto + 1440 } : { dia, minuto };
}

/** A média circular de minutos do dia (23h50 e 0h10 dão meia-noite, não meio-dia) — a mesma conta da hora habitual. */
const mediaCircular = (m: SQL) =>
  sql`((((atan2(avg(sin(2 * pi() * ${m} / 1440.0)), avg(cos(2 * pi() * ${m} / 1440.0))) * 1440 / (2 * pi()))::numeric + 1440) % 1440)::int)`;

/**
 * O começo `with …` do comando: o pico da loja por dia de operação e faixa (pedidos diretos — sem iFood e 99, sem
 * cancelados — dos últimos 90 dias). `hh_loja` (dia, faixa, n, minuto), `hh_faixa` (faixa, minuto), `hh_pico` (dia, faixa).
 * Quem chama continua com `, outra as (…)` ou com o `insert`/`select`.
 */
export function sqlPicoDaLoja(tenantId: string): SQL {
  const local = sql`(p.criado_em at time zone ${FUSO_SQL})`;
  return sql`with
hh_q as (
  select extract(isodow from (${local} - make_interval(hours => ${REGRAS_DO_PERFIL.corteDiaOperacaoHoras}::int))::date)::int as dia,
         ${faixa(sql`extract(hour from ${local})`)} as faixa,
         extract(hour from ${local}) * 60 + extract(minute from ${local}) as m
    from pedido_externo p
   where p.tenant_id = ${tenantId}::uuid and p.status <> 'cancelado'
     and coalesce(p.canal, '') not in ('ifood', '99food')
     and p.criado_em >= now() - make_interval(days => ${HORA_HABITUAL.diasDaLoja}::int)
),
hh_loja as (select dia, faixa, count(*)::int as n, ${mediaCircular(sql`m`)} as minuto from hh_q group by 1, 2),
hh_faixa as (select faixa, ${mediaCircular(sql`m`)} as minuto from hh_q group by 1),
hh_pico as (select distinct on (dia) dia, faixa from hh_loja order by dia, n desc, faixa)`;
}

/**
 * As junções do momento de envio de cada cliente (alias do cliente = `c`; precisa do começo de `sqlPicoDaLoja`). A coluna
 * `alvo.minutos` = os 7 momentos (índice 1 = segunda … 7 = domingo), em minutos do dia de operação, já dentro dos limites.
 */
export function sqlJuntasDoAlvo(limites: { de: number; ate: number }): SQL {
  const H = HORA_HABITUAL;
  const grade = sql`(cp.camadas -> 'ritmo' -> 'grade' -> (d.d::text))`;
  const hora = sql`(cp.camadas -> 'ritmo' ->> 'hora_habitual')`;
  return sql`
    left join cliente_perfil cp on cp.cliente_id = c.id and cp.tenant_id = c.tenant_id
    cross join lateral (
      select array_agg(least(greatest(
               (case when h.m < ${CORTE_MIN}::int then h.m + 1440 else h.m end)
                 - (${H.antesMin}::int + mod(abs(hashtext(c.id::text || ':' || d.d::text)::bigint), ${H.antesMax - H.antesMin + 1}::bigint)::int),
               ${limites.de}::int), ${limites.ate}::int)::smallint order by d.d) as minutos
        from generate_series(1, 7) d(d)
        cross join lateral (
          select coalesce(
            (select g.key
               from jsonb_each(case when jsonb_typeof(${grade}) = 'object' then ${grade} else '{}'::jsonb end) g
              order by case when jsonb_typeof(g.value) = 'number' then (g.value)::text::numeric else 0 end desc,
                       coalesce(g.key = cp.faixa_habitual, false) desc, g.key
              limit 1),
            cp.faixa_habitual,
            (select pk.faixa from hh_pico pk where pk.dia = d.d)) as faixa
        ) fx
        cross join lateral (
          select coalesce(
            case when fx.faixa = cp.faixa_habitual and ${hora} ~ '^[0-9]{1,2}:[0-9]{2}$'
                 then split_part(${hora}, ':', 1)::int * 60 + split_part(${hora}, ':', 2)::int end,
            (select l.minuto from hh_loja l where l.dia = d.d and l.faixa = fx.faixa),
            (select f.minuto from hh_faixa f where f.faixa = fx.faixa),
            case fx.faixa when 'madrugada' then 30 when 'manha' then 600 when 'almoco' then 720 when 'tarde' then 960
                          when 'inicio_noite' then 1140 when 'noite' then 1290 end,
            ${H.padrao}::int) as m
        ) h
    ) alvo`;
}

/** O próximo destinatário da campanha na hora habitual: o momento dele HOJE já chegou e não passou da janela. */
export function sqlProximoNaHoraHabitual(campanhaId: string, agora: { dia: number; minuto: number }): SQL {
  const alvo = sql`e.minutos_alvo[${agora.dia}::int]`;
  return sql`
    select e.id, e.telefone, e.cliente_id, e.variante from campanha_envio e
     where e.campanha_id = ${campanhaId}::uuid and e.status = 'pendente'
       and (e.minutos_alvo is null
            or (${alvo} <= ${agora.minuto}::int and ${agora.minuto}::int < ${alvo} + ${HORA_HABITUAL.janelaMin}::int))
     order by ${alvo} nulls first, e.id
     limit 1`;
}
