-- 318 — Margem de perda na ficha técnica (pedido do dono, 14/10/2026).
--
-- "Na ficha técnica colocar um campo para colocar uma margem %, que seria uma margem de perda, que seria
-- somada essa % no valor de custo; uma variável opcional." Resposta dele sobre a base: "levar em
-- consideração a ficha completa" — a margem vale sobre o custo inteiro da ficha (ingredientes,
-- sub-receitas e a embalagem de cada venda), no balcão e no delivery.
--
-- Só CUSTO: a baixa de estoque não muda (a perda na quantidade é o fator de correção de cada linha).
-- Vazio = sem margem (a conta de sempre). De 0 a 100.
--
-- NÃO é só nuvem: a ficha sincroniza com o servidor da loja, que também calcula o custo.
-- Na NUVEM, a ficha avisa o Farol quando muda (mig 316) — menos nas colunas que a leitura do Farol não
-- mostra (preço e meta de CMV). A margem também não aparece lá (nenhum campo de dinheiro sai para ele),
-- então ela entra nessa lista. No servidor da loja os gatilhos não existem e o bloco não faz nada.
--
-- A venda e a tela leem esta tabela: o `lock_timeout` faz a migration desistir (sem mudar nada) em vez de
-- segurar uma venda. Idempotente; o arquivo não apaga nada.
set local lock_timeout = '5s';

alter table ficha_tecnica
  add column if not exists margem_perda numeric(5,2);

comment on column ficha_tecnica.margem_perda is
  'Margem de perda em %, somada ao custo inteiro da ficha (balcão e delivery). Vazio = sem margem. Não muda a baixa de estoque.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.conname = 'ficha_tecnica_margem_perda_faixa'
       and t.relname = 'ficha_tecnica'
       and n.nspname = current_schema()
  ) then
    alter table ficha_tecnica
      add constraint ficha_tecnica_margem_perda_faixa check (margem_perda is null or (margem_perda >= 0 and margem_perda <= 100));
  end if;
end $$;

-- Só onde existe o aviso do Farol (nuvem): a margem passa a ser ignorada, como o preço e a meta de CMV.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'integracao_retrato_mudou' and n.nspname = current_schema()
  ) then
    create or replace trigger trg_integracao_retrato_ins after insert on ficha_tecnica referencing new table as novas
      for each statement execute function integracao_retrato_mudou('fichas', 'propria', '', 'updated_at,preco_venda,meta_cmv,margem_perda');
    create or replace trigger trg_integracao_retrato_upd after update on ficha_tecnica referencing old table as antigas new table as novas
      for each statement execute function integracao_retrato_mudou('fichas', 'propria', '', 'updated_at,preco_venda,meta_cmv,margem_perda');
    create or replace trigger trg_integracao_retrato_del after delete on ficha_tecnica referencing old table as antigas
      for each statement execute function integracao_retrato_mudou('fichas', 'propria', '', 'updated_at,preco_venda,meta_cmv,margem_perda');
  end if;
end $$;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'ficha_tecnica.margem_perda (numeric 5,2, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'ficha_tecnica'
                  and column_name = 'margem_perda' and data_type = 'numeric'
                  and numeric_precision = 5 and numeric_scale = 2 and is_nullable = 'YES') as ok
union all
select 'restrição ficha_tecnica_margem_perda_faixa (0 a 100)',
       exists (select 1 from pg_constraint c
                 join pg_class t on t.oid = c.conrelid
                 join pg_namespace n on n.oid = t.relnamespace
                where c.conname = 'ficha_tecnica_margem_perda_faixa' and t.relname = 'ficha_tecnica'
                  and n.nspname = current_schema() and c.contype = 'c' and c.convalidated)
union all
select 'aviso do Farol ignora a margem (só onde o aviso existe)',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where p.proname = 'integracao_retrato_mudou' and n.nspname = current_schema())
       or (select count(*) = 3 from pg_trigger g join pg_class t on t.oid = g.tgrelid
                                join pg_namespace n on n.oid = t.relnamespace
            where t.relname = 'ficha_tecnica' and n.nspname = current_schema()
              and g.tgname like 'trg_integracao_retrato_%'
              and encode(g.tgargs, 'escape') like '%margem_perda%');
