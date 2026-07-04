-- 032_produto_complementos.sql — Modificadores de produto no PDV (Fase B):
-- OPCIONAIS (remover ingrediente da ficha → NÃO baixa) e ADICIONAIS (extra → baixa).
-- ⚠️ CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

-- Grupo de complementos de um produto (ex.: "Retirar", "Adicionais").
create table if not exists complemento_grupo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null references produto(id) on delete cascade,
  nome text not null,
  tipo text not null,                 -- 'remover' | 'adicionar'
  min int not null default 0,         -- mín. de opções (obrigatório > 0)
  max int,                            -- máx. de opções (null = sem limite)
  obrigatorio boolean not null default false,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_comp_grupo_produto on complemento_grupo (produto_id);

-- Opção de um grupo. 'remover' aponta o ficha_ingrediente que NÃO deve baixar;
-- 'adicionar' aponta o item_estoque (+ quantidade) que DEVE baixar.
create table if not exists complemento_opcao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  grupo_id uuid not null references complemento_grupo(id) on delete cascade,
  nome text not null,
  preco_delta numeric not null default 0,   -- adicionais somam ao preço; remover ~0
  ficha_ingrediente_id uuid,                -- 'remover': ingrediente a NÃO baixar
  item_id uuid,                             -- 'adicionar': item de estoque a baixar
  quantidade numeric not null default 1,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_comp_opcao_grupo on complemento_opcao (grupo_id);

-- O que foi marcado na venda daquela linha (snapshot p/ recibo e baixa correta).
create table if not exists comanda_item_complemento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  comanda_item_id uuid not null references comanda_item(id) on delete cascade,
  opcao_id uuid,
  tipo text not null,                       -- 'remover' | 'adicionar'
  nome text not null,
  preco_delta numeric not null default 0,
  ficha_ingrediente_id uuid,
  item_id uuid,
  quantidade numeric not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists idx_cic_item on comanda_item_complemento (comanda_item_id);
