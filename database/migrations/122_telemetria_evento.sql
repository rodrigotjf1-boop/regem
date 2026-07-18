-- @cloud-only  (tabela SÓ da distribuição, vive na NUVEM; o edge não a cria)
-- Telemetria de erro do edge → nuvem. A distribuição é alertada de erros locais
-- (via webhook) e vê o histórico para reparar + publicar update. Dedup por hash
-- (mesmo erro só conta ocorrências, não spamma). Vive na NUVEM.
create table if not exists telemetria_evento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  origem text not null default 'outro',   -- api | sync | impressao | pg | update | outro
  nivel text not null default 'error',    -- warn | error | fatal
  tipo text,                               -- ex.: update_falha, http_500, sync_erro
  mensagem text not null,
  hash text not null,                      -- dedup: sha256(origem+tipo+mensagem)
  stack text,
  contexto jsonb not null default '{}',
  versao text,
  fingerprint text,
  ocorrencias integer not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  resolvido boolean not null default false
);
create unique index if not exists telemetria_evento_dedup on telemetria_evento(tenant_id, hash);
create index if not exists telemetria_evento_tenant_idx on telemetria_evento(tenant_id, ultimo_em desc);
