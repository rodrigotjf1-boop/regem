-- @cloud-only
-- 513 — Código PDV dos adicionais (opções do catálogo) de uma loja pelo Anota Aí, com o iFood e a 99 onde ele não tem
-- (pedido do dono em 27/11/2026: "tenho que ter um código único nos 3 canais para os mesmos produtos. Vamos nos basear
-- pelos códigos PDV que estão no Anota Aí e aplicar no Regem. Os itens que faltarem código PDV procuramos no iFood e 99";
-- depois ele acerta nos portais o que estiver diferente do Regem). Continua a 331, que fez o mesmo com os produtos.
--
-- O adicional que o canal manda liga à opção do produto pelo código PDV (`resolverComplementosPorCodigo`); as opções
-- desta loja vieram da importação do Cardápio Web com os códigos dela ("cw…", "33c0o…"), e NENHUM dos 14.152 adicionais
-- de 60 dias ligou: sem a ligação o adicional não baixa estoque. A lista foi montada pelo histórico de pedidos (os
-- produtos já têm o mesmo código nos três canais): para cada opção, o código do Anota Aí no MESMO produto (pelo nome);
-- sem ele, o do iFood e depois o da 99; e o Anota Aí pelo nome em qualquer produto (uma opção). Ficam de fora: as já
-- certas, a opção repetida no mesmo grupo (o dono tira pela tela) e os sabores de suco e vitamina (cada tamanho tem um
-- código no Anota Aí e o Regem tem um grupo só para os dois tamanhos — decisão do dono).
--
-- O que faz, numa transação (o bloco):
--   • troca `opcao.codigo_pdv` SÓ onde ele ainda é o lido em 27/11 (`de`): troca feita depois pela tela não é sobrescrita;
--   • troca o mesmo código nas cópias vivas dentro de cada produto (`complemento_opcao.origem_opcao_id`) — é por elas que
--     o pedido do canal casa, e é o que a materialização faria (ela copia o código da opção);
--   • `updated_at` anda nas duas para a mudança descer ao servidor da loja (as duas sincronizam: 'ambos', LWW);
--   • recusa INTEIRA (nada muda) se algum produto ficar com o mesmo código em duas opções — a mesma regra da tela
--     (`trocarCodigosPdv`): o canal acha a opção pelo código dentro do produto;
--   • uma linha de auditoria por empresa, `trocou_codigo_pdv` como a da tela, com o antes de cada opção (`trocas`), para
--     desfazer se preciso — encadeada como o AuditoriaService faz (o mesmo molde da 331 e da 467).
-- Só o id da opção e os códigos ficam aqui (nome de opção e de loja fora do repositório — regra de dado sensível; o nome
-- vai para a auditoria, lido do banco). Idempotente: a segunda execução não acha nada com o código de antes e não audita.
-- Opção excluída ou que não existe fica de fora (fora da nuvem de produção, nada muda). Não mexe no iFood, na 99 nem no
-- Anota Aí: o dono acerta os portais pelo Regem. O GoGeM casa as opções pelo nome no grupo e regrava o código na
-- importação seguinte.
set local lock_timeout = '5s';

do $$
declare
  c_criterio constant text := 'código PDV do Anota Aí nos adicionais; sem ele, o do iFood e o da 99 (pedido do dono em 27/11/2026)';
  v_alvo jsonb;
  v_conflito text;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_canon text;
begin
  -- Servidor da loja: não tem `edge_status`; os códigos chegam pela sincronização do cadastro.
  if to_regclass(current_schema() || '.edge_status') is null then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id::text, 'tenant', o.tenant_id::text, 'nome', o.nome,
                                               'de', l.de, 'para', l.para)
                            order by o.tenant_id, o.id), '[]'::jsonb)
    into v_alvo
    from opcao o
    join (values
      ('4bbe05b2-f031-4b67-8c66-1f805eaac465'::uuid, 'cw4620845c2o0', '45'),
      ('85c19686-3af0-48f6-8cc7-1da5be256e3a'::uuid, 'cw4620846c0o0', '105'),
      ('a4025eed-b894-4c87-bbe4-916935b6f9ae'::uuid, 'cw4620878c0o0', '131'),
      ('20b33508-073e-4bec-b8c6-e4668f310e76'::uuid, 'cw4620843c1o0', '2'),
      ('ab32993f-ddde-4522-99f6-002526394070'::uuid, 'cw4620845c1o0', '3'),
      ('fa0cd49d-7c76-4671-8c65-86967ff69e7f'::uuid, 'cw4620851c1o1', '4'),
      ('76573da1-65b6-4e28-a3a0-a49d6e14df5a'::uuid, 'cw4620851c1o0', '5'),
      ('e528410a-07ee-4d19-a625-2b8c25fbc962'::uuid, 'cw4620860c1o0', '114'),
      ('7ced42d1-013a-4753-84dc-4037108cd03a'::uuid, 'cw4620865c0o6', '100'),
      ('122d2bb4-f527-41a3-9225-bbd1be42c3cd'::uuid, 'cw4620861c0o2', '101'),
      ('7622b974-505d-4a86-b0cd-9fc303b60d08'::uuid, '33c0o4', '94'),
      ('82342373-9bff-4510-a280-cd277ff6a12f'::uuid, 'cw4620852c2o0', '10'),
      ('f4e316f3-9847-4b10-83ca-1191323ec092'::uuid, 'cw4620843c2o0', '9'),
      ('99f57a54-b2d5-4399-8bd4-e4da35766bf4'::uuid, 'cw4620852c2o4', '11'),
      ('22e3c80d-91f5-4747-b570-fa417330e1f4'::uuid, 'cw4620865c0o1', '134'),
      ('33b64164-892f-48ec-8c1a-eff87ca962ef'::uuid, 'cw4620878c0o2', '134'),
      ('700375c0-abd3-40cc-8670-d30ba9670dd3'::uuid, 'cw4620861c0o0', '134'),
      ('ce66c0ca-c0eb-4e72-a6a3-953bdc5b9976'::uuid, '33c0o5', '134'),
      ('47dfa80d-c0d5-466e-9302-9af328b0a0a1'::uuid, 'cw4620852c2o1', '18'),
      ('a6f93bd1-27f5-4808-9a4b-1614e5031f77'::uuid, 'cw4620852c2o2', '20'),
      ('28ed1e12-f569-4b02-a865-5d4c057a9d2d'::uuid, 'cw4620878c0o8', '99'),
      ('6782a2b3-a504-4f7b-9c47-2a8c3dfee1a2'::uuid, 'cw4620865c0o4', '96'),
      ('e50d4086-2e10-4820-9e00-6adcb9fcb925'::uuid, 'cw4620878c0o7', '96'),
      ('cfea60e0-f914-41cb-8703-60a0b24ceb02'::uuid, '33c0o6', '96'),
      ('fe5708dd-433a-4526-ba95-06b4927142b6'::uuid, 'cw4620861c0o1', '96'),
      ('0c66f4ca-f2bc-4a27-be1b-97bb8ba43de4'::uuid, 'cw4620852c2o3', '24'),
      ('664daca2-ea95-4994-8a24-0aaa78c0f0a2'::uuid, 'cw4620840c2o0', '25'),
      ('598516a7-1250-4d7a-8a82-69f46649ac53'::uuid, 'cw4620852c2o5', '26'),
      ('b3acc6cd-7197-4d71-8d2e-5a82f2d02d0a'::uuid, 'cw4620878c0o1', '103'),
      ('1364f53e-671e-4d6c-8d76-b89422502b27'::uuid, '33c0o2', '103'),
      ('a0042d2b-80bf-41d9-9c97-0538b097b36d'::uuid, 'cw4620865c0o0', '103'),
      ('ff0fa3ba-4f2a-4da2-b25f-91bccee73304'::uuid, 'cw4620861c0o3', '103'),
      ('f28b4301-a870-4495-a307-db058d2681c3'::uuid, 'cw4620878c0o3', '133'),
      ('9136d9b9-8ede-4760-b218-bc2426c98622'::uuid, 'cw4620845c0o0', '46'),
      ('d5c16569-b9c3-4e3a-82d9-72ce3d6c3429'::uuid, 'cw4620840c0o0', '52'),
      ('61021a99-cda9-4c7b-8979-26671bb0ce50'::uuid, 'cw4620843c0o0', '53'),
      ('a8ef3e3b-6b19-4f87-9799-f3afad88f018'::uuid, 'cw4620865c0o2', '93'),
      ('7f69c5ee-6c33-4a69-8a7a-6bc97571f4e4'::uuid, 'cw4620878c0o4', '93'),
      ('903e4053-f5f4-4e42-be48-6cd319ae2a04'::uuid, 'cw4620861c0o4', '93'),
      ('c7b89f6a-10ef-4c25-b2df-e8eee9162a4c'::uuid, '33c0o1', '93'),
      ('c4484fdb-4e74-4b2c-822f-82e9a26ca698'::uuid, 'cw4620878c0o6', '95'),
      ('41dd0830-f08d-4481-b98b-64591475134f'::uuid, 'cw4620865c0o5', '95'),
      ('0b9ab5f4-9e9e-45df-955d-e45f2f71c31f'::uuid, 'cw4620861c0o6', '95'),
      ('61744300-08e8-419c-b8fd-4d9a8738aea7'::uuid, '33c0o3', '95'),
      ('a5c71726-8e31-496d-9dd1-d066285388b8'::uuid, 'cw4620852c2o6', '64'),
      ('ae244b0d-2c85-4cfc-b7ad-1b1cc6688af0'::uuid, 'cw4620840c0o1', '81')
    ) as l(opcao_id, de, para) on l.opcao_id = o.id
   where o.deleted_at is null
     and btrim(o.codigo_pdv) = l.de;

  if jsonb_array_length(v_alvo) = 0 then
    return;
  end if;

  update opcao o
     set codigo_pdv = e->>'para',
         updated_at = now()
    from jsonb_array_elements(v_alvo) e
   where o.id = (e->>'id')::uuid;

  -- As cópias dentro de cada produto (a materialização copia o código da opção; a cópia sem código é a informativa, que
  -- não existe nesta lista — conferido na nuvem antes: 0).
  update complemento_opcao co
     set codigo_pdv = e->>'para',
         updated_at = now()
    from jsonb_array_elements(v_alvo) e
   where co.origem_opcao_id = (e->>'id')::uuid
     and co.tenant_id = (e->>'tenant')::uuid
     and co.deleted_at is null
     and nullif(btrim(co.codigo_pdv), '') is not null;

  -- A regra da tela: um código liga a UMA opção dentro do produto (a mesma opção em dois grupos conta uma vez).
  select string_agg(x.codigo || ' no produto ' || x.produto_id::text, '; ' order by x.produto_id, x.codigo)
    into v_conflito
    from (
      select g.produto_id, btrim(co.codigo_pdv) as codigo
        from complemento_opcao co
        join complemento_grupo g on g.id = co.grupo_id and g.deleted_at is null
       where co.deleted_at is null
         and btrim(co.codigo_pdv) in (select e->>'para' from jsonb_array_elements(v_alvo) e)
         and g.produto_id in (
           select g2.produto_id
             from complemento_opcao co2
             join complemento_grupo g2 on g2.id = co2.grupo_id and g2.deleted_at is null
            where co2.deleted_at is null
              and co2.origem_opcao_id in (select (e->>'id')::uuid from jsonb_array_elements(v_alvo) e))
       group by g.produto_id, btrim(co.codigo_pdv)
      having count(distinct coalesce(co.origem_opcao_id::text, co.id::text)) > 1
    ) x;
  if v_conflito is not null then
    raise exception '513: o mesmo código ficaria em mais de uma opção do mesmo produto (%). Nada foi trocado.', v_conflito;
  end if;

  -- Auditoria: uma linha por empresa, com o antes de cada opção (`trocas`, para desfazer se preciso).
  for r in
    select e->>'tenant' as tenant_id,
           count(*)::int as n,
           jsonb_agg(jsonb_build_object('de', e->>'de', 'id', e->>'id', 'nome', e->>'nome', 'para', e->>'para', 'tipo', 'opcao')
                     order by e->>'id') as trocas,
           '[' || string_agg('{"de":' || to_json(e->>'de')::text
                             || ',"id":' || to_json(e->>'id')::text
                             || ',"nome":' || coalesce(to_json(e->>'nome')::text, 'null')
                             || ',"para":' || to_json(e->>'para')::text
                             || ',"tipo":"opcao"}', ',' order by e->>'id') || ']' as trocas_txt
      from jsonb_array_elements(v_alvo) e
     group by e->>'tenant'
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(r.tenant_id), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id::uuid and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    -- Forma canônica do AuditoriaService (chaves em ordem em todos os níveis; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('trocou_codigo_pdv'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"criterio":' || to_json(c_criterio)::text
            ||       ',"migration":' || to_json('513'::text)::text
            ||       ',"opcoes":' || r.n::text
            ||       ',"origem":' || to_json('migracao'::text)::text
            ||       ',"trocas":' || r.trocas_txt || '}'
            || ',"ei":null'
            || ',"et":' || to_json('catalogo'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id)::text
            || ',"ti":' || to_json('cadastro'::text)::text
            || ',"u":null'
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id::uuid, null, 'distribuicao', null, 'servico', 'cadastro', 'trocou_codigo_pdv', 'catalogo', null,
            jsonb_build_object('criterio', c_criterio, 'migration', '513', 'opcoes', r.n, 'origem', 'migracao',
                               'trocas', r.trocas),
            'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — na nuvem, nenhuma opção da lista que existe (e não foi excluída) ficou
-- com o código de antes, nenhuma cópia viva dela também, e nenhum produto tem o mesmo código em duas opções. À parte:
-- quantas estão com o código novo (na nuvem de produção, 46) e quantas alguém mudou pela tela depois da leitura de 27/11
-- (essas a migration não toca). Em banco sem essas opções, dá 0; no servidor da loja (sem `edge_status`) não se aplica.
with l(opcao_id, de, para) as (values
  ('4bbe05b2-f031-4b67-8c66-1f805eaac465'::uuid, 'cw4620845c2o0', '45'),
  ('85c19686-3af0-48f6-8cc7-1da5be256e3a'::uuid, 'cw4620846c0o0', '105'),
  ('a4025eed-b894-4c87-bbe4-916935b6f9ae'::uuid, 'cw4620878c0o0', '131'),
  ('20b33508-073e-4bec-b8c6-e4668f310e76'::uuid, 'cw4620843c1o0', '2'),
  ('ab32993f-ddde-4522-99f6-002526394070'::uuid, 'cw4620845c1o0', '3'),
  ('fa0cd49d-7c76-4671-8c65-86967ff69e7f'::uuid, 'cw4620851c1o1', '4'),
  ('76573da1-65b6-4e28-a3a0-a49d6e14df5a'::uuid, 'cw4620851c1o0', '5'),
  ('e528410a-07ee-4d19-a625-2b8c25fbc962'::uuid, 'cw4620860c1o0', '114'),
  ('7ced42d1-013a-4753-84dc-4037108cd03a'::uuid, 'cw4620865c0o6', '100'),
  ('122d2bb4-f527-41a3-9225-bbd1be42c3cd'::uuid, 'cw4620861c0o2', '101'),
  ('7622b974-505d-4a86-b0cd-9fc303b60d08'::uuid, '33c0o4', '94'),
  ('82342373-9bff-4510-a280-cd277ff6a12f'::uuid, 'cw4620852c2o0', '10'),
  ('f4e316f3-9847-4b10-83ca-1191323ec092'::uuid, 'cw4620843c2o0', '9'),
  ('99f57a54-b2d5-4399-8bd4-e4da35766bf4'::uuid, 'cw4620852c2o4', '11'),
  ('22e3c80d-91f5-4747-b570-fa417330e1f4'::uuid, 'cw4620865c0o1', '134'),
  ('33b64164-892f-48ec-8c1a-eff87ca962ef'::uuid, 'cw4620878c0o2', '134'),
  ('700375c0-abd3-40cc-8670-d30ba9670dd3'::uuid, 'cw4620861c0o0', '134'),
  ('ce66c0ca-c0eb-4e72-a6a3-953bdc5b9976'::uuid, '33c0o5', '134'),
  ('47dfa80d-c0d5-466e-9302-9af328b0a0a1'::uuid, 'cw4620852c2o1', '18'),
  ('a6f93bd1-27f5-4808-9a4b-1614e5031f77'::uuid, 'cw4620852c2o2', '20'),
  ('28ed1e12-f569-4b02-a865-5d4c057a9d2d'::uuid, 'cw4620878c0o8', '99'),
  ('6782a2b3-a504-4f7b-9c47-2a8c3dfee1a2'::uuid, 'cw4620865c0o4', '96'),
  ('e50d4086-2e10-4820-9e00-6adcb9fcb925'::uuid, 'cw4620878c0o7', '96'),
  ('cfea60e0-f914-41cb-8703-60a0b24ceb02'::uuid, '33c0o6', '96'),
  ('fe5708dd-433a-4526-ba95-06b4927142b6'::uuid, 'cw4620861c0o1', '96'),
  ('0c66f4ca-f2bc-4a27-be1b-97bb8ba43de4'::uuid, 'cw4620852c2o3', '24'),
  ('664daca2-ea95-4994-8a24-0aaa78c0f0a2'::uuid, 'cw4620840c2o0', '25'),
  ('598516a7-1250-4d7a-8a82-69f46649ac53'::uuid, 'cw4620852c2o5', '26'),
  ('b3acc6cd-7197-4d71-8d2e-5a82f2d02d0a'::uuid, 'cw4620878c0o1', '103'),
  ('1364f53e-671e-4d6c-8d76-b89422502b27'::uuid, '33c0o2', '103'),
  ('a0042d2b-80bf-41d9-9c97-0538b097b36d'::uuid, 'cw4620865c0o0', '103'),
  ('ff0fa3ba-4f2a-4da2-b25f-91bccee73304'::uuid, 'cw4620861c0o3', '103'),
  ('f28b4301-a870-4495-a307-db058d2681c3'::uuid, 'cw4620878c0o3', '133'),
  ('9136d9b9-8ede-4760-b218-bc2426c98622'::uuid, 'cw4620845c0o0', '46'),
  ('d5c16569-b9c3-4e3a-82d9-72ce3d6c3429'::uuid, 'cw4620840c0o0', '52'),
  ('61021a99-cda9-4c7b-8979-26671bb0ce50'::uuid, 'cw4620843c0o0', '53'),
  ('a8ef3e3b-6b19-4f87-9799-f3afad88f018'::uuid, 'cw4620865c0o2', '93'),
  ('7f69c5ee-6c33-4a69-8a7a-6bc97571f4e4'::uuid, 'cw4620878c0o4', '93'),
  ('903e4053-f5f4-4e42-be48-6cd319ae2a04'::uuid, 'cw4620861c0o4', '93'),
  ('c7b89f6a-10ef-4c25-b2df-e8eee9162a4c'::uuid, '33c0o1', '93'),
  ('c4484fdb-4e74-4b2c-822f-82e9a26ca698'::uuid, 'cw4620878c0o6', '95'),
  ('41dd0830-f08d-4481-b98b-64591475134f'::uuid, 'cw4620865c0o5', '95'),
  ('0b9ab5f4-9e9e-45df-955d-e45f2f71c31f'::uuid, 'cw4620861c0o6', '95'),
  ('61744300-08e8-419c-b8fd-4d9a8738aea7'::uuid, '33c0o3', '95'),
  ('a5c71726-8e31-496d-9dd1-d066285388b8'::uuid, 'cw4620852c2o6', '64'),
  ('ae244b0d-2c85-4cfc-b7ad-1b1cc6688af0'::uuid, 'cw4620840c0o1', '81')
), vivas as (
  select o.id, l.de, l.para, btrim(o.codigo_pdv) as agora from l join opcao o on o.id = l.opcao_id and o.deleted_at is null
)
select (not x.nuvem or (x.com_codigo_antigo = 0 and x.copias_com_codigo_antigo = 0 and x.conflitos = 0)) as ok, x.*
  from (
    select
      to_regclass(current_schema() || '.edge_status') is not null as nuvem,
      (select count(*) from vivas) as opcoes_na_lista,
      (select count(*) from vivas where agora = para) as com_codigo_novo,
      (select count(*) from vivas where agora = de) as com_codigo_antigo,
      (select count(*) from vivas where agora is distinct from de and agora is distinct from para) as mudadas_depois_pela_tela,
      (select count(*) from complemento_opcao co join vivas v on v.id = co.origem_opcao_id
        where co.deleted_at is null and btrim(co.codigo_pdv) = v.de) as copias_com_codigo_antigo,
      (select count(*) from (
         select g.produto_id, btrim(co.codigo_pdv)
           from complemento_opcao co join complemento_grupo g on g.id = co.grupo_id and g.deleted_at is null
          where co.deleted_at is null and btrim(co.codigo_pdv) in (select para from l)
            and g.produto_id in (select g2.produto_id from complemento_opcao co2
                                   join complemento_grupo g2 on g2.id = co2.grupo_id and g2.deleted_at is null
                                  where co2.deleted_at is null and co2.origem_opcao_id in (select id from vivas))
          group by 1, 2
         having count(distinct coalesce(co.origem_opcao_id::text, co.id::text)) > 1) c) as conflitos,
      (select count(*) from audit_log where acao = 'trocou_codigo_pdv' and detalhe->>'migration' = '513') as auditoria
  ) x;
