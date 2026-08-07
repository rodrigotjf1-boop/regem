-- 170_suporte_sessao.sql
-- @cloud-only
-- Fase 9 (técnico cross-tenant) — sessão de SUPORTE: um usuário da distribuição
-- acessa as CONFIGURAÇÕES de uma loja por tempo limitado, escopado e auditado.
-- Só existe na nuvem (o edge nunca impersona). Aditiva e idempotente.

create table if not exists suporte_sessao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  tecnico_id uuid not null,            -- usuario_distribuicao.id (quem acessou)
  tecnico_nome text,
  motivo text,
  ip text,
  iniciada_em timestamptz not null default now(),
  expira_em timestamptz not null,      -- TTL curto (ex.: 30 min)
  encerrada_em timestamptz,
  encerrada_por text                   -- 'expirou' | 'tecnico' | 'loja'
);
create index if not exists ix_suporte_sessao_tenant on suporte_sessao (tenant_id, iniciada_em desc);
create index if not exists ix_suporte_sessao_ativa on suporte_sessao (id) where encerrada_em is null;

-- Consentimento: a loja pode BLOQUEAR o acesso de suporte (default: permitido,
-- conforme decisão "ligado por padrão, auditado, revogável"). Ligado = corta na hora.
alter table empresa add column if not exists suporte_bloqueado boolean not null default false;
