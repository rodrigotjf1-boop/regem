-- 019_titulo_extra.sql — Fase H/H1: contas a pagar manuais mais ricas.
-- Categoria (tipo de conta), recorrência (para contas fixas) e foto (comprovante/boleto).
-- ⚠️ ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

alter table titulo_financeiro
  add column if not exists categoria text,
  add column if not exists recorrencia text not null default 'nenhuma', -- nenhuma|semanal|quinzenal|mensal
  add column if not exists foto_ref text;
