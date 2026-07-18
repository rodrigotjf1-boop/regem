-- P2 — Sincronizar os complementos materializados para o EDGE (PDV/garçom local).
-- O sync propaga EXCLUSÃO só via `deleted_at` (soft-delete). A materialização e o
-- editor manual passam a SOFT-deletar (em vez de apagar), para a remoção/regeração
-- de grupos/opções chegar ao edge sem deixar duplicatas. Aditivo.
alter table complemento_grupo add column if not exists deleted_at timestamptz;
alter table complemento_opcao add column if not exists deleted_at timestamptz;
create index if not exists complemento_grupo_prod_idx on complemento_grupo(produto_id) where deleted_at is null;
