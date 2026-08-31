-- @cloud-only
-- 219: Saúde da frota (F1) — edge_heartbeat ganha unidade_id, fingerprint e saude (jsonb).
-- edge_heartbeat é do realm da DISTRIBUIÇÃO (só existe na nuvem), então o edge PULA este
-- arquivo inteiro (apply-all-local.mjs pula @cloud-only quando EDGE_MODE=true).
--
-- Por quê: hoje o heartbeat só diz "chegou sinal do RegemEdgeSync"; a frota mostra 🟢
-- mesmo com o Postgres/Impressão caídos, e mistura matriz+filial (mapeia por tenant, não
-- por unidade). Estas colunas destravam: saúde real dos 5 serviços (jsonb), monitor por
-- LOJA (unidade_id) e o fingerprint reaproveitado pelo controle de instalação (F3).
-- Idempotente.

alter table edge_heartbeat add column if not exists unidade_id uuid;
alter table edge_heartbeat add column if not exists fingerprint text;
alter table edge_heartbeat add column if not exists saude jsonb;

-- A frota lê o último heartbeat por (tenant, unidade); índice cobre a ordenação desc.
create index if not exists idx_edge_heartbeat_tenant_unidade_recebido
  on edge_heartbeat (tenant_id, unidade_id, recebido_em desc);
