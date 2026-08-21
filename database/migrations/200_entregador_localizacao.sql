-- @cloud-only
-- 200_entregador_localizacao.sql — App do Entregador (E2): pings de GPS durante a
-- entrega ativa. Só nuvem. Por tenant + colaborador. Alto volume → expurgo por
-- retenção (ex.: > 24h). Idempotente.

create table if not exists entregador_localizacao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  colaborador_id uuid not null,
  lat numeric not null,
  lng numeric not null,
  precisao numeric,
  criado_em timestamptz not null default now()
);

create index if not exists idx_entregador_loc
  on entregador_localizacao (tenant_id, colaborador_id, criado_em desc);
