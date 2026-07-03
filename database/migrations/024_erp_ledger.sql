-- 024_erp_ledger.sql — Lógica de Negócio §6: ref_* no ledger (idempotência da explosão)
-- + campos de ERP (lead time/prazo do fornecedor, segurança/ABC do item) + snapshot e feriado.
-- ⚠️ CREATE/ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

-- Rastro da origem do movimento (venda|producao|recebimento|desperdicio|ajuste|estorno).
alter table movimento_estoque
  add column if not exists ref_tipo text,
  add column if not exists ref_id uuid;
-- Idempotência: a mesma origem (ref) não baixa o mesmo item duas vezes.
create unique index if not exists idx_movimento_ref
  on movimento_estoque (tenant_id, ref_tipo, ref_id, item_id)
  where ref_id is not null;

alter table fornecedor
  add column if not exists lead_time_dias int not null default 2,
  add column if not exists prazo_pagamento_dias int not null default 28;

alter table item_estoque
  add column if not exists dias_seguranca int not null default 2,
  add column if not exists classe_abc varchar(1);

-- Snapshot de estoque (fechamento) — torna o CMV real O(1). PK (tenant,item,data)
-- porque unidade_id é anulável e não pode compor PK.
create table if not exists estoque_snapshot (
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  item_id uuid not null references item_estoque(id) on delete cascade,
  data date not null,
  saldo numeric not null default 0,
  custo_medio numeric not null default 0,
  primary key (tenant_id, item_id, data)
);

-- Feriados por tenant/unidade (jornada §3: extra 100% em feriado).
create table if not exists feriado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  data date not null,
  nome text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_feriado_tenant on feriado (tenant_id, data);
