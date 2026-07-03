-- 029_revisao_geral.sql — Correções da revisão geral:
-- 1) colaborador.unidade_id → escopo do Mural por loja (denominador correto).
-- 2) comanda.idempotency_key → dedup de venda balcão (offline-first, anti double-submit).
-- ⚠️ ALTER/CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

alter table colaborador
  add column if not exists unidade_id uuid references unidade(id);

alter table comanda
  add column if not exists idempotency_key text;

-- Uma chave por tenant nunca gera duas comandas (trata corrida concorrente).
create unique index if not exists idx_comanda_idempotency
  on comanda (tenant_id, idempotency_key)
  where idempotency_key is not null;
