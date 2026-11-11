-- @cloud-only
-- 400 — R3 F1b (Delivery › Gestão do catálogo): o NOME, a DESCRIÇÃO e o CÓDIGO PDV do produto vão ao iFood pelo Orzuni
-- (contrato 1.2.0 da porta: `item_editar` e `item_codigo_pdv_definir`, na permissão `catalogo.escrever`).
--
-- O que muda na fila `orzuni_envio` (mig 370):
--   • dois tipos novos: `cadastro_item` (nome e/ou descrição) e `codigo_item` (a troca do código no iFood);
--   • a coluna `dados`: no `cadastro_item`, QUAIS campos mudaram ({"nome": true, "descricao": true} — só eles vão, para
--     não apagar no iFood a descrição que o Regem nunca teve); no `codigo_item`, o código que o iFood TEM ({"de": "…"}) —
--     edições seguidas (A → B → C antes de sair) mandam A → C;
--   • `orzuni_marcar` ganha o 5º argumento (`p_dados`); a de 4 segue valendo (chama a de 5).
-- O gatilho do produto (399) passa a marcar: `cadastro_item` quando o nome ou a descrição mudam de um produto que JÁ
-- estava no iFood (entrar no iFood não sobrescreve o nome de lá); `codigo_item` quando o código muda de um produto que já
-- estava no iFood com código. O despacho manda a troca de código ANTES do preço, da situação e do nome do mesmo produto
-- (que vão com o código novo) — `orzuni-envio.service.ts`, no MESMO PR.
--
-- ⚠️ SÓ NUVEM. ⚠️ Vai pelo SQL EDITOR (tem `drop constraint`: trocar o CHECK dos tipos — LIC-171); o resto é
--    `create or replace`/`if not exists`. Idempotente. A conferência no fim (no mesmo Run): as 4 linhas com `ok = true`.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.orzuni_envio') is null then
    raise exception 'A 400 depende da 370 (orzuni_envio): aplique-a antes.';
  end if;
end $$;

alter table orzuni_envio add column if not exists dados jsonb;

alter table orzuni_envio drop constraint if exists ck_orzuni_envio_tipo;
alter table orzuni_envio add constraint ck_orzuni_envio_tipo
  check (tipo in ('preco_item', 'status_item', 'preco_opcao', 'status_opcao', 'cadastro_item', 'codigo_item'));

-- Marca o alvo para as lojas ligadas da empresa (`p_unidade` nulo = todas). Nada acontece sem o direito ligado.
-- `p_dados`: o que o envio precisa saber além do valor lido na hora (veja o topo). Na linha ainda PENDENTE: o código
-- fica o primeiro (o que o iFood tem) e os campos se somam; na que já saiu ou está saindo, vale o novo.
create or replace function orzuni_marcar(p_tenant uuid, p_unidade uuid, p_tipo text, p_ref uuid, p_dados jsonb) returns void
language plpgsql as $$
declare
  n integer;
begin
  if not exists (select 1 from entitlement e
                  where e.tenant_id = p_tenant and e.modulo = 'ifood_pelo_orzuni' and e.ativo) then
    return;
  end if;
  insert into orzuni_envio (tenant_id, unidade_id, tipo, ref_id, dados)
  select l.tenant_id, l.unidade_id, p_tipo, p_ref, p_dados
    from orzuni_ligacao l
   where l.tenant_id = p_tenant and l.revogada_em is null
     and (p_unidade is null or l.unidade_id = p_unidade)
  on conflict (unidade_id, tipo, ref_id) do update
     set versao = orzuni_envio.versao + 1,
         -- Em envio agora: segue "enviando"; o despacho, ao terminar, vê a versão nova e devolve à fila.
         situacao = case when orzuni_envio.situacao = 'enviando' then 'enviando' else 'pendente' end,
         dados = case
                   when orzuni_envio.situacao <> 'pendente' or orzuni_envio.dados is null then excluded.dados
                   when orzuni_envio.tipo = 'codigo_item' then orzuni_envio.dados
                   else orzuni_envio.dados || coalesce(excluded.dados, '{}'::jsonb) end,
         tentativas = 0,
         proxima_em = now(),
         marcado_em = clock_timestamp(),
         ultimo_erro = null;
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_notify('orzuni_envio', p_tenant::text);
  end if;
end $$;

create or replace function orzuni_marcar(p_tenant uuid, p_unidade uuid, p_tipo text, p_ref uuid) returns void
language plpgsql as $$
begin
  perform orzuni_marcar(p_tenant, p_unidade, p_tipo, p_ref, null::jsonb);
end $$;

create or replace function orzuni_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.no_ifood and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
  campos jsonb := '{}'::jsonb;
begin
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

create or replace trigger trg_orzuni_produto
  after insert or update of preco_ifood, no_ifood, codigo, canais_pausados, pausado_estoque, deleted_at, nome, descricao
  on produto
  for each row execute function orzuni_produto_mudou();

-- Conferência (no mesmo Run): as 4 linhas têm de vir com `ok = true`.
select 'a coluna dados' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'orzuni_envio' and column_name = 'dados') as ok
union all
select 'os tipos novos na fila',
       coalesce((select pg_get_constraintdef(c.oid) like '%cadastro_item%' and pg_get_constraintdef(c.oid) like '%codigo_item%'
                   from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
                  where c.conname = 'ck_orzuni_envio_tipo' and t.relname = 'orzuni_envio' and n.nspname = current_schema()), false)
union all
select 'o orzuni_marcar com os dados',
       exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                where f.proname = 'orzuni_marcar' and n.nspname = current_schema() and f.pronargs = 5)
union all
select 'o gatilho acorda com o nome e a descrição',
       coalesce((select pg_get_triggerdef(t.oid) like '%descricao%' and pg_get_triggerdef(t.oid) like '%nome%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_orzuni_produto' and not t.tgisinternal and n.nspname = current_schema()), false);
