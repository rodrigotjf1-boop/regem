-- 080_cliente_link.sql — Link curto por cliente (slug) para o cardápio.
-- Em vez do token JWT longo na URL, um slug de ~8 chars aponta para o cliente.
-- Idempotente.

create table if not exists cliente_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  cliente_id uuid not null references cliente(id) on delete cascade,
  slug text not null unique,
  criado_em timestamptz not null default now()
);
create index if not exists idx_cliente_link_cliente on cliente_link (cliente_id);
