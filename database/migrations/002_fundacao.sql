-- 002_fundacao.sql
-- Fase 0 — Fundação: multi-tenant, hierarquia/RBAC, cadastros base,
-- entitlements, camada de API e auditoria.

-- ===================== Tipos =====================
create type categoria_hierarquia as enum ('presidente','gerente','supervisao','execucao');
create type tipo_vinculo         as enum ('clt','horista','diarista','pj','autonomo');

-- ===================== Empresa (tenant raiz) =====================
create table empresa (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cnpj       text unique,
  ramo       text not null default 'food_service',
  plano      text not null default 'basico',
  status     text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_empresa_updated before update on empresa
  for each row execute function set_updated_at();

-- ===================== Entitlements (feature-flags por tenant) =====================
create table entitlement (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  modulo     text not null,            -- ex.: 'estoque','gamificacao','kds','ia'
  ativo      boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, modulo)
);
create trigger trg_entitlement_updated before update on entitlement
  for each row execute function set_updated_at();

-- ===================== Unidade (loja) =====================
create table unidade (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  nome       text not null,
  endereco   text,
  timezone   text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_unidade_updated before update on unidade
  for each row execute function set_updated_at();

-- ===================== Nó local (hub por unidade) =====================
create table no_local (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references empresa(id) on delete cascade,
  unidade_id    uuid not null references unidade(id) on delete cascade,
  identificador text,                  -- MAC / id do dispositivo
  versao        text,
  last_sync_at  timestamptz,
  status        text not null default 'ativo',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_no_local_updated before update on no_local
  for each row execute function set_updated_at();

-- ===================== Setor =====================
create table setor (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  nome       text not null,
  icone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_setor_updated before update on setor
  for each row execute function set_updated_at();

-- ===================== Função (cargo) =====================
create table funcao (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  nome       text not null,
  categoria  categoria_hierarquia not null default 'execucao',
  setor_id   uuid references setor(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_funcao_updated before update on funcao
  for each row execute function set_updated_at();

-- ===================== Colaborador =====================
create table colaborador (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  nome       text not null,
  foto_ref   text,
  funcao_id  uuid references funcao(id) on delete set null,
  vinculo    tipo_vinculo not null default 'clt',
  pin_hash   text,                     -- login rápido em terminal compartilhado
  status     text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_colaborador_updated before update on colaborador
  for each row execute function set_updated_at();

-- ===================== Colaborador x Unidade (N:N) =====================
create table colaborador_unidade (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  unidade_id     uuid not null references unidade(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (colaborador_id, unidade_id)
);

-- ===================== Equipe =====================
create table equipe (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  nome       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_equipe_updated before update on equipe
  for each row execute function set_updated_at();

create table equipe_membro (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  equipe_id      uuid not null references equipe(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  unique (equipe_id, colaborador_id)
);

-- ===================== Camada de API =====================
create table api_client (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  nome        text not null,
  secret_hash text not null,
  scopes      text[] not null default '{}',
  status      text not null default 'ativo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_api_client_updated before update on api_client
  for each row execute function set_updated_at();

create table webhook_subscription (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  evento     text not null,
  url        text not null,
  secret     text,
  status     text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_webhook_updated before update on webhook_subscription
  for each row execute function set_updated_at();

-- ===================== Auditoria =====================
create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references empresa(id) on delete cascade,
  unidade_id    uuid references unidade(id) on delete set null,
  actor_tipo    text not null default 'usuario',  -- 'usuario' | 'api_client'
  actor_id      uuid,
  acao          text not null,
  entidade_tipo text,
  entidade_id   uuid,
  detalhe       jsonb,
  created_at    timestamptz not null default now()
);

-- ===================== Índices =====================
create index idx_unidade_tenant        on unidade(tenant_id);
create index idx_no_local_unidade      on no_local(unidade_id);
create index idx_setor_unidade         on setor(unidade_id);
create index idx_funcao_tenant         on funcao(tenant_id);
create index idx_colaborador_tenant    on colaborador(tenant_id);
create index idx_colab_unidade_unidade on colaborador_unidade(unidade_id);
create index idx_audit_tenant_created  on audit_log(tenant_id, created_at desc);
