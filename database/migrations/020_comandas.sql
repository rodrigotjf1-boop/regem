-- 020_comandas.sql — Fase J / J1: vendas & comandas (o gatilho do loop).
-- Fechar comanda dispara: baixa por explosão de ficha (estoque saída, valorado ao
-- custo médio) + lançamento de caixa (entrada). Liga o PDV ao motor de custo (G) e
-- ao financeiro (H). Sem partidas dobradas — mesmo ledger pragmático.
-- ⚠️ CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

create table if not exists comanda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  mesa text,
  cliente text,
  status text not null default 'aberta',       -- aberta | fechada | cancelada
  taxa_servico_pct numeric not null default 0,  -- 10 = taxa de serviço de 10%
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz,
  aberta_por_id uuid references colaborador(id),
  obs text,
  created_at timestamptz not null default now()
);
create index if not exists idx_comanda_tenant on comanda (tenant_id, status);

create table if not exists comanda_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  comanda_id uuid not null references comanda(id) on delete cascade,
  ficha_id uuid references ficha_tecnica(id),   -- null = item livre (sem baixa de estoque)
  descricao text not null,
  quantidade numeric not null default 1,
  preco_unitario numeric not null default 0,
  criado_por_id uuid references colaborador(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_comanda_item on comanda_item (comanda_id);
