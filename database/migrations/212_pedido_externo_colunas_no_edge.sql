-- 212_pedido_externo_colunas_no_edge.sql
-- As migs 207/209/210 adicionaram colunas em pedido_externo como @cloud-only. MAS o
-- DeliveryService.listar (roda no EDGE) usa Drizzle `.select()`, que NOMEIA TODAS as
-- colunas do schema — então no edge a query quebra com "column ... does not exist"
-- (apareceu entregador_fechamento_id primeiro; viriam codigo_entrega, saida_id, etc.).
-- Regra: coluna referenciada por código que roda no edge NÃO pode ser cloud-only.
-- Esta migração (NÃO cloud-only) cria essas colunas TAMBÉM no edge. Na nuvem já existem
-- (migs 207/209/210) → `if not exists`/`set default` = no-op. Aditiva e idempotente.

alter table pedido_externo
  add column if not exists entregador_fechamento_id uuid,
  add column if not exists codigo_entrega text,
  add column if not exists saida_id uuid,
  add column if not exists ordem_parada smallint,
  add column if not exists rastreio_token text;

-- Defaults iguais às migs 209/210 (pedido criado NO edge também nasce com código/token).
alter table pedido_externo
  alter column codigo_entrega set default lpad((floor(random() * 10000))::int::text, 4, '0');
alter table pedido_externo
  alter column rastreio_token set default substr(md5(random()::text || clock_timestamp()::text), 1, 16);
