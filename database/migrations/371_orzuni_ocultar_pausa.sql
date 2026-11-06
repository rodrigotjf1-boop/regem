-- @cloud-only
-- 371 — iFood pelo Orzuni: o "Ocultar" do Regem também PAUSA no iFood (decisão do dono, 06/11/2026: "Sim, pausa no
-- iFood também").
--
-- O "Ocultar" da lista do Cardápio tira o produto do balcão E do cardápio digital (`disponivel_balcao` e
-- `disponivel_cardapio` falsos). O dono, ao testar o piloto, pausou o item por ele esperando a pausa no iFood: agora
-- o produto oculto nos dois canais do Regem fica pausado no iFood, e o "Retomar" o reativa (se nada mais o pausa:
-- "Ativo no iFood" desmarcado, esgotado). Esconder só de UM canal do Regem continua sem mexer no iFood.
--
-- Muda só a função do gatilho do produto (mig 370) e a lista de colunas que o acordam; o despacho
-- (`orzuni-envio.service.ts`) passa a contar o "oculto nos dois" ao decidir pausar/reativar.
--
-- ⚠️ SÓ NUVEM (como a 370). Pelo MCP do Supabase: nada que apague objeto (`create or replace`, LIC-171). Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.orzuni_envio') is null then
    raise exception 'A 371 depende da 370 (orzuni_envio): aplique-a antes.';
  end if;
end $$;

-- Produto: o preço no iFood (mudou, ou passou a valer) e o status — o "Ativo no iFood", o esgotado de todas as lojas
-- e, desde a 371, o "oculto" nos dois canais do Regem.
create or replace function orzuni_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.no_ifood and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
begin
  if not vale then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.preco_ifood is not null then
      perform orzuni_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
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
     or (not new.disponivel_balcao and not new.disponivel_cardapio)
          is distinct from (not old.disponivel_balcao and not old.disponivel_cardapio) then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
  end if;
  return null;
end $$;

create or replace trigger trg_orzuni_produto
  after insert or update of preco_ifood, no_ifood, codigo, canais_pausados, pausado_estoque, deleted_at,
                            disponivel_balcao, disponivel_cardapio on produto
  for each row execute function orzuni_produto_mudou();

-- Conferência (no mesmo Run): o gatilho acorda com as colunas novas.
select t.tgname as gatilho,
       pg_get_triggerdef(t.oid) like '%disponivel_balcao%disponivel_cardapio%' as acorda_com_ocultar
  from pg_trigger t
 where t.tgname = 'trg_orzuni_produto' and not t.tgisinternal;
