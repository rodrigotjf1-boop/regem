-- Fase L1 — Cadastro de produto enriquecido (Loja) + campos fiscais pendentes.

-- ===== Loja / cardápio =====
alter table produto add column if not exists preco_promocional numeric;      -- "por" (precoVenda vira "de")
alter table produto add column if not exists selos jsonb not null default '[]'; -- veg, sem_gluten, sem_lactose, mais_pedido, novo, picante
alter table produto add column if not exists disponivel_cardapio boolean not null default true; -- bloqueio manual
alter table produto add column if not exists venda_multiplo integer;         -- B2B: vende em múltiplos de N
alter table produto add column if not exists duracao_min integer;            -- serviços: duração

-- ===== Fiscais pendentes (após NFC-e) =====
alter table produto add column if not exists gtin text;                      -- EAN/código de barras
alter table produto add column if not exists cst_pis text;
alter table produto add column if not exists aliq_pis numeric;
alter table produto add column if not exists cst_cofins text;
alter table produto add column if not exists aliq_cofins numeric;

-- ===== Faixas de preço por volume (B2B) =====
create table if not exists produto_faixa_preco (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null references produto(id) on delete cascade,
  qtd_min integer not null default 1,
  preco numeric not null default 0,
  ordem integer not null default 0
);
create index if not exists idx_faixa_produto on produto_faixa_preco(produto_id);

-- ===== Opção de complemento pode referenciar um PRODUTO (combo por etapa:
-- ex.: escolher a bebida) — ao vender, o produto referenciado explode a ficha. =====
alter table complemento_opcao add column if not exists produto_ref_id uuid;

-- complemento_grupo.tipo passa a aceitar 'escolha' além de remover|adicionar
-- (sem alteração de coluna — é text). Grupo 'escolha' = radio/checkbox, sem baixa.
