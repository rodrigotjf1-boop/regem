-- @cloud-only
-- 322 — A linha da ficha acompanha o NOME do produto e da sub-receita (ERR-231; pedido do dono, 14/10/2026).
--
-- A linha da ficha liga o ingrediente pelo código (`item_id` / `sub_ficha_id`) e guarda AO LADO uma cópia
-- do nome (`insumo_nome`), feita quando o ingrediente foi escolhido. Renomear o produto não mexia na
-- cópia: o dono renomeou o pão das 9 fichas e a tela passou a mostrar os dois nomes na mesma linha
-- (o seletor, com o nome atual; o campo "Insumo" e a leitura do Farol, com o antigo). A baixa e o custo
-- sempre seguiram o código — só o texto ficava velho. O dono escolheu o NOME PRINCIPAL (o nome comercial
-- continua sendo o das compras).
--
-- O que esta migration faz:
--  1. gatilho no produto do estoque: quando o NOME muda — pela tela, pela importação ou pelo
--     sincronismo que traz o cadastro da loja —, as linhas vivas das fichas que o usam recebem o nome
--     novo, com a data de alteração renovada (é ela que faz a linha descer para a loja; com a marca
--     `regem.sync` da sessão, o gatilho da mig 259 mantém a data que vier escrita);
--  2. o mesmo na ficha usada como sub-receita;
--  3. corrige as linhas que já estavam com o nome antigo.
-- Gatilho POR LINHA e só quando o nome muda (`when`): as outras alterações do produto (custo, saldo)
-- nem chamam a função. Renomear em massa vira uma gravação por produto renomeado (medido com 5 mil).
--
-- SÓ NUVEM: a nuvem é a dona das linhas da ficha (elas só descem para a loja). Na loja, o nome novo
-- chega com a linha. Gatilho e função por `create or replace` (Postgres 14+). Idempotente; não apaga nada.
set local lock_timeout = '5s';

create or replace function ficha_linha_nome_do_produto() returns trigger
language plpgsql as $$
begin
  update ficha_ingrediente fi
     set insumo_nome = new.nome, updated_at = now()
   where fi.tenant_id = new.tenant_id
     and fi.item_id = new.id
     and fi.sub_ficha_id is null
     and fi.deleted_at is null
     and fi.insumo_nome is distinct from new.nome;
  return null;
end;
$$;

create or replace function ficha_linha_nome_da_subreceita() returns trigger
language plpgsql as $$
begin
  update ficha_ingrediente fi
     set insumo_nome = new.nome, updated_at = now()
   where fi.tenant_id = new.tenant_id
     and fi.sub_ficha_id = new.id
     and fi.deleted_at is null
     and fi.insumo_nome is distinct from new.nome;
  return null;
end;
$$;

create or replace trigger trg_ficha_linha_nome_do_produto
  after update of nome on item_estoque
  for each row when (old.nome is distinct from new.nome)
  execute function ficha_linha_nome_do_produto();

create or replace trigger trg_ficha_linha_nome_da_subreceita
  after update of nome on ficha_tecnica
  for each row when (old.nome is distinct from new.nome)
  execute function ficha_linha_nome_da_subreceita();

-- 3. As linhas que já estavam com o nome antigo.
update ficha_ingrediente fi
   set insumo_nome = i.nome, updated_at = now()
  from item_estoque i
 where i.id = fi.item_id
   and i.tenant_id = fi.tenant_id
   and fi.sub_ficha_id is null
   and fi.deleted_at is null
   and fi.insumo_nome is distinct from i.nome;

update ficha_ingrediente fi
   set insumo_nome = s.nome, updated_at = now()
  from ficha_tecnica s
 where s.id = fi.sub_ficha_id
   and s.tenant_id = fi.tenant_id
   and fi.deleted_at is null
   and fi.insumo_nome is distinct from s.nome;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'gatilho trg_ficha_linha_nome_do_produto' as objeto,
       exists (select 1 from pg_trigger g
                 join pg_class t on t.oid = g.tgrelid
                 join pg_namespace n on n.oid = t.relnamespace
                where g.tgname = 'trg_ficha_linha_nome_do_produto' and t.relname = 'item_estoque'
                  and n.nspname = current_schema()) as ok
union all
select 'gatilho trg_ficha_linha_nome_da_subreceita',
       exists (select 1 from pg_trigger g
                 join pg_class t on t.oid = g.tgrelid
                 join pg_namespace n on n.oid = t.relnamespace
                where g.tgname = 'trg_ficha_linha_nome_da_subreceita' and t.relname = 'ficha_tecnica'
                  and n.nspname = current_schema())
union all
select 'linhas vivas com o nome diferente do atual',
       not exists (select 1
                     from ficha_ingrediente fi
                     left join item_estoque i on i.id = fi.item_id and i.tenant_id = fi.tenant_id and fi.sub_ficha_id is null
                     left join ficha_tecnica s on s.id = fi.sub_ficha_id and s.tenant_id = fi.tenant_id
                    where fi.deleted_at is null
                      and coalesce(s.nome, i.nome) is not null
                      and fi.insumo_nome is distinct from coalesce(s.nome, i.nome));
