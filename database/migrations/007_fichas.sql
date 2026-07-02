-- 007_fichas.sql — Fichas Técnicas + ingredientes (base do CMV)
-- ficha_tecnica: padroniza uma produção/receita; ingredientes alimentam o custo.

create table if not exists ficha_tecnica (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete set null,
  setor_id uuid references setor(id) on delete set null,
  pop_id uuid references pop(id) on delete set null,
  nome text not null,
  categoria text not null default 'base',
  rendimento numeric(12,3) not null default 1,
  rendimento_unidade text,
  validade text,
  preco_venda numeric(12,2),
  meta_cmv numeric(5,2) not null default 31.5,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_ficha_tecnica_tenant on ficha_tecnica (tenant_id);
create trigger trg_ficha_tecnica_updated before update on ficha_tecnica
  for each row execute function set_updated_at();

create table if not exists ficha_ingrediente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  ficha_id uuid not null references ficha_tecnica(id) on delete cascade,
  item_id uuid references item_estoque(id) on delete set null,
  insumo_nome text not null,
  quantidade numeric(12,3) not null default 0,
  unidade text,
  fator_correcao numeric(6,3) not null default 1,
  custo_unitario numeric(12,4) not null default 0,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_ficha_ingrediente_ficha on ficha_ingrediente (ficha_id);
