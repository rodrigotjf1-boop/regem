-- 006_ocorrencias.sql
-- Ocorrências (gamificação gerencial). Ranking é exclusivo do topo (opacidade).

create type sinal_ocorrencia     as enum ('positiva', 'negativa');
create type gravidade_ocorrencia as enum ('leve', 'grave');

-- Catálogo de tipos (config).
create table tipo_ocorrencia (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  nome       text not null,
  sinal      sinal_ocorrencia not null,
  pontos     integer not null default 0,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_tipo_ocorrencia_updated before update on tipo_ocorrencia
  for each row execute function set_updated_at();

-- Ocorrência registrada sobre um colaborador (sinal/pontos são snapshot do tipo).
create table ocorrencia (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  tipo_id        uuid references tipo_ocorrencia(id) on delete set null,
  autor_id       uuid references colaborador(id) on delete set null,
  sinal          sinal_ocorrencia not null,
  pontos         integer not null default 0,
  gravidade      gravidade_ocorrencia not null default 'leve',
  descricao      text,
  foto_ref       text,
  setor_id       uuid,
  status         text not null default 'vigente',  -- vigente | anulada
  data           date not null default current_date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_ocorrencia_updated before update on ocorrencia
  for each row execute function set_updated_at();
create index idx_ocorrencia_tenant on ocorrencia(tenant_id);
create index idx_ocorrencia_colab  on ocorrencia(colaborador_id);
