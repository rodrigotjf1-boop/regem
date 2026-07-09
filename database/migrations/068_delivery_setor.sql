-- 068_delivery_setor.sql — setor de produção do delivery.
-- A produção dos pedidos de delivery pode ser direcionada a um setor.
-- ⚠️ ALTER — rodar no Supabase (apply-sql.mjs) e no local.

alter table delivery_config add column if not exists setor_id uuid;
