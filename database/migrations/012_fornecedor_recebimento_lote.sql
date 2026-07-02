-- 012_fornecedor_recebimento_lote.sql — Fase C: fornecedores, recebimento com
-- divergências e lotes (validade/FEFO). CREATE limpo (nenhuma pré-existia na fundação).

create table if not exists fornecedor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  cnpj text,
  contato text,
  telefone text,
  email text,
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_fornecedor_tenant on fornecedor (tenant_id);

create table if not exists recebimento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  fornecedor_id uuid references fornecedor(id),
  data date not null default current_date,
  nota_ref text,            -- número/identificação da nota
  nota_foto_ref text,       -- URL da foto da nota (upload de mídia)
  status text not null default 'aberto',   -- aberto | conferido
  obs text,
  conferido_em timestamptz,
  conferido_por_id uuid references colaborador(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_recebimento_tenant on recebimento (tenant_id);
create index if not exists idx_recebimento_fornecedor on recebimento (fornecedor_id);

create table if not exists recebimento_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  recebimento_id uuid not null references recebimento(id) on delete cascade,
  item_id uuid not null references item_estoque(id),
  qtd_esperada numeric not null default 0,
  qtd_recebida numeric not null default 0,
  divergencia text not null default 'ok',  -- ok|parcial|nao_veio|danificado|excedente
  validade date,            -- opcional → gera lote ao confirmar
  foto_ref text,
  obs text,
  created_at timestamptz not null default now()
);
create index if not exists idx_receb_item_receb on recebimento_item (recebimento_id);

create table if not exists lote (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  recebimento_id uuid references recebimento(id),
  validade date,
  quantidade numeric not null default 0,
  entrada date not null default current_date,
  esgotado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_lote_item on lote (item_id);
create index if not exists idx_lote_validade on lote (validade);
