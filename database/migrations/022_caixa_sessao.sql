-- 022_caixa_sessao.sql — Fase J / J5: sessão de caixa (abertura → fechamento cego).
-- Fechamento CEGO: o operador conta o dinheiro sem ver o esperado; o sistema calcula
-- o esperado (abertura + entradas − saídas do turno) e aponta a diferença.
-- Sangria/suprimento são lançamentos de caixa ligados à sessão.
-- ⚠️ CREATE/ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

create table if not exists caixa_sessao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  status text not null default 'aberta',        -- aberta | fechada
  valor_abertura numeric not null default 0,
  aberta_em timestamptz not null default now(),
  aberta_por_id uuid references colaborador(id),
  valor_informado numeric,                        -- contagem cega do operador
  valor_esperado numeric,                         -- calculado no fechamento
  diferenca numeric,                              -- informado − esperado
  fechada_em timestamptz,
  fechada_por_id uuid references colaborador(id),
  obs text,
  created_at timestamptz not null default now()
);
create index if not exists idx_caixa_sessao on caixa_sessao (tenant_id, status);

-- Liga cada lançamento de caixa à sessão (sangria/suprimento/venda do turno).
alter table lancamento_caixa add column if not exists sessao_id uuid references caixa_sessao(id);
