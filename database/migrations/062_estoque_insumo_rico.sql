-- 062_estoque_insumo_rico.sql — Estoque E1: categoria própria, fornecedor e
-- conversões personalizadas no insumo.
-- ⚠️ ALTER + novas tabelas — rodar no Supabase (apply-sql.mjs) e no local.

-- Categoria de insumo como cadastro próprio (antes era texto livre em item_estoque.categoria).
create table if not exists categoria_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  cor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_categoria_item_tenant on categoria_item(tenant_id);

-- Insumo ganha fornecedor e categoria (cadastro). O texto livre `categoria` fica p/ compat.
alter table item_estoque add column if not exists fornecedor_id uuid references fornecedor(id);
alter table item_estoque add column if not exists categoria_item_id uuid references categoria_item(id);

-- Conversões personalizadas: 1 <unidade_de> = <fator> <unidade_para>.
-- Ex.: 1 fardo = 400 unidade  |  1 kg = 1 peça.
create table if not exists item_conversao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  unidade_de text not null,
  fator numeric not null,
  unidade_para text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_item_conversao_item on item_conversao(item_id);
