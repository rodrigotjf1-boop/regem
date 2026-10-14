-- 321 — Índices para achar as linhas de ficha de um produto ou de uma sub-receita (14/10/2026).
--
-- "Quais fichas usam este produto?" e "quais usam esta ficha como sub-receita?" liam a tabela inteira
-- (só havia índice por ficha e o do sincronismo). Quem pergunta: refazer as linhas quando a conversão
-- do produto ou da sub-receita muda (`estoque.service › reconverterFichas`, `fichas.service ›
-- reconverterSubReceitas`) e, na nuvem, o gatilho que leva o nome novo do produto às fichas (mig 322).
-- A tabela guarda também as linhas antigas (cada edição da ficha marca as anteriores como apagadas):
-- os índices são só das linhas vivas.
--
-- NÃO é só nuvem: as mesmas consultas rodam no servidor da loja. Idempotente; o arquivo não apaga nada.
set local lock_timeout = '5s';

create index if not exists idx_ficha_ingrediente_item_vivo
  on ficha_ingrediente (tenant_id, item_id)
  where deleted_at is null and item_id is not null;

create index if not exists idx_ficha_ingrediente_sub_vivo
  on ficha_ingrediente (tenant_id, sub_ficha_id)
  where deleted_at is null and sub_ficha_id is not null;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'idx_ficha_ingrediente_item_vivo' as objeto,
       exists (select 1 from pg_indexes where schemaname = current_schema()
                and tablename = 'ficha_ingrediente' and indexname = 'idx_ficha_ingrediente_item_vivo') as ok
union all
select 'idx_ficha_ingrediente_sub_vivo',
       exists (select 1 from pg_indexes where schemaname = current_schema()
                and tablename = 'ficha_ingrediente' and indexname = 'idx_ficha_ingrediente_sub_vivo');
