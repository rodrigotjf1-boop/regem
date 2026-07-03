-- 017_custo_ledger.sql — Fase G / G1: custo no ledger + custo médio ponderado móvel.
-- O movimento de estoque passa a CARREGAR custo; o item mantém o custo médio (CMP),
-- recalculado a cada recebimento. Base do CMV real e do financeiro.
-- ⚠️ ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

alter table recebimento_item add column if not exists custo_unitario numeric;
alter table movimento_estoque add column if not exists custo_unitario numeric;
alter table lote add column if not exists custo_unitario numeric;
alter table item_estoque add column if not exists custo_medio numeric not null default 0;
