-- 005_fase2.sql
-- Fase 2: desperdício, vistoria e estoque (item + movimento-ledger append-only).

create type tipo_vistoria  as enum ('abertura', 'fechamento', 'padrao');
create type tipo_movimento as enum ('entrada', 'saida', 'ajuste');

-- ===================== Desperdício =====================
create table desperdicio (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid references unidade(id) on delete set null,
  setor_id       uuid references setor(id) on delete set null,
  colaborador_id uuid references colaborador(id) on delete set null,
  descricao      text not null,
  quantidade     numeric,
  unidade_medida text,
  motivo         text,
  foto_ref       text,
  data           date not null default current_date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_desperdicio_updated before update on desperdicio
  for each row execute function set_updated_at();
create index idx_desperdicio_tenant on desperdicio(tenant_id);

-- ===================== Vistoria =====================
create table vistoria (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid references unidade(id) on delete set null,
  setor_id       uuid references setor(id) on delete set null,
  colaborador_id uuid references colaborador(id) on delete set null,
  tipo           tipo_vistoria not null default 'padrao',
  data           date not null default current_date,
  observacao     text,
  foto_ref       text,
  status         text not null default 'concluida',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_vistoria_updated before update on vistoria
  for each row execute function set_updated_at();
create index idx_vistoria_tenant on vistoria(tenant_id);

-- ===================== Estoque: item + movimento (ledger) =====================
create table item_estoque (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid references unidade(id) on delete set null,
  nome           text not null,
  unidade_medida text not null default 'un',
  estoque_minimo numeric not null default 0,
  categoria      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_item_estoque_updated before update on item_estoque
  for each row execute function set_updated_at();
create index idx_item_estoque_tenant on item_estoque(tenant_id);

-- Movimento é append-only (sem update/delete) — sincroniza sem conflito; saldo é derivado.
create table movimento_estoque (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  item_id    uuid not null references item_estoque(id) on delete cascade,
  tipo       tipo_movimento not null,
  quantidade numeric not null,
  motivo     text,
  data       date not null default current_date,
  created_at timestamptz not null default now()
);
create index idx_movimento_item   on movimento_estoque(item_id);
create index idx_movimento_tenant on movimento_estoque(tenant_id);
