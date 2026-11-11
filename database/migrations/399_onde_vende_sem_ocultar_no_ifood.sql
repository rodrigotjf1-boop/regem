-- @cloud-only
-- 399 — R3 F1 (Delivery › Gestão do catálogo › "Produtos e preços", protótipo aprovado pelo dono em 11/11/2026):
-- a pausa passa a ser EXPLÍCITA por canal, e o "Onde vende" aposenta a regra "Ocultar = pausa no iFood" (mig 371,
-- decisão de 06/11 trocada pela decisão 1 do protótipo da R3).
--
-- Antes (371): o produto oculto nos dois canais do Regem (`disponivel_balcao` e `disponivel_cardapio` falsos) ficava
-- PAUSADO no iFood. Agora o Regem e o iFood se pausam cada um no seu botão: tirar do balcão e do cardápio digital (um
-- produto "só no iFood", ou pausado só no Regem) NÃO mexe no iFood. O iFood pausa pelo "Pausado no iFood"
-- (`canais_pausados` com 'ifood') e pelo esgotado (estoque — todas as lojas ou a loja), como antes.
--
-- O que muda:
--   • a função do gatilho do produto (mig 370/371) deixa de olhar o "oculto nos dois";
--   • o gatilho deixa de acordar com `disponivel_balcao`/`disponivel_cardapio`;
--   • e fecha um ponto cego: o produto que ENTRA no cardápio do iFood (`no_ifood` falso → verdadeiro) ou troca de
--     código também manda a situação (pausado ou não), e o criado já no iFood e já pausado manda a pausa — antes ia só
--     o preço, e um item pausado chegava ativo ao iFood até a próxima mudança.
--   • o produto que SAI do cardápio do iFood (`no_ifood` verdadeiro → falso, o "Está no iFood" desmarcado) manda a
--     situação, e o despacho PAUSA o item lá (o Regem não apaga item do iFood — decisão do protótipo da R3). Antes, o
--     item seguia ativo no iFood, vendendo sem baixar o estoque.
--   • A reconciliação: os produtos no iFood que hoje estão ocultos nos dois canais (pausados no iFood só pela regra
--     antiga) recebem um envio de situação — o despacho decide pela regra nova (reativa, se nada mais os pausa).
--     Conferido na nuvem antes de aplicar: 0 produtos nessa situação (11/11/2026).
--
-- O despacho (`orzuni-envio.service.ts`) deixa de contar o "oculto" no MESMO PR.
--
-- ⚠️ SÓ NUVEM (como a 370/371). Pelo MCP do Supabase: nada que apague objeto (`create or replace function`/`trigger`,
--    LIC-171). Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.orzuni_envio') is null then
    raise exception 'A 399 depende da 370 (orzuni_envio): aplique-a antes.';
  end if;
end $$;

create or replace function orzuni_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.no_ifood and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
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
  after insert or update of preco_ifood, no_ifood, codigo, canais_pausados, pausado_estoque, deleted_at on produto
  for each row execute function orzuni_produto_mudou();

-- A reconciliação: produto no iFood oculto nos dois canais do Regem (pausado só pela regra antiga) → envio de situação.
-- Só onde o iFood pelo Orzuni vale (a `orzuni_marcar` confere o direito e a ligação).
do $$
declare
  p record;
begin
  for p in
    select id, tenant_id, unidade_id from produto
     where no_ifood and coalesce(codigo, '') <> '' and deleted_at is null
       and not disponivel_balcao and not disponivel_cardapio
  loop
    perform orzuni_marcar(p.tenant_id, p.unidade_id, 'status_item', p.id);
  end loop;
end $$;

-- Conferência (no mesmo Run): as duas linhas têm de vir com `ok = true`.
select 'o gatilho não acorda mais com balcão/cardápio' as objeto,
       coalesce((select pg_get_triggerdef(t.oid) not like '%disponivel_balcao%'
                        and pg_get_triggerdef(t.oid) like '%canais_pausados%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_orzuni_produto' and not t.tgisinternal and n.nspname = current_schema()), false) as ok
union all
select 'a função não olha mais o "oculto nos dois"',
       coalesce((select pg_get_functiondef(f.oid) not like '%disponivel_balcao%'
                        and pg_get_functiondef(f.oid) like '%not old.no_ifood%'
                        and pg_get_functiondef(f.oid) like '%old.no_ifood and not new.no_ifood%'
                   from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                  where f.proname = 'orzuni_produto_mudou' and n.nspname = current_schema()), false);
