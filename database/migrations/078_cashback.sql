-- 078_cashback.sql — Módulo de Cashback (concorre com Fidelidade). Idempotente.
--
-- Dois tipos de plano:
--   valor  → % de retorno em R$ sobre o pedido (base total ou sem frete), vira
--            saldo do cliente para abater em pedidos futuros.
--   pontos → pontos por real (tabela de faixas), trocados por produtos.
-- Crédito após a CONFIRMAÇÃO do pedido; estorno se o pedido for cancelado.
-- Saldo com prazo opcional (expira_em no saldo, estendido a cada crédito).

create table if not exists cashback_plano (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  tipo text not null,                         -- valor | pontos
  ativo boolean not null default true,
  status text not null default 'ativo',       -- ativo | finalizando | encerrado
  -- tipo valor
  percentual numeric,                          -- % de retorno
  base text not null default 'total',          -- total | sem_frete
  -- tipo pontos
  regras jsonb not null default '[]',          -- [{ reais, pontos }]
  prazo_resgate_dias integer,                  -- null = sem prazo
  criado_em timestamptz not null default now()
);
create index if not exists idx_cashback_plano_tenant on cashback_plano (tenant_id);

-- Valor em pontos de cada produto (resgate no tipo pontos).
create table if not exists cashback_produto_valor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  plano_id uuid not null references cashback_plano(id) on delete cascade,
  produto_id uuid not null,
  pontos integer not null default 0
);
create index if not exists idx_cashback_prodvalor_plano on cashback_produto_valor (plano_id);

-- Saldo do cliente por tipo (valor em R$ ou pontos).
create table if not exists cashback_saldo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  telefone text not null,
  cliente_id uuid,
  tipo text not null,                          -- valor | pontos
  saldo numeric not null default 0,
  expira_em timestamptz,                       -- prazo do saldo (null = sem prazo)
  atualizado_em timestamptz not null default now()
);
create unique index if not exists idx_cashback_saldo_uni on cashback_saldo (tenant_id, telefone, tipo);

-- Razão (ledger) — base da integridade/estorno.
create table if not exists cashback_movimento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  telefone text not null,
  cliente_id uuid,
  tipo text not null,                          -- valor | pontos
  delta numeric not null,                      -- + crédito | - resgate/estorno
  origem text not null,                        -- credito | resgate | estorno | expiracao
  plano_id uuid,
  pedido_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists idx_cashback_mov_tel on cashback_movimento (tenant_id, telefone, tipo);
create index if not exists idx_cashback_mov_pedido on cashback_movimento (pedido_id);

-- Vale de produto resgatado por pontos (abate no próximo pedido, auto).
create table if not exists cashback_vale (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  telefone text not null,
  cliente_id uuid,
  produto_id uuid,
  descricao text,
  valor numeric not null default 0,            -- desconto equivalente (preço do produto)
  status text not null default 'disponivel',   -- disponivel | usado
  criado_em timestamptz not null default now(),
  pedido_id uuid
);
create index if not exists idx_cashback_vale_tel on cashback_vale (tenant_id, telefone, status);

-- Fidelidade: marca pontos estornados por cancelamento (reaproveita a tabela).
alter table fidelidade_ponto add column if not exists estornado boolean not null default false;
