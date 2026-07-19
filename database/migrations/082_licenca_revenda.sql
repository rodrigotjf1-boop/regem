-- @cloud-only
-- 082_licenca_revenda.sql — Licença por lease (revenda) + telemetria de frota.
-- Base das fases E-B (provisionamento/licença) e E-C (heartbeat/portal).
-- Idempotente. Ver docs/edge-distribuicao-revenda.md.
--
-- @cloud-only: revenda/ativacao/edge_heartbeat são do realm da DISTRIBUIÇÃO (só
-- nuvem). O edge valida licença por LEASE assinado (não lê estas tabelas) e envia
-- heartbeat para a nuvem (o INSERT em edge_heartbeat acontece do lado da nuvem).
-- Por isso não são criadas no edge (EDGE_MODE=true). Dev local (não-edge) ainda
-- cria, pois o apply-all-local só pula @cloud-only quando EDGE_MODE=true.

-- Revendas (quem distribui e controla as lojas).
create table if not exists revenda (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Ativação/licença por loja = o token que a revenda emite. O lease assinado é
-- derivado desta linha (ramo, plano, módulos, validade). Nunca guardamos o
-- token em claro (só o hash). O device_fingerprint prende na 1ª ativação.
create table if not exists ativacao (
  id uuid primary key default gen_random_uuid(),
  revenda_id uuid references revenda(id) on delete set null,
  tenant_id uuid references empresa(id) on delete cascade, -- vinculado na ativação
  token_hash text not null unique,
  ramo text not null default 'food_service',
  plano text not null default 'basico',
  modulos jsonb not null default '[]',           -- entitlements (kds, ponto, cashback, ...)
  trial boolean not null default false,
  validade_ate timestamptz,                       -- null = sem prazo (assinatura)
  status text not null default 'emitido',         -- emitido | ativado | suspenso | revogado
  device_fingerprint text,                        -- anti-clonagem (fixa na 1ª ativação)
  criado_em timestamptz not null default now(),
  ativado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_ativacao_tenant on ativacao (tenant_id);
create index if not exists idx_ativacao_revenda on ativacao (revenda_id);

-- Telemetria da frota: o edge manda heartbeat (versão, sync, disco, clientes,
-- erro) → alimenta o painel da revenda.
create table if not exists edge_heartbeat (
  id uuid primary key default gen_random_uuid(),
  ativacao_id uuid references ativacao(id) on delete cascade,
  tenant_id uuid,
  versao text,
  estado text,                 -- online | sync_ok | erro
  ultimo_sync timestamptz,
  disco_livre_mb integer,
  clientes integer,
  erro text,
  recebido_em timestamptz not null default now()
);
create index if not exists idx_heartbeat_ativacao on edge_heartbeat (ativacao_id, recebido_em desc);
