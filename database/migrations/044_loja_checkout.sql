-- Fase L3 — Checkout da Loja: frete por bairro, cupom, pagamento e rastreio.

-- Frete por bairro (por unidade).
create table if not exists cardapio_bairro (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  nome text not null,
  taxa numeric not null default 0,
  ordem integer not null default 0
);
create index if not exists idx_bairro_tenant on cardapio_bairro(tenant_id);

-- Cupom de desconto.
create table if not exists cupom (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  codigo text not null,
  tipo text not null default 'percentual', -- percentual | valor
  valor numeric not null default 0,
  minimo numeric,                          -- subtotal mínimo
  ativo boolean not null default true,
  validade date,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_cupom_tenant_codigo on cupom(tenant_id, upper(codigo));

-- Dados de checkout no pedido externo.
alter table pedido_externo add column if not exists taxa_entrega numeric not null default 0;
alter table pedido_externo add column if not exists cupom text;
alter table pedido_externo add column if not exists desconto numeric not null default 0;
alter table pedido_externo add column if not exists troco_para numeric;
alter table pedido_externo add column if not exists pago boolean not null default false;
alter table pedido_externo add column if not exists status_pagamento text not null default 'na_entrega'; -- na_entrega | aguardando | aprovado
