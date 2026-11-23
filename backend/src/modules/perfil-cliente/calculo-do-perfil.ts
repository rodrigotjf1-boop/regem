import { sql, type SQL } from 'drizzle-orm';
import { FUSO_SQL } from '../../common/fuso-sql';
import { perfilSoComAviso, sqlFoiAvisado } from './aviso-do-perfil';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CÁLCULO DO PERFIL DO CLIENTE (F1a do docs/plano-perfil-cliente.md, §4). Uma consulta por empresa, set-based (regra
// de operação em massa), que grava `cliente_perfil` de TODOS os clientes diretos — ou de um só (`clienteId`), com os
// números da loja calculados do mesmo jeito.
//
// Princípios (pesquisa de métodos, §4 do plano):
//  • só pedidos DIRETOS (iFood e 99 ficam fora — D1) e não cancelados; quem pediu "não quero ser analisado" fica fora;
//  • amostra pequena por cliente → tudo ENCOLHIDO para a média da loja (ticket e intervalo, k = 3);
//  • o "sumiu" é medido contra o ritmo do PRÓPRIO cliente (atraso = dias sem pedir ÷ intervalo habitual);
//  • o dia é o DIA DE OPERAÇÃO (pedido até as 04h conta no dia anterior — a loja vende até as 02h);
//  • RFM de 1 a 3 (como a Klaviyo): R por limiar fixo, F por "1 pedido / até a mediana / acima", M pelos tercis do
//    ticket ajustado da loja; os 27 códigos viram 6 segmentos;
//  • reclamações agrupadas pelo motivo (D13): do "o que pesou" das notas até 3 e dos casos do Atendimento;
//  • cada etiqueta guarda o PORQUÊ (camadas.porque) — etiqueta explicável.
// Pesos, cortes e meias-vidas são da DISTRIBUIÇÃO (a loja não vê nem edita a lógica).

export const REGRAS_DO_PERFIL = {
  versao: 1,
  corteDiaOperacaoHoras: 4,
  kTicket: 3,
  kIntervalo: 3,
  intervaloPadraoDias: 30,
  recenciaAlta: 30,
  recenciaMedia: 90,
  atrasado: 1.5,
  emRisco: 3,
  meiaVidaCompraDias: 90,
  janelaReclamacaoDias: 90,
  reclamacaoRecenteDias: 30,
  favoritos: 5,
  ultimasReclamacoes: 5,
  /** O perfil vale enquanto o cliente pede + este prazo (§3.5 do plano). A política de privacidade diz o mesmo número. */
  retencaoMeses: 12,
} as const;

/** O "o que pesou" da avaliação (mig 453, `OPCOES_DO_PESO`) → o motivo da reclamação. */
export const MOTIVO_DO_PESO: Record<string, string> = {
  'Tempo de entrega': 'atraso',
  Temperatura: 'chegou_frio',
  'Pedido completo': 'faltou_item',
  Sabor: 'sabor',
  Embalagem: 'embalagem',
  Preço: 'preco',
};

/** Como o motivo aparece para a equipe ("reclamou 2 vezes de atraso"). */
export const NOME_DO_MOTIVO: Record<string, string> = {
  atraso: 'atraso',
  chegou_frio: 'chegou frio',
  faltou_item: 'item faltando',
  sabor: 'sabor',
  embalagem: 'embalagem',
  preco: 'preço',
  pedido_errado: 'pedido errado',
  pediu_cancelamento: 'pedido de cancelamento',
  irritado: 'irritação no atendimento',
};

/** Os 27 códigos RFM nos 6 segmentos (os grupos da Klaviyo). */
export const SEGMENTO_DO_RFM: Record<string, string> = {
  '333': 'campeoes', '332': 'campeoes', '323': 'campeoes',
  '321': 'leais', '322': 'leais', '331': 'leais', '232': 'leais', '233': 'leais',
  '312': 'recentes', '313': 'recentes', '311': 'recentes', '222': 'recentes', '223': 'recentes',
  '213': 'atencao', '221': 'atencao', '123': 'atencao', '132': 'atencao', '133': 'atencao',
  '231': 'em_risco', '212': 'em_risco', '122': 'em_risco', '131': 'em_risco', '211': 'em_risco',
  '111': 'inativos', '112': 'inativos', '113': 'inativos', '121': 'inativos',
};

export const CANAIS_FORA_DO_PERFIL = ['ifood', '99food'] as const;

const R = REGRAS_DO_PERFIL;

/** A faixa do dia pela hora local (a madrugada é do dia de operação anterior). Também da hora habitual da campanha. */
export const faixa = (hora: SQL) => sql`case when ${hora} < 4 then 'madrugada' when ${hora} < 11 then 'manha'
  when ${hora} < 15 then 'almoco' when ${hora} < 18 then 'tarde' when ${hora} < 21 then 'inicio_noite' else 'noite' end`;

/**
 * A forma de pagamento em palavras, a partir do texto do pedido já em minúsculas. Cada canal grava o mesmo método com um
 * nome (`card`, `credit_card`, `money`, `vr`…): os códigos seguem `common/formas-pagamento-normaliza.ts`, com crédito e
 * débito juntos em "Cartão". `entrega` é a opção "Pagar na entrega" do cardápio; num pedido de retirada, "Na retirada".
 */
export const sqlFormaDoPerfil = (pag: SQL, tipo: SQL) => sql`case
  when ${pag} like '%pix%' then 'Pix'
  when ${pag} ~ '(dinheiro|esp[eé]cie|(^|[^a-z])(money|cash)([^a-z]|$))' then 'Dinheiro'
  when ${pag} ~ '(vale|refei[cç]|meal.?voucher|food.?voucher|ticket|sodexo|alelo|(^|[^a-z])(vr|va)([^a-z]|$))' then 'Vale-refeição'
  when ${pag} ~ '(cart[aã]o|cr[eé]dito|d[eé]bito|(^|[^a-z])(card|credit|debit|creditcard|debitcard|pos)([^a-z]|$))' then 'Cartão'
  when ${pag} ~ '(online|carteira|wallet|prepaid|pr[eé].?pago)' then 'Pago online'
  when ${pag} = 'entrega' then case when ${tipo} = 'retirada' then 'Na retirada' else 'Na entrega' end
  else 'Outro' end`;

/** O código RFM ('333') → o segmento, pela tabela acima (um `case` só, gerado). */
const segmentoSql = (codigo: SQL) =>
  sql.join(
    [
      sql`case ${codigo}`,
      ...Object.entries(SEGMENTO_DO_RFM).map(([k, v]) => sql`when ${k} then ${v}`),
      sql`end`,
    ],
    sql` `,
  );

const motivoDoPesoSql = (p: SQL) =>
  sql.join(
    [sql`case ${p}`, ...Object.entries(MOTIVO_DO_PESO).map(([k, v]) => sql`when ${k} then ${v}`), sql`end`],
    sql` `,
  );

const nomeDoMotivoSql = (m: SQL) =>
  sql.join(
    [sql`case ${m}`, ...Object.entries(NOME_DO_MOTIVO).map(([k, v]) => sql`when ${k} then ${v}`), sql`else ${m} end`],
    sql` `,
  );

/**
 * O `insert … on conflict do update` do perfil da empresa (ou de um cliente). Devolve `cliente_id` de cada linha gravada.
 * `temAvaliacao`: a tabela `pedido_avaliacao` existe (mig 453, só nuvem) — sem ela, as camadas de avaliação vêm vazias.
 */
export function sqlCalcularPerfis(
  tenantId: string,
  clienteId: string | null,
  temAvaliacao: boolean,
  modo: 'gravar' | 'conferir' = 'gravar',
): SQL {
  const soCliente = clienteId ? sql`and r.cliente_id = ${clienteId}::uuid` : sql``;
  // Com a regra do aviso ligada, só grava quem viu o aviso; o corte fica no fim para os números da loja virem de todos.
  const soAvisados = perfilSoComAviso() ? sql`and ${sqlFoiAvisado(sql`${tenantId}::uuid`, sql`r.cliente_id`)}` : sql``;
  const local = sql`(p.criado_em at time zone ${FUSO_SQL})`;
  const avaliacoes = temAvaliacao
    ? sql`select pe.cliente_id, a.criado_em as em, a.nota, a.pesou
            from pedido_avaliacao a
            join pedido_externo pe on pe.id = a.pedido_id and pe.tenant_id = a.tenant_id
           where a.tenant_id = ${tenantId}::uuid and pe.cliente_id is not null
             and coalesce(pe.canal, '') not in ('ifood', '99food')`
    : sql`select null::uuid as cliente_id, null::timestamptz as em, null::smallint as nota, null::text[] as pesou where false`;

  return sql`
with
nao as (
  select distinct on (e.cliente_id) e.cliente_id, e.valor
    from cliente_escolha e
   where e.tenant_id = ${tenantId}::uuid and e.escolha = 'nao_analisar'
   order by e.cliente_id, e.em desc
),
ped as materialized (
  select p.id, p.cliente_id, p.unidade_id, coalesce(p.total, 0)::numeric as total, p.criado_em, p.itens, p.tipo,
         p.agendamento, lower(coalesce(p.forma_pagamento, '')) as pag,
         ${local} as local,
         (${local} - make_interval(hours => ${R.corteDiaOperacaoHoras}::int))::date as dia_op
    from pedido_externo p
   where p.tenant_id = ${tenantId}::uuid and p.cliente_id is not null and p.status <> 'cancelado'
     and coalesce(p.canal, '') not in ('ifood', '99food')
     and not exists (select 1 from nao where nao.cliente_id = p.cliente_id and nao.valor)
),
base as (
  select cliente_id, count(*)::int as n, sum(total) as gasto, min(criado_em) as primeiro, max(criado_em) as ultimo,
         mode() within group (order by unidade_id) as unidade_id,
         case when count(*) > 1 then extract(epoch from (max(criado_em) - min(criado_em))) / 86400.0 / (count(*) - 1) end as intervalo,
         count(*) filter (where agendamento is not null)::int as agendados,
         count(*) filter (where tipo = 'retirada')::int as retiradas,
         count(*) filter (where extract(isodow from dia_op) in (5, 6, 7))::int as fds,
         mode() within group (order by ${sqlFormaDoPerfil(sql.raw('pag'), sql.raw('tipo'))}) as pagamento
    from ped group by cliente_id
),
pri as (
  select coalesce(sum(gasto) / nullif(sum(n), 0), 0) as ticket_loja,
         coalesce(percentile_cont(0.5) within group (order by intervalo) filter (where n >= 3), ${R.intervaloPadraoDias}) as intervalo_loja,
         coalesce(percentile_disc(0.5) within group (order by n) filter (where n >= 2), 2) as f_corte
    from base
),
calc as (
  select b.*,
         (${R.kTicket} * pri.ticket_loja + b.gasto) / (${R.kTicket} + b.n) as ticket_aj,
         case when b.n = 1 then pri.intervalo_loja
              else (${R.kIntervalo} * pri.intervalo_loja + (b.n - 1) * b.intervalo) / (${R.kIntervalo} + b.n - 1) end as intervalo_aj,
         extract(epoch from (now() - b.ultimo)) / 86400.0 as recencia,
         pri.f_corte
    from base b cross join pri
),
mc as (
  select percentile_cont(0.33) within group (order by ticket_aj) as m33,
         percentile_cont(0.66) within group (order by ticket_aj) as m66
    from calc
),
rfm as (
  select c.*,
         (case when c.recencia <= ${R.recenciaAlta} then 3 when c.recencia <= ${R.recenciaMedia} then 2 else 1 end)::text
         || (case when c.n = 1 then 1 when c.n >= c.f_corte then 3 else 2 end)::text
         || (case when c.ticket_aj > mc.m66 then 3 when c.ticket_aj > mc.m33 then 2 else 1 end)::text as codigo
    from calc c cross join mc
),
grade as (
  select cliente_id, extract(isodow from dia_op)::int as dia, ${faixa(sql`extract(hour from local)`)} as faixa, count(*)::int as n
    from ped group by 1, 2, 3
),
fx as (
  select distinct on (cliente_id) cliente_id, faixa, n
    from (select cliente_id, faixa, sum(n)::int as n from grade group by 1, 2) y
   order by cliente_id, n desc, faixa
),
dx as (
  select distinct on (cliente_id) cliente_id, dia, n
    from (select cliente_id, dia, sum(n)::int as n from grade group by 1, 2) y
   order by cliente_id, n desc, dia
),
grade_json as (
  select cliente_id, jsonb_object_agg(dia::text, faixas) as grade
    from (select cliente_id, dia, jsonb_object_agg(faixa, n) as faixas from grade group by 1, 2) z
   group by cliente_id
),
hora as (
  select q.cliente_id, count(*)::int as k,
         (((atan2(avg(sin(2 * pi() * q.m / 1440.0)), avg(cos(2 * pi() * q.m / 1440.0))) * 1440 / (2 * pi()))::numeric
           + 1440) % 1440)::int as minuto
    from (select p.cliente_id, extract(hour from p.local) * 60 + extract(minute from p.local) as m,
                 ${faixa(sql`extract(hour from p.local)`)} as faixa
            from ped p) q
    join fx on fx.cliente_id = q.cliente_id and fx.faixa = q.faixa
   group by q.cliente_id
),
it as (
  select p.cliente_id,
         coalesce(i->>'produtoId', i->>'codigo', lower(trim(i->>'descricao'))) as chave,
         max(i->>'descricao') as nome,
         count(distinct p.id)::int as pedidos,
         sum(power(2, -extract(epoch from (now() - p.criado_em)) / 86400.0 / ${R.meiaVidaCompraDias})) as peso
    from ped p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.itens) = 'array' then p.itens else '[]'::jsonb end) i
   where coalesce(trim(i->>'descricao'), '') <> ''
   group by 1, 2
),
fav as (
  select cliente_id,
         jsonb_agg(jsonb_build_object('nome', nome, 'pedidos', pedidos) order by peso desc, pedidos desc) as favoritos
    from (select it.*, row_number() over (partition by cliente_id order by peso desc, pedidos desc) as rn from it) z
   where rn <= ${R.favoritos}
   group by cliente_id
),
sempre as (
  select distinct on (it.cliente_id) it.cliente_id, it.nome, it.pedidos, it.chave
    from it join base b on b.cliente_id = it.cliente_id
   where b.n >= 3 and it.pedidos * 2 >= b.n
   order by it.cliente_id, it.pedidos desc, it.nome
),
aval as (${avaliacoes}),
recl as (
  select av.cliente_id, av.em, m.motivo, 'avaliacao'::text as origem, av.nota, null::text as situacao
    from aval av
    cross join lateral unnest(coalesce(av.pesou, '{}'::text[])) pz(p)
    cross join lateral (select ${motivoDoPesoSql(sql`pz.p`)} as motivo) m
   where av.nota <= 3 and m.motivo is not null
  union all
  select pe.cliente_id, ch.criado_em,
         case when ch.tipo = 'erro' then 'pedido_errado' when ch.tipo = 'cancelamento' then 'pediu_cancelamento' else 'irritado' end,
         'atendimento', null::smallint, ch.status
    from atendimento_chamado ch
    join pedido_externo pe on pe.id = ch.pedido_id and pe.tenant_id = ch.tenant_id
   where ch.tenant_id = ${tenantId}::uuid and pe.cliente_id is not null
     and coalesce(pe.canal, '') not in ('ifood', '99food')
     and (ch.tipo in ('erro', 'cancelamento') or (ch.prioridade = 'urgente' and ch.tipo <> 'avaliacao'))
),
recl_grupo as (
  select cliente_id,
         jsonb_agg(jsonb_build_object('motivo', motivo, 'nome', nome, 'vezes', vezes, 'datas', datas) order by vezes desc, ultima desc) as grupos,
         max(vezes) as max_vezes
    from (select cliente_id, motivo, ${nomeDoMotivoSql(sql`motivo`)} as nome, count(*)::int as vezes, max(em) as ultima,
                 jsonb_agg(to_char(em at time zone ${FUSO_SQL}, 'YYYY-MM-DD') order by em desc) as datas
            from recl where em >= now() - make_interval(days => ${R.janelaReclamacaoDias}::int)
           group by 1, 2) g
   group by cliente_id
),
recl_ult as (
  select cliente_id, count(*)::int as total, max(em) as ultima,
         jsonb_agg(jsonb_build_object('em', em, 'motivo', motivo, 'nome', ${nomeDoMotivoSql(sql`motivo`)}, 'origem', origem,
                                      'nota', nota, 'situacao', situacao) order by em desc)
           filter (where rn <= ${R.ultimasReclamacoes}) as ultimas
    from (select r.*, row_number() over (partition by cliente_id order by em desc) as rn from recl r) x
   group by cliente_id
),
aval_res as (
  select cliente_id, count(*)::int as quantas, round(avg(nota)::numeric, 1) as media,
         jsonb_agg(nota order by em desc) filter (where rn <= 3) as ultimas,
         avg(nota) filter (where rn <= 3) as media_rec, avg(nota) filter (where rn between 4 and 6) as media_ant
    from (select a.*, row_number() over (partition by cliente_id order by em desc) as rn from aval a) x
   group by cliente_id
),
pesa as (
  select distinct on (cliente_id) cliente_id, p as mais_pesa
    from (select a.cliente_id, p, count(*) as n from aval a cross join lateral unnest(coalesce(a.pesou, '{}'::text[])) p
           where a.nota <= 3 group by 1, 2) y
   order by cliente_id, n desc, p
),
fim as (
  select r.cliente_id, r.unidade_id, r.n, r.primeiro, r.ultimo, r.gasto, r.codigo,
         ${segmentoSql(sql`r.codigo`)} as segmento,
         round(r.gasto / r.n, 2) as ticket_medio,
         round(r.ticket_aj, 2) as ticket_aj,
         round(r.intervalo_aj::numeric, 2) as intervalo_aj,
         case when r.n >= 2 then (r.ultimo at time zone ${FUSO_SQL})::date + round(r.intervalo_aj)::int end as proximo,
         case when r.n >= 2 then round((r.recencia / nullif(r.intervalo_aj, 0))::numeric, 2) end as atraso,
         r.recencia, r.agendados, r.retiradas, r.fds, r.pagamento,
         case when r.n >= 3 then fx.faixa end as faixa,
         case when r.n >= 3 then dx.dia end as dia,
         case when hora.k >= 3 then lpad((hora.minuto / 60)::text, 2, '0') || ':' || lpad((hora.minuto % 60)::text, 2, '0') end as hora_habitual,
         case when r.n >= 10 then 'alta' when r.n >= 3 then 'media' else 'baixa' end as confianca,
         gj.grade, fav.favoritos, sempre.nome as de_sempre, sempre.pedidos as de_sempre_pedidos, sempre.chave as de_sempre_chave,
         rg.grupos as recl_grupos, coalesce(rg.max_vezes, 0) as recl_max, ru.total as recl_total, ru.ultima as recl_ultima,
         ru.ultimas as recl_ultimas, ar.quantas as aval_quantas, ar.media as aval_media, ar.ultimas as aval_ultimas,
         case when ar.media_ant is null then null when ar.media_rec < ar.media_ant - 0.5 then 'piorando'
              when ar.media_rec > ar.media_ant + 0.5 then 'melhorando' else 'estavel' end as aval_tendencia,
         pesa.mais_pesa
    from rfm r
    left join fx on fx.cliente_id = r.cliente_id
    left join dx on dx.cliente_id = r.cliente_id
    left join hora on hora.cliente_id = r.cliente_id
    left join grade_json gj on gj.cliente_id = r.cliente_id
    left join fav on fav.cliente_id = r.cliente_id
    left join sempre on sempre.cliente_id = r.cliente_id
    left join recl_grupo rg on rg.cliente_id = r.cliente_id
    left join recl_ult ru on ru.cliente_id = r.cliente_id
    left join aval_res ar on ar.cliente_id = r.cliente_id
    left join pesa on pesa.cliente_id = r.cliente_id
   where r.ultimo >= now() - make_interval(months => ${R.retencaoMeses}::int) ${soCliente} ${soAvisados}
),
etq as (
  select f.cliente_id,
         array_remove(array[
           case when f.n = 1 and f.recencia <= 30 then 'novo' end,
           case when f.segmento = 'campeoes' then 'campeao' end,
           case when f.n >= 2 and f.atraso > ${R.emRisco} then 'em_risco'
                when f.n >= 2 and f.atraso > ${R.atrasado} then 'atrasado' end,
           case when f.recl_ultima >= now() - make_interval(days => ${R.reclamacaoRecenteDias}::int) then 'reclamou_recente' end,
           case when f.recl_max >= 2 then 'reclamou_repetido' end,
           case when f.agendados >= 2 then 'pede_agendado' end,
           case when f.n >= 3 and f.retiradas = f.n then 'so_retira' end,
           case when f.n >= 3 and f.fds * 10 >= f.n * 8 then 'fim_de_semana' end
         ], null) as etiquetas,
         jsonb_strip_nulls(jsonb_build_object(
           'em_risco', case when f.n >= 2 and f.atraso > ${R.emRisco} then format('%s dias sem pedir; o intervalo habitual é de %s dias (%s×; o limite é %s)',
              floor(f.recencia)::int, round(f.intervalo_aj)::int, replace(f.atraso::text, '.', ','), replace(${R.emRisco}::text, '.', ',')) end,
           'atrasado', case when f.n >= 2 and f.atraso > ${R.atrasado} and f.atraso <= ${R.emRisco} then format('%s dias sem pedir; o intervalo habitual é de %s dias (%s×; o limite é %s)',
              floor(f.recencia)::int, round(f.intervalo_aj)::int, replace(f.atraso::text, '.', ','), replace(${R.atrasado}::text, '.', ',')) end,
           'campeao', case when f.segmento = 'campeoes' then format('recência, frequência e valor no topo da loja (%s)', f.codigo) end,
           'reclamou_repetido', case when f.recl_max >= 2 then format('o mesmo motivo %s vezes em %s dias', f.recl_max, ${R.janelaReclamacaoDias}::int) end
         )) as porque
    from fim f
)
${modo === 'conferir' ? sqlConferir() : sqlGravar(tenantId)}`;
}

/** Só conta (sem gravar): a prévia do que a rotina faria — para conferir contra o banco real só lendo (V6). */
function sqlConferir(): SQL {
  return sql`
select sum(s.n)::int as clientes,
       jsonb_object_agg(coalesce(s.segmento, '-'), s.n) as segmentos,
       (select jsonb_object_agg(x, n) from (select x, count(*)::int as n from etq, unnest(etiquetas) x group by x) z) as etiquetas,
       (select count(*)::int from fim where de_sempre is not null) as com_de_sempre,
       (select count(*)::int from fim where recl_total > 0) as com_reclamacao,
       (select count(*)::int from fim where hora_habitual is not null) as com_hora
  from (select segmento, count(*)::int as n from fim group by segmento) s`;
}

function sqlGravar(tenantId: string): SQL {
  return sql`
insert into cliente_perfil as cp (
  cliente_id, tenant_id, unidade_id, pedidos_diretos, primeiro_pedido_em, ultimo_pedido_em, segmento, rfm,
  ticket_medio, ticket_ajustado, intervalo_dias, proximo_previsto, atraso, faixa_habitual, dia_habitual, confianca,
  etiquetas, camadas, calculado_em, versao)
select f.cliente_id, ${tenantId}::uuid, f.unidade_id, f.n, f.primeiro, f.ultimo, f.segmento, f.codigo,
       f.ticket_medio, f.ticket_aj, f.intervalo_aj, f.proximo, f.atraso, f.faixa, f.dia, f.confianca,
       e.etiquetas,
       jsonb_build_object(
         'gosto', jsonb_strip_nulls(jsonb_build_object(
           'favoritos', coalesce(f.favoritos, '[]'::jsonb),
           'de_sempre', case when f.de_sempre is not null then jsonb_build_object('nome', f.de_sempre, 'pedidos', f.de_sempre_pedidos, 'chave', f.de_sempre_chave) end,
           'pagamento', f.pagamento,
           'retirada_pct', round(100.0 * f.retiradas / f.n))),
         'ritmo', jsonb_strip_nulls(jsonb_build_object(
           'grade', coalesce(f.grade, '{}'::jsonb), 'hora_habitual', f.hora_habitual,
           'recencia_dias', floor(f.recencia)::int)),
         'valor', jsonb_build_object('gasto', round(f.gasto, 2), 'r', substr(f.codigo, 1, 1)::int,
           'f', substr(f.codigo, 2, 1)::int, 'm', substr(f.codigo, 3, 1)::int),
         'reclamacoes', jsonb_strip_nulls(jsonb_build_object(
           'grupos', coalesce(f.recl_grupos, '[]'::jsonb), 'total', coalesce(f.recl_total, 0),
           'ultimas', coalesce(f.recl_ultimas, '[]'::jsonb), 'janela_dias', ${R.janelaReclamacaoDias}::int)),
         'avaliacoes', jsonb_strip_nulls(jsonb_build_object(
           'quantas', coalesce(f.aval_quantas, 0), 'media', f.aval_media, 'ultimas', f.aval_ultimas,
           'tendencia', f.aval_tendencia, 'mais_pesa', f.mais_pesa)),
         'porque', e.porque),
       now(), ${R.versao}
  from fim f join etq e on e.cliente_id = f.cliente_id
on conflict (cliente_id) do update set
  tenant_id = excluded.tenant_id, unidade_id = excluded.unidade_id, pedidos_diretos = excluded.pedidos_diretos,
  primeiro_pedido_em = excluded.primeiro_pedido_em, ultimo_pedido_em = excluded.ultimo_pedido_em,
  segmento = excluded.segmento, rfm = excluded.rfm, ticket_medio = excluded.ticket_medio,
  ticket_ajustado = excluded.ticket_ajustado, intervalo_dias = excluded.intervalo_dias,
  proximo_previsto = excluded.proximo_previsto, atraso = excluded.atraso, faixa_habitual = excluded.faixa_habitual,
  dia_habitual = excluded.dia_habitual, confianca = excluded.confianca, etiquetas = excluded.etiquetas,
  camadas = excluded.camadas, calculado_em = excluded.calculado_em, versao = excluded.versao
returning cp.cliente_id`;
}
