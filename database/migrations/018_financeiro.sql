-- 018_financeiro.sql — Fase H / H1: ledger financeiro (contas a pagar/receber + caixa).
-- Mesmo pilar do estoque: nada de saldo mutável. Títulos (a pagar/receber) + lançamentos
-- de caixa IMUTÁVEIS; estorno = lançamento inverso (nunca delete). Contas a pagar nascem
-- do recebimento de mercadoria (gancho "encaminha ao financeiro").
-- ⚠️ CREATE/ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

-- Título financeiro: uma obrigação/direito com vencimento (a pagar ou a receber).
create table if not exists titulo_financeiro (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  tipo text not null,                       -- pagar | receber
  descricao text not null,
  fornecedor_id uuid references fornecedor(id),
  valor numeric not null default 0,
  vencimento date,
  status text not null default 'aberto',    -- aberto | pago | cancelado
  origem text not null default 'manual',    -- recebimento | manual | venda
  origem_id uuid,                           -- id do recebimento/venda de origem
  criado_por_id uuid references colaborador(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_titulo_tenant on titulo_financeiro (tenant_id, status);
create index if not exists idx_titulo_venc on titulo_financeiro (tenant_id, vencimento);
create index if not exists idx_titulo_origem on titulo_financeiro (origem, origem_id);

-- Lançamento de caixa: ledger append-only do dinheiro que entrou/saiu de fato.
-- Baixa de título, sangria/suprimento (futuro PDV), estorno (aponta o lançamento revertido).
create table if not exists lancamento_caixa (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  titulo_id uuid references titulo_financeiro(id),
  tipo text not null,                       -- entrada | saida
  valor numeric not null,
  data date not null default current_date,
  categoria text,
  forma text,                               -- dinheiro | pix | cartao | transferencia
  descricao text,
  estorno_de uuid references lancamento_caixa(id),
  criado_por_id uuid references colaborador(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_caixa_tenant_dia on lancamento_caixa (tenant_id, data);
create index if not exists idx_caixa_titulo on lancamento_caixa (titulo_id);

-- Vencimento no recebimento (para o título a pagar nascer já com prazo).
alter table recebimento add column if not exists vencimento date;
