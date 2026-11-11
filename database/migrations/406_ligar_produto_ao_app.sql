-- @cloud-only
-- 406 — "LIGAR A UM PRODUTO" e "CORRIGIR O CÓDIGO" da conferência com os apps (R3 F4b; protótipo
-- mockups/regem-conciliacao-ifood.html, decisão 4).
--
-- Ligar um produto do Regem a um item do iFood ou da 99 troca o código do produto para o do app e copia o que o app TEM
-- (o "Está no", o preço e a pausa daquele app). Nada muda no app por isso — mas os gatilhos da fila (migs 400 e 402) veem
-- o código mudar e mandariam ao app a troca de código (no iFood: renomear lá o item do código antigo, que esbarra no item
-- que já tem o código novo), o preço e a situação. Por isso a gravação da conferência marca a TRANSAÇÃO com
-- `set_config('regem.ligando_ao_app', '<canal>', true)` e o gatilho daquele app, ao ver a marca, não enfileira nada. O
-- gatilho do OUTRO app segue como sempre (o código vale para todos os canais: o produto passa a ligar ao item de lá com
-- o código novo — a gaveta avisa).
--
-- Só muda o começo das duas funções (a guarda); o resto é a mig 400 (iFood) e a 402 (99), sem mudança. Os gatilhos
-- seguem como estão (`create or replace function` troca a função que eles chamam).
--
-- ⚠️ SÓ NUVEM: as funções e a fila só existem lá. Pelo MCP: nada que apague objeto (LIC-171). Idempotente.
set local lock_timeout = '5s';

create or replace function orzuni_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.no_ifood and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
  campos jsonb := '{}'::jsonb;
begin
  -- A conferência ligando o produto ao item do iFood (mig 406): o Regem copiou o que o iFood tem — nada vai ao iFood.
  if tg_op = 'UPDATE' and current_setting('regem.ligando_ao_app', true) = 'ifood' then
    return null;
  end if;
  -- Saiu do cardápio do iFood: a situação vai, e o despacho pausa o item lá (fora do iFood = pausado no iFood).
  if tg_op = 'UPDATE' and old.no_ifood and not new.no_ifood
     and coalesce(new.codigo, '') <> '' and new.deleted_at is null then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
    return null;
  end if;
  if not vale then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.preco_ifood is not null then
      perform orzuni_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
    end if;
    -- criado já no iFood E já pausado (no iFood ou pelo estoque): a pausa também vai (o item nasce ativo lá)
    if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), 'ifood') or new.pausado_estoque then
      perform orzuni_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
    end if;
    return null;
  end if;
  -- O código mudou num produto que já estava no iFood com código: troca lá (o despacho manda isto antes do resto).
  if old.no_ifood and coalesce(old.codigo, '') <> '' and new.codigo is distinct from old.codigo
     and old.deleted_at is null then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'codigo_item', new.id, jsonb_build_object('de', old.codigo));
  end if;
  -- O nome ou a descrição mudaram num produto que já estava no iFood: só os campos que mudaram vão.
  if old.no_ifood and old.deleted_at is null then
    if new.nome is distinct from old.nome then campos := campos || '{"nome": true}'::jsonb; end if;
    if new.descricao is distinct from old.descricao then campos := campos || '{"descricao": true}'::jsonb; end if;
    if campos <> '{}'::jsonb then
      perform orzuni_marcar(new.tenant_id, new.unidade_id, 'cadastro_item', new.id, campos);
    end if;
  end if;
  if new.preco_ifood is not null
     and (new.preco_ifood is distinct from old.preco_ifood or not old.no_ifood
          or new.codigo is distinct from old.codigo or old.deleted_at is not null) then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
  end if;
  if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), 'ifood')
       is distinct from jsonb_exists(coalesce(old.canais_pausados, '[]'::jsonb), 'ifood')
     or new.pausado_estoque is distinct from old.pausado_estoque
     or not old.no_ifood
     or new.codigo is distinct from old.codigo
     or old.deleted_at is not null then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
  end if;
  return null;
end $$;

create or replace function food99_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.na_99 and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
  campos jsonb := '{}'::jsonb;
begin
  -- A conferência ligando o produto ao item da 99 (mig 406): o Regem copiou o que a 99 tem — nada vai à 99.
  if tg_op = 'UPDATE' and current_setting('regem.ligando_ao_app', true) = '99food' then
    return null;
  end if;
  -- Saiu do cardápio da 99: a situação vai, e o despacho pausa o item lá (o Regem não apaga item da 99).
  if tg_op = 'UPDATE' and old.na_99 and not new.na_99
     and coalesce(new.codigo, '') <> '' and new.deleted_at is null then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
    return null;
  end if;
  if not vale then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.preco_99 is not null then
      perform food99_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
    end if;
    if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), '99food') or new.pausado_estoque then
      perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
    end if;
    return null;
  end if;
  -- O nome ou a descrição mudaram num produto que já estava na 99 com o MESMO código: só os campos que mudaram vão.
  -- (Com o código novo, o produto passa a ligar a outro item da 99 — como entrar na 99, o nome de lá fica como está.)
  if old.na_99 and old.deleted_at is null and new.codigo is not distinct from old.codigo then
    if new.nome is distinct from old.nome then campos := campos || '{"nome": true}'::jsonb; end if;
    if new.descricao is distinct from old.descricao then campos := campos || '{"descricao": true}'::jsonb; end if;
    if campos <> '{}'::jsonb then
      perform food99_marcar(new.tenant_id, new.unidade_id, 'cadastro_item', new.id, campos);
    end if;
  end if;
  if new.preco_99 is not null
     and (new.preco_99 is distinct from old.preco_99 or not old.na_99
          or new.codigo is distinct from old.codigo or old.deleted_at is not null) then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
  end if;
  if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), '99food')
       is distinct from jsonb_exists(coalesce(old.canais_pausados, '[]'::jsonb), '99food')
     or new.pausado_estoque is distinct from old.pausado_estoque
     or not old.na_99
     or new.codigo is distinct from old.codigo
     or old.deleted_at is not null then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
  end if;
  return null;
end $$;

-- Conferência (no mesmo Run): as 2 linhas têm de vir com `ok = true`.
select 'a guarda no gatilho do iFood' as objeto,
       coalesce((select prosrc like '%regem.ligando_ao_app%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where p.proname = 'orzuni_produto_mudou' and n.nspname = current_schema()), false) as ok
union all
select 'a guarda no gatilho da 99',
       coalesce((select prosrc like '%regem.ligando_ao_app%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where p.proname = 'food99_produto_mudou' and n.nspname = current_schema()), false);
