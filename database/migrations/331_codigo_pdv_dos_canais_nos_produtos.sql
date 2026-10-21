-- @cloud-only
-- 331 — Código PDV dos canais nos produtos de uma loja (ERR-257; decisões do dono em 20/10/2026: "código PDV no produto",
-- "corrijo daqui em diante" e "vamos pegar o código do Anota Aí e do iFood e colocar no mesmo produto no Regem").
--
-- Os canais (Anota Aí, iFood e 99Food) mandam em cada item o mesmo código PDV, e o aceite liga o item ao produto pelo
-- `produto.codigo` antes do nome. Os produtos desta loja vieram de outro sistema com os códigos dele, e alguns desses
-- códigos eram o código PDV de OUTRO item nos canais: o item do iFood e da 99 entrava sem produto (sem cozinha e sem
-- baixa de estoque) e bebidas e molhos entravam como outro produto.
--
-- A lista (produto × código × nome em cada canal, vendas de 90 dias) foi conferida pelo dono. Aqui vão SÓ o id do
-- produto e o código novo: nome de produto e de loja ficam fora do repositório (regra de dado sensível). O código de
-- antes de cada produto fica na auditoria (detalhe `trocas`), para desfazer se preciso.
--
-- Duas fases, por causa do índice único (tenant_id, codigo) dos produtos não excluídos: primeiro os produtos da lista que
-- ainda não estão com o código novo ficam sem código (isso libera os números que estavam no produto errado); depois cada
-- um recebe o seu. Produto excluído ou que não existe fica de fora (em qualquer banco que não seja o da nuvem de
-- produção, nada muda). Idempotente: o que já está com o código novo não muda, e a segunda execução não audita de novo.
-- Uma linha de auditoria por empresa, encadeada como o AuditoriaService faz. Só nuvem: o servidor da loja recebe os
-- códigos pela sincronização do cadastro.
set local lock_timeout = '5s';

do $$
declare
  c_criterio constant text := 'código PDV dos canais no produto (lista conferida pelo dono em 20/10/2026)';
  v_alvo jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id::text, 'tenant', p.tenant_id::text, 'de', p.codigo, 'para', l.codigo)
                            order by p.tenant_id, l.codigo::int, p.id), '[]'::jsonb)
    into v_alvo
    from produto p
    join (values
      ('522ea027-0a00-4040-b626-7f30c913f691'::uuid, '1'),
      ('ab4e13c2-09f1-4b33-87ce-025a20496c4d'::uuid, '2'),
      ('ec8f5512-089a-4c99-b2d9-68c2290dc21e'::uuid, '3'),
      ('4efb1786-de6f-45ea-9813-948ae88dbec6'::uuid, '4'),
      ('8a863643-349d-4323-9b64-a637ccd80239'::uuid, '5'),
      ('a271fd40-9146-4bad-8c8a-93fb4e6648d1'::uuid, '8'),
      ('49912075-7aa3-49c9-95d1-c9288ae66b71'::uuid, '9'),
      ('cc0ae91f-9b8a-4ab4-9ea6-1decefdfb30f'::uuid, '10'),
      ('158c7445-b847-4aa3-a8c1-996880a3f7da'::uuid, '11'),
      ('9d32ca24-e176-41e0-a5b3-64c9fb29ce55'::uuid, '13'),
      ('a460b82d-2549-4ed6-bad6-1a9ecd3e047e'::uuid, '14'),
      ('d2786e90-df1f-4ee4-bb82-2ba9e2248ab5'::uuid, '15'),
      ('38a93732-6c4a-431e-9579-0e34a9a121d8'::uuid, '16'),
      ('84573651-2ab5-43ee-9b3d-9cf44b86f012'::uuid, '18'),
      ('29b3020c-3545-40d9-a262-65cd86e1f778'::uuid, '20'),
      ('cac7e454-37b2-4aef-8a91-6440c1beab54'::uuid, '24'),
      ('fa26854a-f10b-4c5b-a038-a48f12e9fff3'::uuid, '25'),
      ('0f6207cd-a5a2-478f-b3e0-f75760414676'::uuid, '27'),
      ('0e9b96dd-8e14-408e-bd39-de9393ddbd16'::uuid, '28'),
      ('3004e652-ccda-49a1-8f6a-9b566440e2eb'::uuid, '30'),
      ('537a0c75-7bea-4504-afd4-01cba256e720'::uuid, '38'),
      ('6328b9fe-ecbb-4978-82cf-5f9fc88544be'::uuid, '39'),
      ('0b911ea1-ac1a-4819-abcb-90a191a387bc'::uuid, '44'),
      ('b20152cf-5971-45c6-bc8f-480d3853abb8'::uuid, '45'),
      ('29b90f93-0696-4ed8-a8b4-32e4e79ca116'::uuid, '46'),
      ('51631e23-d30a-48fa-8cf2-0bfbd5083114'::uuid, '47'),
      ('3ff4e26c-dca4-4788-a8c1-5224b9476603'::uuid, '48'),
      ('0a34204d-8549-4d40-8b54-b95fc9832ba7'::uuid, '49'),
      ('083e9cf3-ea0b-48d1-8a15-ef1dd51f55f5'::uuid, '50'),
      ('afb3a39d-95a9-4ddc-bc2e-3c332cfa9add'::uuid, '51'),
      ('a714b59c-ee89-4013-993c-fddef080e3e7'::uuid, '52'),
      ('8fe83633-3a12-476d-8b30-8055aa329ded'::uuid, '53'),
      ('0664c559-cda3-45f8-addb-6c518b26e7d9'::uuid, '54'),
      ('3ce17cd4-c6ac-47d6-b425-4dc21a2be03a'::uuid, '55'),
      ('1bc70fd7-5f30-4e73-b8c4-173a02e3b748'::uuid, '56'),
      ('63ddf9a5-21ee-46c2-a80d-f998a86e472a'::uuid, '57'),
      ('04ddff7f-c1e3-4016-b02f-af7e059fecb7'::uuid, '58'),
      ('6f5b9170-0b07-4c4c-8ded-8f42cd91fcff'::uuid, '59'),
      ('ed80af39-6bc5-4a1b-8292-485ea4076741'::uuid, '60'),
      ('0ea63bdf-4139-42e8-9061-a5304a2cf27c'::uuid, '64'),
      ('963d549c-2f9f-4469-8754-c189f9dde5e9'::uuid, '69'),
      ('528b3cae-6b26-4d61-9b02-7bcef81b6889'::uuid, '70'),
      ('d69c1c8c-dbe2-4eaf-98f0-56429ca951cb'::uuid, '71'),
      ('81ee63fa-9b88-4757-89e9-70ea9e3fd6eb'::uuid, '72'),
      ('90b049e6-e47d-4aab-b348-f1c6743e1940'::uuid, '73'),
      ('46fdee88-aa94-449d-9315-64484d09d496'::uuid, '74'),
      ('49a0475e-c087-4d06-80e6-2b741525aaf6'::uuid, '75'),
      ('fad6a3a3-2eb2-4ec7-8ec0-5d03959b1bdc'::uuid, '76'),
      ('9a71854a-ac83-44b6-bb49-9afc8f870a43'::uuid, '77'),
      ('c7f7fd98-26ea-4e4d-b74a-f4e8acce6b02'::uuid, '78'),
      ('7c768ca4-0e9d-4822-92e8-df0b09822b2b'::uuid, '79'),
      ('a3f61ba1-9f6b-4903-a241-3e78e2032f41'::uuid, '80'),
      ('e2850c10-4e21-4f88-a61b-f16562131f01'::uuid, '81'),
      ('12c45074-4dde-40e8-9168-d5f19ed72b5f'::uuid, '82'),
      ('ef023996-70a2-47aa-a408-2c1e6dbff779'::uuid, '83'),
      ('1bef6f11-d86b-42b2-9785-2e0b8b077a18'::uuid, '84'),
      ('3e9695c8-6607-4625-9211-ebb32fa9c8ff'::uuid, '85'),
      ('b159f4fe-b931-466b-a161-e57f325a86fa'::uuid, '86'),
      ('1b02588d-980c-49cd-b1ff-2187ec95a2f5'::uuid, '87'),
      ('98dd8150-2920-46f0-8568-fffd04aecafc'::uuid, '88'),
      ('c2e643d6-6f8a-4de9-8b7b-7ec1f38d6364'::uuid, '89'),
      ('819bad8f-c9fc-4a72-a868-c86075f7febb'::uuid, '90'),
      ('642dc18a-0d50-4fe8-ae2a-ccc534c42480'::uuid, '91')
    ) as l(produto_id, codigo) on l.produto_id = p.id
   where p.deleted_at is null
     and p.codigo is distinct from l.codigo;

  if jsonb_array_length(v_alvo) = 0 then
    return;
  end if;

  -- Fase 1: os produtos que vão trocar ficam sem código (o índice único não vale para código vazio).
  update produto p
     set codigo = null
    from jsonb_array_elements(v_alvo) e
   where p.id = (e->>'id')::uuid;

  -- Fase 2: cada um recebe o código PDV dos canais.
  update produto p
     set codigo = e->>'para'
    from jsonb_array_elements(v_alvo) e
   where p.id = (e->>'id')::uuid;

  -- Auditoria: uma linha por empresa, com o código de antes de cada produto (`trocas`, para desfazer se preciso).
  for r in
    select e->>'tenant' as tenant_id,
           count(*)::int as n,
           jsonb_agg(jsonb_build_object('de', e->>'de', 'id', e->>'id', 'para', e->>'para')
                     order by (e->>'para')::int, e->>'id') as trocas,
           '[' || string_agg('{"de":' || coalesce(to_json(e->>'de')::text, 'null')
                             || ',"id":' || to_json(e->>'id')::text
                             || ',"para":' || to_json(e->>'para')::text || '}', ','
                             order by (e->>'para')::int, e->>'id') || ']' as trocas_txt
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
            ||       ',"migration":' || to_json('331'::text)::text
            ||       ',"produtos":' || r.n::text
            ||       ',"trocas":' || r.trocas_txt || '}'
            || ',"ei":null'
            || ',"et":' || to_json('produto'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id)::text
            || ',"ti":' || to_json('cadastro'::text)::text
            || ',"u":null'
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id::uuid, null, 'distribuicao', null, 'servico', 'cadastro', 'trocou_codigo_pdv', 'produto', null,
            jsonb_build_object('criterio', c_criterio, 'migration', '331', 'produtos', r.n, 'trocas', r.trocas),
            'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — na nuvem, todo produto da lista que existe (e não foi excluído) está
-- com o código novo. Em banco sem esses produtos, dá 0 = 0; no servidor da loja (sem `edge_status`) não se aplica.
select (not x.nuvem or x.produtos_na_lista = x.com_codigo_novo) as ok, x.*
  from (
    select
      to_regclass(current_schema() || '.edge_status') is not null as nuvem,
      count(p.id) as produtos_na_lista,
      count(p.id) filter (where p.codigo = l.codigo) as com_codigo_novo,
      (select count(*) from audit_log where acao = 'trocou_codigo_pdv') as auditoria
    from (values
      ('522ea027-0a00-4040-b626-7f30c913f691'::uuid, '1'),
      ('ab4e13c2-09f1-4b33-87ce-025a20496c4d'::uuid, '2'),
      ('ec8f5512-089a-4c99-b2d9-68c2290dc21e'::uuid, '3'),
      ('4efb1786-de6f-45ea-9813-948ae88dbec6'::uuid, '4'),
      ('8a863643-349d-4323-9b64-a637ccd80239'::uuid, '5'),
      ('a271fd40-9146-4bad-8c8a-93fb4e6648d1'::uuid, '8'),
      ('49912075-7aa3-49c9-95d1-c9288ae66b71'::uuid, '9'),
      ('cc0ae91f-9b8a-4ab4-9ea6-1decefdfb30f'::uuid, '10'),
      ('158c7445-b847-4aa3-a8c1-996880a3f7da'::uuid, '11'),
      ('9d32ca24-e176-41e0-a5b3-64c9fb29ce55'::uuid, '13'),
      ('a460b82d-2549-4ed6-bad6-1a9ecd3e047e'::uuid, '14'),
      ('d2786e90-df1f-4ee4-bb82-2ba9e2248ab5'::uuid, '15'),
      ('38a93732-6c4a-431e-9579-0e34a9a121d8'::uuid, '16'),
      ('84573651-2ab5-43ee-9b3d-9cf44b86f012'::uuid, '18'),
      ('29b3020c-3545-40d9-a262-65cd86e1f778'::uuid, '20'),
      ('cac7e454-37b2-4aef-8a91-6440c1beab54'::uuid, '24'),
      ('fa26854a-f10b-4c5b-a038-a48f12e9fff3'::uuid, '25'),
      ('0f6207cd-a5a2-478f-b3e0-f75760414676'::uuid, '27'),
      ('0e9b96dd-8e14-408e-bd39-de9393ddbd16'::uuid, '28'),
      ('3004e652-ccda-49a1-8f6a-9b566440e2eb'::uuid, '30'),
      ('537a0c75-7bea-4504-afd4-01cba256e720'::uuid, '38'),
      ('6328b9fe-ecbb-4978-82cf-5f9fc88544be'::uuid, '39'),
      ('0b911ea1-ac1a-4819-abcb-90a191a387bc'::uuid, '44'),
      ('b20152cf-5971-45c6-bc8f-480d3853abb8'::uuid, '45'),
      ('29b90f93-0696-4ed8-a8b4-32e4e79ca116'::uuid, '46'),
      ('51631e23-d30a-48fa-8cf2-0bfbd5083114'::uuid, '47'),
      ('3ff4e26c-dca4-4788-a8c1-5224b9476603'::uuid, '48'),
      ('0a34204d-8549-4d40-8b54-b95fc9832ba7'::uuid, '49'),
      ('083e9cf3-ea0b-48d1-8a15-ef1dd51f55f5'::uuid, '50'),
      ('afb3a39d-95a9-4ddc-bc2e-3c332cfa9add'::uuid, '51'),
      ('a714b59c-ee89-4013-993c-fddef080e3e7'::uuid, '52'),
      ('8fe83633-3a12-476d-8b30-8055aa329ded'::uuid, '53'),
      ('0664c559-cda3-45f8-addb-6c518b26e7d9'::uuid, '54'),
      ('3ce17cd4-c6ac-47d6-b425-4dc21a2be03a'::uuid, '55'),
      ('1bc70fd7-5f30-4e73-b8c4-173a02e3b748'::uuid, '56'),
      ('63ddf9a5-21ee-46c2-a80d-f998a86e472a'::uuid, '57'),
      ('04ddff7f-c1e3-4016-b02f-af7e059fecb7'::uuid, '58'),
      ('6f5b9170-0b07-4c4c-8ded-8f42cd91fcff'::uuid, '59'),
      ('ed80af39-6bc5-4a1b-8292-485ea4076741'::uuid, '60'),
      ('0ea63bdf-4139-42e8-9061-a5304a2cf27c'::uuid, '64'),
      ('963d549c-2f9f-4469-8754-c189f9dde5e9'::uuid, '69'),
      ('528b3cae-6b26-4d61-9b02-7bcef81b6889'::uuid, '70'),
      ('d69c1c8c-dbe2-4eaf-98f0-56429ca951cb'::uuid, '71'),
      ('81ee63fa-9b88-4757-89e9-70ea9e3fd6eb'::uuid, '72'),
      ('90b049e6-e47d-4aab-b348-f1c6743e1940'::uuid, '73'),
      ('46fdee88-aa94-449d-9315-64484d09d496'::uuid, '74'),
      ('49a0475e-c087-4d06-80e6-2b741525aaf6'::uuid, '75'),
      ('fad6a3a3-2eb2-4ec7-8ec0-5d03959b1bdc'::uuid, '76'),
      ('9a71854a-ac83-44b6-bb49-9afc8f870a43'::uuid, '77'),
      ('c7f7fd98-26ea-4e4d-b74a-f4e8acce6b02'::uuid, '78'),
      ('7c768ca4-0e9d-4822-92e8-df0b09822b2b'::uuid, '79'),
      ('a3f61ba1-9f6b-4903-a241-3e78e2032f41'::uuid, '80'),
      ('e2850c10-4e21-4f88-a61b-f16562131f01'::uuid, '81'),
      ('12c45074-4dde-40e8-9168-d5f19ed72b5f'::uuid, '82'),
      ('ef023996-70a2-47aa-a408-2c1e6dbff779'::uuid, '83'),
      ('1bef6f11-d86b-42b2-9785-2e0b8b077a18'::uuid, '84'),
      ('3e9695c8-6607-4625-9211-ebb32fa9c8ff'::uuid, '85'),
      ('b159f4fe-b931-466b-a161-e57f325a86fa'::uuid, '86'),
      ('1b02588d-980c-49cd-b1ff-2187ec95a2f5'::uuid, '87'),
      ('98dd8150-2920-46f0-8568-fffd04aecafc'::uuid, '88'),
      ('c2e643d6-6f8a-4de9-8b7b-7ec1f38d6364'::uuid, '89'),
      ('819bad8f-c9fc-4a72-a868-c86075f7febb'::uuid, '90'),
      ('642dc18a-0d50-4fe8-ae2a-ccc534c42480'::uuid, '91')
    ) as l(produto_id, codigo)
    left join produto p on p.id = l.produto_id and p.deleted_at is null
  ) x;
