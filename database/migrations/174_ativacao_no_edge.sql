-- 174_ativacao_no_edge.sql — a tabela `ativacao` (e sua FK `revenda`) precisa EXISTIR
-- no EDGE. NÃO é @cloud-only, de propósito.
--
-- Contexto: a 082 criou `ativacao` marcada @cloud-only, partindo do princípio de que
-- "o edge não lê estas tabelas". Isso deixou de ser verdade: features novas passaram a
-- consultar `ativacao` DENTRO do backend do edge —
--   - empresa/workspace.controller.ts (montar) → tela "qual é sua empresa" (pré-login);
--   - modulo/modulo.service.ts (doPlano)       → gating de módulos (logo após o login).
-- Como a 082 é pulada no edge (apply-all-local ignora @cloud-only quando EDGE_MODE=true),
-- a tabela não existia na loja e AMBOS estouravam 500 `relation "ativacao" does not exist`,
-- travando o login. Vazia já resolve: os dois pontos tratam "sem linha" (plano nulo /
-- "não limita"). Regra do projeto: tabela LIDA pelo edge nunca pode ser @cloud-only.
--
-- Idempotente (mesmo DDL da 082, `if not exists`). Na nuvem já existem → no-op benigno.
-- `edge_heartbeat` continua só na nuvem (o edge não a lê; só a nuvem faz INSERT).

create table if not exists revenda (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists ativacao (
  id uuid primary key default gen_random_uuid(),
  revenda_id uuid references revenda(id) on delete set null,
  tenant_id uuid references empresa(id) on delete cascade,
  token_hash text not null unique,
  ramo text not null default 'food_service',
  plano text not null default 'basico',
  modulos jsonb not null default '[]',
  trial boolean not null default false,
  validade_ate timestamptz,
  status text not null default 'emitido',
  device_fingerprint text,
  criado_em timestamptz not null default now(),
  ativado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_ativacao_tenant on ativacao (tenant_id);
create index if not exists idx_ativacao_revenda on ativacao (revenda_id);
