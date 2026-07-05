-- Fase J — Cardápio digital / QR Code + Totem. Cardápio público por token;
-- pedido na mesa (QR na mesa) vai à comanda; retirada/totem vira pedido externo.

create table if not exists cardapio_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  token text not null unique,               -- identifica o cardápio na URL pública
  ativo boolean not null default false,
  modo text not null default 'mesa',        -- mesa | retirada | totem
  nome_publico text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_cardapio_tenant_unidade
  on cardapio_config(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));
