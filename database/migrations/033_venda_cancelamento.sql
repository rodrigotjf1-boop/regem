-- 033_venda_cancelamento.sql — Cupons e cancelamento de venda (Fase C).
-- ⚠️ ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.
--
-- Guarda o total/forma na comanda (cupom) e os campos de cancelamento. O lançamento
-- de caixa passa a referenciar a comanda para poder estornar no cancelamento.
-- (A baixa de estoque já é rastreável por movimento_estoque.ref_tipo/ref_id — migration 024.)

alter table comanda
  add column if not exists total numeric,
  add column if not exists forma text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por_id uuid,
  add column if not exists motivo_cancelamento text;

alter table lancamento_caixa
  add column if not exists comanda_id uuid;
create index if not exists idx_lancamento_comanda on lancamento_caixa (comanda_id);
