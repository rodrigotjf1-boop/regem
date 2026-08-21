-- @cloud-only
-- 201_entregador_chegada.sql — App do Entregador (E4 automático): cache das
-- coordenadas do endereço do pedido (geocode 1x) + flag "avisada" p/ o alerta de
-- chegada disparar UMA vez por pedido. Só nuvem. Idempotente.

create table if not exists entregador_chegada (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pedido_id uuid not null unique,
  lat numeric,
  lng numeric,
  avisada boolean not null default false,
  criado_em timestamptz not null default now()
);
