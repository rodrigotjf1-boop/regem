-- Fase I — TEF (pagamento integrado / pinpad). O agente TEF roda no EDGE
-- (token servidor_local) e fala com a maquininha; aqui fica a transação.

create table if not exists tef_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  ativo boolean not null default false,
  provedor text not null default 'mock',   -- mock | sitef | paygo | stone
  terminal_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_tef_config_tenant_unidade
  on tef_config(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists pagamento_tef (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  comanda_id uuid,
  valor numeric not null default 0,
  forma text not null default 'credito',    -- credito | debito | pix
  parcelas integer not null default 1,
  status text not null default 'pendente',  -- pendente | aprovado | negado | cancelado
  nsu text,
  autorizacao text,
  bandeira text,
  provedor text,
  mensagem text,
  criado_por_id uuid,
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  cancelado_em timestamptz
);
create index if not exists idx_tef_tenant_status on pagamento_tef(tenant_id, status);
create index if not exists idx_tef_comanda on pagamento_tef(comanda_id);
