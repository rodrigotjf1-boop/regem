-- 069_perfil_acesso.sql — Perfis de acesso configuráveis (RBAC editável pelo presidente).
-- ⚠️ Nova tabela + colunas + seed por tenant + backfill. Rodar no Supabase (apply-sql.mjs)
--    e no local (apply-all-local.mjs). Idempotente (if not exists / on conflict do nothing).

-- Perfil de acesso: pacote de permissões que o presidente edita e associa ao colaborador.
-- `nivel` casa com a categoria da hierarquia (presidente|gerente|supervisao|execucao) para
-- compatibilidade com o RBAC atual; `login_web` decide se o perfil entra por e-mail+senha.
create table if not exists perfil_acesso (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  nivel text not null,                       -- presidente | gerente | supervisao | execucao
  login_web boolean not null default false,  -- entra por e-mail+senha? (execução = false, só PIN)
  permissoes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, nivel)
);
create index if not exists idx_perfil_acesso_tenant on perfil_acesso(tenant_id);

-- Colaborador: perfil associado (pelo presidente), liberação do app e status de acesso.
alter table colaborador add column if not exists perfil_acesso_id uuid references perfil_acesso(id);
alter table colaborador add column if not exists app_habilitado boolean not null default false;
-- `status` já existe (default 'ativo'); usaremos 'bloqueado' para cortar o acesso.

-- ── Seed dos 4 perfis-base por tenant (padrões sensatos; o presidente edita depois) ──
insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes)
select e.id, 'Presidente', 'presidente', true, '{
  "ver_financeiro": true, "financeiro": true, "fiscal": true,
  "ponto": {"ver": true, "criar": true, "editar": true, "excluir": true},
  "estoque": {"ver": true, "criar": true, "editar": true, "excluir": true}
}'::jsonb
from empresa e
on conflict (tenant_id, nivel) do nothing;

insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes)
select e.id, 'Gerente', 'gerente', true, '{
  "ver_financeiro": false, "financeiro": false, "fiscal": false,
  "ponto": {"ver": true, "criar": true, "editar": true, "excluir": true},
  "estoque": {"ver": true, "criar": true, "editar": true, "excluir": false}
}'::jsonb
from empresa e
on conflict (tenant_id, nivel) do nothing;

insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes)
select e.id, 'Supervisor', 'supervisao', true, '{
  "ver_financeiro": false, "financeiro": false, "fiscal": false,
  "ponto": {"ver": true, "criar": false, "editar": true, "excluir": false},
  "estoque": {"ver": true, "criar": false, "editar": true, "excluir": false}
}'::jsonb
from empresa e
on conflict (tenant_id, nivel) do nothing;

insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes)
select e.id, 'Execução', 'execucao', false, '{
  "ver_financeiro": false, "financeiro": false, "fiscal": false,
  "ponto": {"ver": false, "criar": false, "editar": false, "excluir": false},
  "estoque": {"ver": false, "criar": false, "editar": false, "excluir": false}
}'::jsonb
from empresa e
on conflict (tenant_id, nivel) do nothing;

-- ── Backfill: associa cada colaborador ao perfil do nível = categoria da sua função ──
update colaborador c
set perfil_acesso_id = p.id
from funcao f, perfil_acesso p
where c.funcao_id = f.id
  and p.tenant_id = c.tenant_id
  and p.nivel = f.categoria::text
  and c.perfil_acesso_id is null;
