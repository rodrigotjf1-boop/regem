-- 008_guias.sql — Guias operacionais (POP) independentes, com passos.
-- Complementa o `pop` (que é snapshot de checklist): aqui o gestor cadastra
-- procedimentos por setor/função, com passos que podem receber foto/vídeo.

create table if not exists guia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete set null,
  setor_id uuid references setor(id) on delete set null,
  funcao_id uuid references funcao(id) on delete set null,
  codigo text,
  titulo text not null,
  descricao text,
  ramo text,
  frequencia text not null default 'diaria',
  estado text not null default 'rascunho',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_guia_tenant on guia (tenant_id);
create trigger trg_guia_updated before update on guia
  for each row execute function set_updated_at();

create table if not exists guia_passo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  guia_id uuid not null references guia(id) on delete cascade,
  ordem integer not null default 0,
  descricao text not null,
  media_ref text,
  created_at timestamptz not null default now()
);
create index if not exists idx_guia_passo_guia on guia_passo (guia_id);
