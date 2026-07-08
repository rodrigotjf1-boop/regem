-- 064_compras.sql — Estoque E3: lista de compras + recebimento que incrementa o estoque.
-- ⚠️ Novas tabelas — rodar no Supabase (apply-sql.mjs) e no local.

create table if not exists compra_lista (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete cascade,
  nome text not null,
  fornecedor_id uuid references fornecedor(id) on delete set null,
  data_recebimento date,
  delegado_id uuid references colaborador(id) on delete set null,
  enviar_kds boolean not null default true,
  enviar_dashboard boolean not null default true,
  status text not null default 'aberta',            -- aberta|recebida|cancelada
  recebida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_compra_lista_tenant on compra_lista(tenant_id);

create table if not exists compra_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  lista_id uuid not null references compra_lista(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  quantidade numeric not null default 0,
  custo_unitario numeric
);
create index if not exists idx_compra_item_lista on compra_item(lista_id);
