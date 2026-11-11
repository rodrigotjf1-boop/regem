-- @cloud-only
-- 404 — A 99 nos COMPLEMENTOS: o preço na 99 e a pausa da opção do catálogo vão à 99 pela mesma fila do produto (R3 da
-- Gestão do catálogo, fase F3b; a 401 trouxe `opcao.preco_99` e `opcao.canais_pausados`; a 402, a fila `food99_envio`).
--
-- Na 99 o complemento também é um ITEM do cardápio (`app_item_id` = o código PDV da opção, com "vende separado" falso) e
-- entra nos grupos de complementos (`modifier_groups`) com um preço POR GRUPO. Então:
--   • a situação vai como a do produto: `updateItemStatus` (doc 1969) com o código da opção — pausada na 99 quando está
--     "Em falta" (todos os canais) ou pausada só na 99 (`'99food'` em `canais_pausados`);
--   • o preço (um por código, decisão 15) vai grupo a grupo: `updateModifierGroup` (doc 1971) em CADA grupo da 99 que tem
--     a opção, com o grupo inteiro como a 99 tem e só o preço dela trocado.
--
-- A fila ganha a coluna `alvo` ('produto' — o que já havia — ou 'opcao'), em vez de tipos novos: trocar a regra dos tipos
-- pediria apagar a restrição (o MCP do Supabase não deixa — LIC-171). `preco_item`/`status_item` com `alvo = 'opcao'` são
-- o preço e a situação do complemento. A chave única (integração, tipo, ref) segue valendo: o id da opção e o do produto
-- não colidem (uuid).
--
-- QUEM ENFILEIRA: o gatilho da opção, AQUI no banco (a tela da nuvem e o sincronismo da loja entram iguais), só para
-- empresa com o direito `precos_na_99` ligado e a 99 conectada (`food99_marcar_opcao`, com nome próprio: uma 2ª versão de
-- `food99_marcar` com argumento a mais deixaria a chamada de 5 argumentos ambígua). Opção sem código ou apagada sai na
-- primeira linha. Desapagar não reenvia nada (como no iFood).
--
-- ⚠️ SÓ NUVEM (o servidor da loja pula o arquivo). ⚠️ Pelo MCP: nada que apague objeto (`create or replace`). Idempotente.
set local lock_timeout = '5s';

alter table food99_envio add column if not exists alvo text not null default 'produto';
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_food99_envio_alvo'
                    and conrelid = (current_schema() || '.food99_envio')::regclass) then
    alter table food99_envio add constraint ck_food99_envio_alvo check (alvo in ('produto', 'opcao'));
  end if;
end $$;

-- Marca a OPÇÃO (todas as lojas da empresa ligadas à 99: a opção do catálogo vale para a rede). Nada sem o direito.
create or replace function food99_marcar_opcao(p_tenant uuid, p_tipo text, p_ref uuid) returns void
language plpgsql as $$
declare
  n integer;
begin
  if not exists (select 1 from entitlement e
                  where e.tenant_id = p_tenant and e.modulo = 'precos_na_99' and e.ativo) then
    return;
  end if;
  insert into food99_envio (tenant_id, integracao_id, tipo, ref_id, alvo)
  select i.tenant_id, i.id, p_tipo, p_ref, 'opcao'
    from integracao i
   where i.tenant_id = p_tenant and i.canal = '99food' and i.ativo
  on conflict (integracao_id, tipo, ref_id) do update
     set versao = food99_envio.versao + 1,
         situacao = case when food99_envio.situacao = 'enviando' then 'enviando' else 'pendente' end,
         alvo = 'opcao',
         tentativas = 0,
         proxima_em = now(),
         marcado_em = clock_timestamp(),
         ultimo_erro = null;
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_notify('food99_envio', p_tenant::text);
  end if;
end $$;

-- Opção do catálogo: o preço na 99 (mudou, ou passou a valer) e a situação (o "Em falta" e a pausa só da 99).
create or replace function food99_opcao_mudou() returns trigger
language plpgsql as $$
begin
  if coalesce(new.codigo_pdv, '') = '' or new.deleted_at is not null then
    return null;
  end if;
  if new.preco_99 is not null
     and (tg_op = 'INSERT' or new.preco_99 is distinct from old.preco_99
          or new.codigo_pdv is distinct from old.codigo_pdv or old.deleted_at is not null) then
    perform food99_marcar_opcao(new.tenant_id, 'preco_item', new.id);
  end if;
  if tg_op = 'UPDATE'
     and (new.esgotado is distinct from old.esgotado
          or jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), '99food')
             is distinct from jsonb_exists(coalesce(old.canais_pausados, '[]'::jsonb), '99food')
          or new.codigo_pdv is distinct from old.codigo_pdv) then
    perform food99_marcar_opcao(new.tenant_id, 'status_item', new.id);
  end if;
  return null;
end $$;

create or replace trigger trg_food99_opcao
  after insert or update of preco_99, codigo_pdv, esgotado, canais_pausados, deleted_at on opcao
  for each row execute function food99_opcao_mudou();

-- Conferência (no mesmo Run): 3 linhas, todas `ok = true`.
select 'a fila da 99 com o alvo (produto ou opção)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'food99_envio' and column_name = 'alvo') as ok
union all
select 'a função food99_marcar_opcao',
       exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                where f.proname = 'food99_marcar_opcao' and n.nspname = current_schema())
union all
select 'o gatilho da opção (preço na 99, "Em falta", pausa da 99)',
       coalesce((select pg_get_triggerdef(t.oid) like '%preco_99%' and pg_get_triggerdef(t.oid) like '%canais_pausados%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_food99_opcao' and not t.tgisinternal and n.nspname = current_schema()), false);
