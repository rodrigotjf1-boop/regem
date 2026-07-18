-- CORREÇÃO de bug latente: a mig 095 ASSUMIU que `comanda_item` e
-- `producao_pedido_item` já tinham `updated_at` (não tinham) e criou o gatilho
-- `trg_bump_updated_at` nelas mesmo assim. Sem a coluna:
--   - todo UPDATE nessas tabelas falha ("column updated_at does not exist"), e
--   - o daemon de sync (push por cursor updated_at) erra a cada ciclo no edge.
-- Aqui criamos as colunas que faltavam. Os gatilhos (mig 095) passam a funcionar.
-- Aditivo/idempotente.
alter table comanda_item         add column if not exists updated_at timestamptz not null default now();
alter table producao_pedido_item add column if not exists updated_at timestamptz not null default now();
