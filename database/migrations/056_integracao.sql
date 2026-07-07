-- 056 — Integrações com apps de delivery externos (credenciais por canal)
-- Os secrets NUNCA voltam em texto para o cliente (GET mascarado).

create table if not exists integracao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  canal text not null,           -- ifood | ubereats | rappi | 99food | outro
  ativo boolean not null default false,
  merchant_id text,
  client_id text,
  client_secret text,            -- secret (não retorna no GET)
  token text,                    -- secret (não retorna no GET)
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_integracao_tenant_canal on integracao(tenant_id, canal);
