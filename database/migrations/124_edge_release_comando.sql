-- @cloud-only  (releases publicados + comandos remotos — vivem SÓ na nuvem)
-- Console da distribuição, Fase 4: publicar release (o edge lê daqui em vez do env) e
-- comandos remotos (ex.: rollback) que o edge busca e executa no próximo ciclo.
create table if not exists edge_release (
  id uuid primary key default gen_random_uuid(),
  versao text not null,
  url text not null,
  sha256 text not null,
  notas text,
  publicado_por text,
  publicado_em timestamptz not null default now()
);
create index if not exists edge_release_idx on edge_release(publicado_em desc);

create table if not exists edge_comando (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  comando text not null,                    -- rollback | reprocessar
  status text not null default 'pendente',  -- pendente | executado | erro
  solicitado_por text,
  resultado text,
  criado_em timestamptz not null default now(),
  executado_em timestamptz
);
create index if not exists edge_comando_idx on edge_comando(tenant_id, status);
