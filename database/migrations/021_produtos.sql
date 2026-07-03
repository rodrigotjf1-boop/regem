-- 021_produtos.sql — Fase J: catálogo de produtos (o que se vende no PDV).
-- Produto vendável → liga à ficha técnica (baixa por explosão correta no estoque).
-- Categorias/subcategorias, variações (tamanho/unidade), combos, SKU p/ integrações,
-- preço de venda/custo, validade, roteamento p/ produção (KDS).
-- ⚠️ CREATE/ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

-- Categoria hierárquica (parent_id nulo = categoria; preenchido = subcategoria).
create table if not exists categoria_produto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  parent_id uuid references categoria_produto(id) on delete set null,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_catprod_tenant on categoria_produto (tenant_id);

-- Produto vendável.
create table if not exists produto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  codigo text,                                   -- SKU / índice p/ integrações (iFood, fiscal)
  nome text not null,
  descricao text,
  categoria_id uuid references categoria_produto(id),
  ficha_id uuid references ficha_tecnica(id),    -- baixa por explosão (null = sem baixa)
  tipo text not null default 'simples',          -- simples | variavel | combo
  unidade_medida text not null default 'un',
  preco_venda numeric not null default 0,
  preco_custo numeric,                           -- null = usa custo da ficha / custo médio
  controla_estoque boolean not null default true,
  validade_dias int,
  vai_para_producao boolean not null default true,
  setor_producao_id uuid references setor(id),   -- roteamento do pedido p/ o KDS certo
  imagem_ref text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_produto_tenant on produto (tenant_id) where deleted_at is null;
create unique index if not exists idx_produto_codigo on produto (tenant_id, codigo)
  where codigo is not null and deleted_at is null;

-- Variações de um produto (ex.: 300ml / 500ml) — cada uma com SKU e preço próprios.
create table if not exists produto_variacao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null references produto(id) on delete cascade,
  nome text not null,
  codigo text,
  preco_venda numeric not null default 0,
  fator_ficha numeric not null default 1,        -- multiplica a baixa da ficha (ex.: 500ml = 1.66)
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_prodvar_produto on produto_variacao (produto_id);

-- Componentes de um combo/kit (produto tipo 'combo').
create table if not exists produto_combo_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  combo_produto_id uuid not null references produto(id) on delete cascade,
  componente_produto_id uuid not null references produto(id) on delete cascade,
  quantidade numeric not null default 1
);
create index if not exists idx_combo_pai on produto_combo_item (combo_produto_id);

-- A comanda passa a apontar para o produto (e variação, se houver).
alter table comanda_item add column if not exists produto_id uuid references produto(id);
alter table comanda_item add column if not exists variacao_id uuid references produto_variacao(id);
