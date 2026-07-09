-- 070_modulo_ativacao.sql — Módulos ativáveis (CLAUDE.md): o presidente/C&O liga
-- ou desliga módulos por REDE (unidade_id nulo) ou por LOJA (unidade_id preenchido).
-- Desativar corta o acesso na hora (checado no servidor) e é auditado.
-- Idempotente. Rodar no Supabase (apply-sql.mjs) e no local (apply-all-local.mjs).

create table if not exists modulo_ativacao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete cascade, -- null = padrão da rede
  modulo text not null, -- app_colaborador | kds | terminal_ponto | bot
  ativo boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Uma linha por (rede|loja, módulo). Índices únicos separados por causa do NULL
-- em unidade_id (no Postgres, NULLs não colidem numa unique comum).
create unique index if not exists uq_modulo_rede
  on modulo_ativacao (tenant_id, modulo) where unidade_id is null;
create unique index if not exists uq_modulo_loja
  on modulo_ativacao (tenant_id, unidade_id, modulo) where unidade_id is not null;
create index if not exists idx_modulo_ativacao_tenant on modulo_ativacao (tenant_id);
