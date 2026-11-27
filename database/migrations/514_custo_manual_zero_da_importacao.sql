-- @cloud-only
-- 514 — Tira o custo manual R$ 0,00 que a importação do cardápio gravou nos produtos de uma loja (ERR-636; pedido do dono em
-- 27/11/2026: "opção de adicionar algo a mais além da ficha técnica para compor o custo" — o TRIO X-BACON mostrava
-- "R$ 0,00 override manual" com a ficha X Bacon ligada).
--
-- As importações do Cardápio Web e do Anota Aí gravavam 0 em `produto.preco_custo`. O custo efetivo lê o campo como CUSTO
-- MANUAL (override → ficha → item do estoque): o zero escondia a ficha e o custo médio do estoque, e a margem dos
-- relatórios saía 100%. Nesta loja eram 68 produtos (65 ativos; 42 deles com ficha ou item ligado). Nenhum zero foi
-- digitado: não há auditoria de custo manual, e a tela nem conseguia limpar o campo (vazio ia ausente — corrigido no mesmo
-- PR, `lib/campo-opcional.ts`). Aqui o 0 vira NULL = "usa o custo da ficha ou do estoque"; produto sem ficha nem item fica
-- com o custo desconhecido (não lançado), que é o que ele é.
--
--   • só onde o custo manual AINDA é 0 (quem digitou outro valor depois não é tocado);
--   • `updated_at` anda para a mudança descer ao servidor da loja (produto sincroniza nos dois sentidos, LWW);
--   • uma linha de auditoria por empresa, `limpou_custo_manual_zero`, com o antes de cada produto (`trocas`), encadeada como o
--     AuditoriaService faz (o molde da 467 e da 513).
-- Só o id do produto fica aqui (nome de produto e de loja fora do repositório — regra de dado sensível). Idempotente: a segunda
-- execução não acha nenhum 0 e não audita. Produto excluído ou que não existe fica de fora (fora da nuvem de produção, nada
-- muda). Só nuvem: o servidor da loja recebe pela sincronização do cadastro.
set local lock_timeout = '5s';

do $$
declare
  c_criterio constant text := 'custo manual R$ 0,00 gravado pela importação do cardápio (ERR-636): volta a valer o custo da ficha ou do estoque';
  v_alvo jsonb;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_canon text;
begin
  -- Servidor da loja: não tem `edge_status`; a mudança chega pela sincronização do cadastro.
  if to_regclass(current_schema() || '.edge_status') is null then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id::text, 'tenant', p.tenant_id::text, 'de', p.preco_custo::text)
                            order by p.tenant_id, p.id), '[]'::jsonb)
    into v_alvo
    from produto p
    join (values
      ('04ddff7f-c1e3-4016-b02f-af7e059fecb7'::uuid), ('0664c559-cda3-45f8-addb-6c518b26e7d9'::uuid),
      ('083e9cf3-ea0b-48d1-8a15-ef1dd51f55f5'::uuid), ('0a34204d-8549-4d40-8b54-b95fc9832ba7'::uuid),
      ('0b911ea1-ac1a-4819-abcb-90a191a387bc'::uuid), ('0e9b96dd-8e14-408e-bd39-de9393ddbd16'::uuid),
      ('0ea63bdf-4139-42e8-9061-a5304a2cf27c'::uuid), ('0f6207cd-a5a2-478f-b3e0-f75760414676'::uuid),
      ('12c45074-4dde-40e8-9168-d5f19ed72b5f'::uuid), ('158c7445-b847-4aa3-a8c1-996880a3f7da'::uuid),
      ('1b02588d-980c-49cd-b1ff-2187ec95a2f5'::uuid), ('1bc70fd7-5f30-4e73-b8c4-173a02e3b748'::uuid),
      ('1bef6f11-d86b-42b2-9785-2e0b8b077a18'::uuid), ('29b3020c-3545-40d9-a262-65cd86e1f778'::uuid),
      ('3004e652-ccda-49a1-8f6a-9b566440e2eb'::uuid), ('38a93732-6c4a-431e-9579-0e34a9a121d8'::uuid),
      ('3ce17cd4-c6ac-47d6-b425-4dc21a2be03a'::uuid), ('3e10d3b5-6c57-4c8d-ac3f-1095337e29a7'::uuid),
      ('3e9695c8-6607-4625-9211-ebb32fa9c8ff'::uuid), ('3ff4e26c-dca4-4788-a8c1-5224b9476603'::uuid),
      ('46fdee88-aa94-449d-9315-64484d09d496'::uuid), ('4897b072-2ce2-4bdc-9439-9fa11819a0d2'::uuid),
      ('49912075-7aa3-49c9-95d1-c9288ae66b71'::uuid), ('49a0475e-c087-4d06-80e6-2b741525aaf6'::uuid),
      ('4a707a06-7f65-415d-a26d-db63f5627ad3'::uuid), ('4efb1786-de6f-45ea-9813-948ae88dbec6'::uuid),
      ('51631e23-d30a-48fa-8cf2-0bfbd5083114'::uuid), ('522ea027-0a00-4040-b626-7f30c913f691'::uuid),
      ('528b3cae-6b26-4d61-9b02-7bcef81b6889'::uuid), ('537a0c75-7bea-4504-afd4-01cba256e720'::uuid),
      ('6328b9fe-ecbb-4978-82cf-5f9fc88544be'::uuid), ('642dc18a-0d50-4fe8-ae2a-ccc534c42480'::uuid),
      ('6f5b9170-0b07-4c4c-8ded-8f42cd91fcff'::uuid), ('7c768ca4-0e9d-4822-92e8-df0b09822b2b'::uuid),
      ('819bad8f-c9fc-4a72-a868-c86075f7febb'::uuid), ('81ee63fa-9b88-4757-89e9-70ea9e3fd6eb'::uuid),
      ('84573651-2ab5-43ee-9b3d-9cf44b86f012'::uuid), ('8a863643-349d-4323-9b64-a637ccd80239'::uuid),
      ('8cfa0511-b7ec-4d01-bc3d-a96cf76e4051'::uuid), ('8fe83633-3a12-476d-8b30-8055aa329ded'::uuid),
      ('90b049e6-e47d-4aab-b348-f1c6743e1940'::uuid), ('963d549c-2f9f-4469-8754-c189f9dde5e9'::uuid),
      ('98dd8150-2920-46f0-8568-fffd04aecafc'::uuid), ('9a71854a-ac83-44b6-bb49-9afc8f870a43'::uuid),
      ('9d32ca24-e176-41e0-a5b3-64c9fb29ce55'::uuid), ('a271fd40-9146-4bad-8c8a-93fb4e6648d1'::uuid),
      ('a3f61ba1-9f6b-4903-a241-3e78e2032f41'::uuid), ('a460b82d-2549-4ed6-bad6-1a9ecd3e047e'::uuid),
      ('a714b59c-ee89-4013-993c-fddef080e3e7'::uuid), ('ab4e13c2-09f1-4b33-87ce-025a20496c4d'::uuid),
      ('afb3a39d-95a9-4ddc-bc2e-3c332cfa9add'::uuid), ('b159f4fe-b931-466b-a161-e57f325a86fa'::uuid),
      ('b20152cf-5971-45c6-bc8f-480d3853abb8'::uuid), ('c2e643d6-6f8a-4de9-8b7b-7ec1f38d6364'::uuid),
      ('c7f7fd98-26ea-4e4d-b74a-f4e8acce6b02'::uuid), ('c9b22e1e-ece4-4204-9a78-1e62bf12711b'::uuid),
      ('cac7e454-37b2-4aef-8a91-6440c1beab54'::uuid), ('cc0ae91f-9b8a-4ab4-9ea6-1decefdfb30f'::uuid),
      ('d2786e90-df1f-4ee4-bb82-2ba9e2248ab5'::uuid), ('d621f0e2-e1b8-4a45-a694-b891110bf712'::uuid),
      ('d69c1c8c-dbe2-4eaf-98f0-56429ca951cb'::uuid), ('e2850c10-4e21-4f88-a61b-f16562131f01'::uuid),
      ('ec8f5512-089a-4c99-b2d9-68c2290dc21e'::uuid), ('eca94041-ed1a-499b-85e1-dc7d5e9342a6'::uuid),
      ('ed80af39-6bc5-4a1b-8292-485ea4076741'::uuid), ('ef023996-70a2-47aa-a408-2c1e6dbff779'::uuid),
      ('fa26854a-f10b-4c5b-a038-a48f12e9fff3'::uuid), ('fad6a3a3-2eb2-4ec7-8ec0-5d03959b1bdc'::uuid)
    ) as l(produto_id) on l.produto_id = p.id
   where p.deleted_at is null
     and p.preco_custo = 0;

  if jsonb_array_length(v_alvo) = 0 then
    return;
  end if;

  update produto p
     set preco_custo = null,
         updated_at = now()
    from jsonb_array_elements(v_alvo) e
   where p.id = (e->>'id')::uuid
     and p.preco_custo = 0;

  -- Auditoria: uma linha por empresa, com o antes de cada produto (`trocas`, para desfazer se preciso).
  for r in
    select e->>'tenant' as tenant_id,
           count(*)::int as n,
           jsonb_agg(jsonb_build_object('de', e->>'de', 'id', e->>'id') order by e->>'id') as trocas,
           '[' || string_agg('{"de":' || to_json(e->>'de')::text || ',"id":' || to_json(e->>'id')::text || '}', ',' order by e->>'id')
             || ']' as trocas_txt
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
    v_canon := '{"ac":' || to_json('limpou_custo_manual_zero'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"criterio":' || to_json(c_criterio)::text
            ||       ',"migration":' || to_json('514'::text)::text
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
    values (r.tenant_id::uuid, null, 'distribuicao', null, 'servico', 'cadastro', 'limpou_custo_manual_zero', 'produto', null,
            jsonb_build_object('criterio', c_criterio, 'migration', '514', 'produtos', r.n, 'trocas', r.trocas),
            'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — na nuvem, nenhum produto da lista que existe (e não foi excluído) ficou com
-- o custo manual 0. À parte: quantos estão sem custo manual (na nuvem de produção, 68) e quantos alguém mudou para outro
-- valor depois da leitura de 27/11 (esses a migration não toca). Em banco sem esses produtos, dá 0; no servidor da loja (sem
-- `edge_status`) não se aplica.
with l(produto_id) as (values
  ('04ddff7f-c1e3-4016-b02f-af7e059fecb7'::uuid), ('0664c559-cda3-45f8-addb-6c518b26e7d9'::uuid),
  ('083e9cf3-ea0b-48d1-8a15-ef1dd51f55f5'::uuid), ('0a34204d-8549-4d40-8b54-b95fc9832ba7'::uuid),
  ('0b911ea1-ac1a-4819-abcb-90a191a387bc'::uuid), ('0e9b96dd-8e14-408e-bd39-de9393ddbd16'::uuid),
  ('0ea63bdf-4139-42e8-9061-a5304a2cf27c'::uuid), ('0f6207cd-a5a2-478f-b3e0-f75760414676'::uuid),
  ('12c45074-4dde-40e8-9168-d5f19ed72b5f'::uuid), ('158c7445-b847-4aa3-a8c1-996880a3f7da'::uuid),
  ('1b02588d-980c-49cd-b1ff-2187ec95a2f5'::uuid), ('1bc70fd7-5f30-4e73-b8c4-173a02e3b748'::uuid),
  ('1bef6f11-d86b-42b2-9785-2e0b8b077a18'::uuid), ('29b3020c-3545-40d9-a262-65cd86e1f778'::uuid),
  ('3004e652-ccda-49a1-8f6a-9b566440e2eb'::uuid), ('38a93732-6c4a-431e-9579-0e34a9a121d8'::uuid),
  ('3ce17cd4-c6ac-47d6-b425-4dc21a2be03a'::uuid), ('3e10d3b5-6c57-4c8d-ac3f-1095337e29a7'::uuid),
  ('3e9695c8-6607-4625-9211-ebb32fa9c8ff'::uuid), ('3ff4e26c-dca4-4788-a8c1-5224b9476603'::uuid),
  ('46fdee88-aa94-449d-9315-64484d09d496'::uuid), ('4897b072-2ce2-4bdc-9439-9fa11819a0d2'::uuid),
  ('49912075-7aa3-49c9-95d1-c9288ae66b71'::uuid), ('49a0475e-c087-4d06-80e6-2b741525aaf6'::uuid),
  ('4a707a06-7f65-415d-a26d-db63f5627ad3'::uuid), ('4efb1786-de6f-45ea-9813-948ae88dbec6'::uuid),
  ('51631e23-d30a-48fa-8cf2-0bfbd5083114'::uuid), ('522ea027-0a00-4040-b626-7f30c913f691'::uuid),
  ('528b3cae-6b26-4d61-9b02-7bcef81b6889'::uuid), ('537a0c75-7bea-4504-afd4-01cba256e720'::uuid),
  ('6328b9fe-ecbb-4978-82cf-5f9fc88544be'::uuid), ('642dc18a-0d50-4fe8-ae2a-ccc534c42480'::uuid),
  ('6f5b9170-0b07-4c4c-8ded-8f42cd91fcff'::uuid), ('7c768ca4-0e9d-4822-92e8-df0b09822b2b'::uuid),
  ('819bad8f-c9fc-4a72-a868-c86075f7febb'::uuid), ('81ee63fa-9b88-4757-89e9-70ea9e3fd6eb'::uuid),
  ('84573651-2ab5-43ee-9b3d-9cf44b86f012'::uuid), ('8a863643-349d-4323-9b64-a637ccd80239'::uuid),
  ('8cfa0511-b7ec-4d01-bc3d-a96cf76e4051'::uuid), ('8fe83633-3a12-476d-8b30-8055aa329ded'::uuid),
  ('90b049e6-e47d-4aab-b348-f1c6743e1940'::uuid), ('963d549c-2f9f-4469-8754-c189f9dde5e9'::uuid),
  ('98dd8150-2920-46f0-8568-fffd04aecafc'::uuid), ('9a71854a-ac83-44b6-bb49-9afc8f870a43'::uuid),
  ('9d32ca24-e176-41e0-a5b3-64c9fb29ce55'::uuid), ('a271fd40-9146-4bad-8c8a-93fb4e6648d1'::uuid),
  ('a3f61ba1-9f6b-4903-a241-3e78e2032f41'::uuid), ('a460b82d-2549-4ed6-bad6-1a9ecd3e047e'::uuid),
  ('a714b59c-ee89-4013-993c-fddef080e3e7'::uuid), ('ab4e13c2-09f1-4b33-87ce-025a20496c4d'::uuid),
  ('afb3a39d-95a9-4ddc-bc2e-3c332cfa9add'::uuid), ('b159f4fe-b931-466b-a161-e57f325a86fa'::uuid),
  ('b20152cf-5971-45c6-bc8f-480d3853abb8'::uuid), ('c2e643d6-6f8a-4de9-8b7b-7ec1f38d6364'::uuid),
  ('c7f7fd98-26ea-4e4d-b74a-f4e8acce6b02'::uuid), ('c9b22e1e-ece4-4204-9a78-1e62bf12711b'::uuid),
  ('cac7e454-37b2-4aef-8a91-6440c1beab54'::uuid), ('cc0ae91f-9b8a-4ab4-9ea6-1decefdfb30f'::uuid),
  ('d2786e90-df1f-4ee4-bb82-2ba9e2248ab5'::uuid), ('d621f0e2-e1b8-4a45-a694-b891110bf712'::uuid),
  ('d69c1c8c-dbe2-4eaf-98f0-56429ca951cb'::uuid), ('e2850c10-4e21-4f88-a61b-f16562131f01'::uuid),
  ('ec8f5512-089a-4c99-b2d9-68c2290dc21e'::uuid), ('eca94041-ed1a-499b-85e1-dc7d5e9342a6'::uuid),
  ('ed80af39-6bc5-4a1b-8292-485ea4076741'::uuid), ('ef023996-70a2-47aa-a408-2c1e6dbff779'::uuid),
  ('fa26854a-f10b-4c5b-a038-a48f12e9fff3'::uuid), ('fad6a3a3-2eb2-4ec7-8ec0-5d03959b1bdc'::uuid)
), vivos as (
  select p.id, p.preco_custo from l join produto p on p.id = l.produto_id and p.deleted_at is null
)
select (not x.nuvem or x.ainda_com_zero = 0) as ok, x.*
  from (
    select
      to_regclass(current_schema() || '.edge_status') is not null as nuvem,
      (select count(*) from vivos) as produtos_na_lista,
      (select count(*) from vivos where preco_custo is null) as sem_custo_manual,
      (select count(*) from vivos where preco_custo = 0) as ainda_com_zero,
      (select count(*) from vivos where preco_custo is not null and preco_custo <> 0) as mudados_depois_pela_tela,
      (select count(*) from audit_log where acao = 'limpou_custo_manual_zero' and detalhe->>'migration' = '514') as auditoria
  ) x;
