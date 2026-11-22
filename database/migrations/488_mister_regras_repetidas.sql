-- @cloud-only
-- 488 — MISTER: as regras repetidas de antes da correção do ERR-561 (pedido do dono em 22/11/2026: "apague as regras
-- duplicadas", sem precisar pedir de novo ao Mister).
--
-- Até o PR #1255, a regra que junta os pedidos parados não calava o aviso um a um, e o Mister podia criar a mesma regra
-- duas vezes. Esta migration vale só para regras criadas ANTES da correção, de pedidos EM PREPARO, por quantidade, numa
-- mensagem só, com tempo e sem nenhum aviso substituído:
--   • das iguais da mesma pessoa, fica a primeira ligada; as outras vão para `apagada` (a linha fica, nada é excluído);
--   • a que fica passa a substituir o aviso "pedido parado" da etapa em preparo, como a regra nova já faz, e o resumo diz isso.
-- A auditoria grava uma linha por empresa, com os ids. Idempotente: depois de rodar, nenhuma regra casa com o critério.
set local lock_timeout = '5s';

do $$
declare
  c_antes constant timestamptz := timestamptz '2026-11-22 05:00:00-03';
  c_frase constant text := ' O aviso "pedido parado (em preparo)" deixa de chegar no seu WhatsApp enquanto a regra estiver ligada.';
  r record;
  v_ult record;
  v_seq bigint;
  v_prev text;
  v_canon text;
begin
  for r in
    with alvo as (
      select x.id, x.tenant_id,
             row_number() over (partition by x.tenant_id, x.colaborador_id, x.regra - 'titulo' - 'substitui'
                                order by x.ativada_em nulls last, x.criada_em, x.id) as n
        from mister_regra x
       where x.situacao in ('ativa', 'pausada')
         and x.criada_em < c_antes
         and x.fonte = 'pedidos'
         and coalesce(cardinality(x.substitui), 0) = 0
         and x.regra ->> 'medida' = 'quantidade'
         and x.regra ->> 'agrupar' = 'true'
         and x.regra -> 'condicao' ->> 'op' in ('>=', '>')
         and exists (select 1 from jsonb_array_elements(x.regra -> 'filtros') f
                      where f ->> 'campo' = 'situacao' and f ->> 'op' = '=' and f ->> 'valor' = 'em_preparo')
         and exists (select 1 from jsonb_array_elements(x.regra -> 'filtros') f
                      where f ->> 'campo' in ('min_desde_aceite', 'min_desde_chegada') and f ->> 'op' in ('>', '>='))
    )
    select a.tenant_id::text as tenant_id,
           coalesce(array_agg(a.id::text order by a.id::text) filter (where a.n > 1), '{}') as apagadas,
           coalesce(array_agg(a.id::text order by a.id::text) filter (where a.n = 1), '{}') as ficaram
      from alvo a
     group by a.tenant_id
     order by 1
  loop
    update mister_regra
       set situacao = 'apagada', apagada_em = clock_timestamp(), atualizada_em = clock_timestamp()
     where id = any(r.apagadas::uuid[]);

    update mister_regra
       set substitui = '{pedido_parado:confirmado}',
           regra = regra || '{"substitui":["pedido_parado:confirmado"]}'::jsonb,
           resumo = resumo || c_frase,
           atualizada_em = clock_timestamp()
     where id = any(r.ficaram::uuid[]);

    -- A cadeia da auditoria, na forma canônica do AuditoriaService (chaves em ordem; `at` porque o ator não é 'usuario').
    perform pg_advisory_xact_lock(hashtext(r.tenant_id), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id::uuid and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    v_canon := '{"ac":' || to_json('mister_regras_repetidas'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"apagadas":' || to_json(r.apagadas)::text
            ||       ',"ficaram":' || to_json(r.ficaram)::text
            ||       ',"migration":' || to_json('488'::text)::text || '}'
            || ',"ei":null'
            || ',"et":' || to_json('mister_regra'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id)::text
            || ',"ti":' || to_json('config'::text)::text
            || ',"u":null'
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id::uuid, null, 'distribuicao', null, 'servico', 'config', 'mister_regras_repetidas', 'mister_regra', null,
            jsonb_build_object('apagadas', to_jsonb(r.apagadas), 'ficaram', to_jsonb(r.ficaram), 'migration', '488'),
            'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — nenhuma pessoa com duas regras iguais vivas, e nenhuma regra de pedidos
-- em preparo por quantidade, de antes da correção, sem substituir o aviso.
select not exists (
         select 1 from mister_regra x
          where x.situacao in ('ativa', 'pausada')
          group by x.tenant_id, x.colaborador_id, x.regra - 'titulo' - 'substitui'
         having count(*) > 1
       ) as ok,
       count(*) filter (where situacao = 'ativa') as ativas,
       count(*) filter (where situacao = 'apagada') as apagadas,
       count(*) filter (where situacao = 'ativa' and 'pedido_parado:confirmado' = any(substitui)) as no_lugar_do_aviso
  from mister_regra;
