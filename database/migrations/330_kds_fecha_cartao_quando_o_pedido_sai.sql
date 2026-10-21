-- 330 — O cartão da cozinha fecha quando o pedido sai da loja, e os cartões esquecidos saem do KDS
-- (auditoria do KDS de 20/10/2026; decisão do dono: "limpo e corrijo o fluxo").
--
-- Na auditoria, uma tela do KDS mostrava 904 cartões abertos, do mais antigo para o mais novo — 854 com mais de um dia.
-- Os pedidos deles já tinham saído da loja pela tela de delivery, pelo PDV › Retirada ou pelo canal (518 da Anota Aí
-- concluídos com o cartão "recebido"), mas só o KDS mudava a situação do cartão. Com a tela lotada, a cozinha parou de
-- usar o KDS em 11/10.
--
-- O que esta migration faz:
--  1. gatilho `trg_pedido_externo_fecha_producao`, por linha, quando a situação de um pedido de canal MUDA para
--     despachado, entregue ou concluído: os cartões ainda abertos da comanda (recebido, preparo, pronto) passam a
--     'entregue', com a data de entrega. Vale para todos os caminhos — tela de delivery, PDV › Retirada, eventos dos
--     canais, app do entregador e a sincronização. `updated_at` vai escrito: numa sessão de sincronização
--     (`regem.sync`) o `bump_updated_at` não mexe na data, e é a data nova que faz o cartão fechado chegar ao outro lado.
--     O TOTEM fica de fora: o pedido pago conclui sozinho ao ficar pronto, e a senha precisa seguir na tela de "pronto"
--     até o cliente buscar.
--  2. SÓ NA NUVEM, uma vez: fecha os cartões abertos de pedidos que já saíram da loja e os cartões abertos com mais de
--     um dia — menos os de encomenda cujo horário ainda não passou (agendamento nas últimas 12 horas ou no futuro) —, com
--     uma linha de auditoria por empresa, encadeada como o AuditoriaService faz. Os tempos de preparo desses cartões
--     ficam vazios (não entram na média). O servidor da loja recebe os cartões fechados pela sincronização.
-- Idempotente; função e gatilho por `create or replace` (Postgres 14+); não apaga nada.
set local lock_timeout = '5s';

create or replace function producao_fecha_ao_sair_da_loja() returns trigger
language plpgsql as $$
begin
  update producao_pedido pp
     set status = 'entregue', entregue_em = coalesce(pp.entregue_em, now()), updated_at = now()
   where pp.tenant_id = new.tenant_id
     and pp.comanda_id = new.comanda_id
     and pp.status in ('recebido', 'preparo', 'pronto');
  return null;
end;
$$;

create or replace trigger trg_pedido_externo_fecha_producao
  after update of status on pedido_externo
  for each row
  when (new.comanda_id is not null
        and new.canal is distinct from 'totem'
        and new.status in ('despachado', 'entregue', 'concluido')
        and old.status is distinct from new.status)
  execute function producao_fecha_ao_sair_da_loja();

do $$
declare
  c_marca constant text := 'Fechado pela migration 330 (pedido já saiu da loja ou cartão com mais de 1 dia).';
  c_criterio constant text := 'cartões abertos de pedido que já saiu da loja, ou com mais de 1 dia (menos encomenda ainda por fazer)';
  v_por_empresa jsonb;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_canon text;
begin
  -- Servidor da loja: não tem `edge_status`; os cartões fechados chegam pela sincronização.
  if to_regclass(current_schema() || '.edge_status') is null then
    return;
  end if;

  with fechados as (
    update producao_pedido pp
       set status = 'entregue',
           entregue_em = coalesce(pp.entregue_em, now()),
           updated_at = now(),
           obs = case when coalesce(pp.obs, '') = '' then c_marca else pp.obs || ' · ' || c_marca end
     where pp.status in ('recebido', 'preparo', 'pronto')
       and (exists (select 1 from pedido_externo pe
                     where pe.tenant_id = pp.tenant_id and pe.comanda_id = pp.comanda_id
                       and pe.canal is distinct from 'totem'
                       and pe.status in ('despachado', 'entregue', 'concluido'))
            or (pp.criado_em < now() - interval '1 day'
                and not exists (select 1 from pedido_externo pe
                                 where pe.tenant_id = pp.tenant_id and pe.comanda_id = pp.comanda_id
                                   and pe.agendamento is not null and pe.agendamento > now() - interval '12 hours')))
    returning pp.tenant_id
  )
  select coalesce(jsonb_object_agg(x.tenant_id::text, x.n), '{}'::jsonb)
    into v_por_empresa
    from (select tenant_id, count(*)::int as n from fechados group by tenant_id) x;

  for r in select key::uuid as tenant_id, value::text as n from jsonb_each(v_por_empresa) order by key loop
    perform pg_advisory_xact_lock(hashtext(r.tenant_id::text), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    -- Forma canônica do AuditoriaService (chaves em ordem; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('fechou_cartoes_kds'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"cards":' || to_json(r.n)::text
            ||       ',"criterio":' || to_json(c_criterio)::text
            ||       ',"migration":' || to_json('330'::text)::text || '}'
            || ',"ei":null'
            || ',"et":' || to_json('kds'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id::text)::text
            || ',"ti":' || to_json('producao'::text)::text
            || ',"u":null'
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id, null, 'distribuicao', null, 'servico', 'producao', 'fechou_cartoes_kds', 'kds', null,
            jsonb_build_object('cards', r.n, 'criterio', c_criterio, 'migration', '330'), 'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — o gatilho existe e, na nuvem, não sobrou cartão aberto de pedido que
-- já saiu da loja nem cartão aberto com mais de um dia (fora encomenda ainda por fazer). No servidor da loja (sem
-- `edge_status`) a conferência dos cartões não se aplica: lá eles chegam pela sincronização.
select (x.gatilho and (not x.nuvem or (x.abertos_de_pedido_que_saiu = 0 and x.abertos_com_mais_de_1_dia = 0))) as ok, x.*
  from (
    select
      exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
               where c.relname = 'pedido_externo' and t.tgname = 'trg_pedido_externo_fecha_producao'
                 and c.relnamespace = current_schema()::regnamespace) as gatilho,
      to_regclass(current_schema() || '.edge_status') is not null as nuvem,
      (select count(*) from producao_pedido pp
        where pp.status in ('recebido', 'preparo', 'pronto')
          and exists (select 1 from pedido_externo pe
                       where pe.tenant_id = pp.tenant_id and pe.comanda_id = pp.comanda_id
                         and pe.canal is distinct from 'totem'
                         and pe.status in ('despachado', 'entregue', 'concluido'))) as abertos_de_pedido_que_saiu,
      (select count(*) from producao_pedido pp
        where pp.status in ('recebido', 'preparo', 'pronto') and pp.criado_em < now() - interval '1 day'
          and not exists (select 1 from pedido_externo pe
                           where pe.tenant_id = pp.tenant_id and pe.comanda_id = pp.comanda_id
                             and pe.agendamento is not null and pe.agendamento > now() - interval '12 hours')) as abertos_com_mais_de_1_dia,
      (select count(*) from producao_pedido where obs like '%Fechado pela migration 330%') as fechados_pela_330,
      (select count(*) from audit_log where acao = 'fechou_cartoes_kds') as auditoria
  ) x;
