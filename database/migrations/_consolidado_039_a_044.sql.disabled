-- ============================================================
-- CONSOLIDADO idempotente: migrations 039 a 044 (na ordem).
-- Rode este bloco inteiro no SQL Editor do Supabase.
-- Seguro reaplicar: tudo usa 'if not exists'.
-- ============================================================

-- ===== 039_delivery.sql =====
-- Fase H — Delivery / canais externos (iFood + genérico). Ingestão pelo edge
-- (token servidor_local); pedido aceito vira venda + produção (F1).

create table if not exists delivery_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  ativo boolean not null default false,
  auto_aceitar boolean not null default false,
  merchant_id text,                 -- id da loja no canal (iFood)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_delivery_config_tenant_unidade
  on delivery_config(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists pedido_externo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  canal text not null default 'ifood',      -- ifood | generico
  external_id text,                          -- id do pedido no canal
  display_id text,                           -- código curto exibido
  cliente_nome text,
  cliente_telefone text,
  tipo text not null default 'entrega',      -- entrega | retirada
  endereco text,
  itens jsonb not null default '[]',         -- [{codigo,descricao,quantidade,precoUnitario,observacao}]
  total numeric not null default 0,
  forma_pagamento text,                      -- online | dinheiro | ...
  status text not null default 'novo',       -- novo|confirmado|em_producao|pronto|despachado|concluido|cancelado
  comanda_id uuid,                           -- comanda interna criada ao aceitar
  raw jsonb,                                 -- payload original do canal
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz,
  pronto_em timestamptz,
  despachado_em timestamptz,
  concluido_em timestamptz,
  cancelado_em timestamptz,
  motivo_cancelamento text
);
create index if not exists idx_pedext_tenant_status on pedido_externo(tenant_id, status);
create unique index if not exists uq_pedext_canal_external
  on pedido_externo(tenant_id, canal, external_id);

-- ===== 040_tef.sql =====
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

-- ===== 041_cardapio.sql =====
-- Fase J — Cardápio digital / QR Code + Totem. Cardápio público por token;
-- pedido na mesa (QR na mesa) vai à comanda; retirada/totem vira pedido externo.

create table if not exists cardapio_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  token text not null unique,               -- identifica o cardápio na URL pública
  ativo boolean not null default false,
  modo text not null default 'mesa',        -- mesa | retirada | totem
  nome_publico text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_cardapio_tenant_unidade
  on cardapio_config(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ===== 042_produto_loja_fiscal.sql =====
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

-- ===== 043_loja_config.sql =====
-- Fase L2 — Motor da Loja: dados da loja + tema por ramo + frete/pagamento na
-- config do cardápio (estende cardapio_config).

alter table cardapio_config add column if not exists ramo text not null default 'food'; -- food|varejo|industria|servicos
alter table cardapio_config add column if not exists logo_emoji text;
alter table cardapio_config add column if not exists subtitulo text;
alter table cardapio_config add column if not exists aberto boolean not null default true;   -- aberto/fechado manual
alter table cardapio_config add column if not exists tempo_entrega_min integer;
alter table cardapio_config add column if not exists pedido_minimo numeric;
alter table cardapio_config add column if not exists avaliacao numeric;
alter table cardapio_config add column if not exists frete_gratis_acima numeric;
alter table cardapio_config add column if not exists pagamentos jsonb not null default '[]'; -- ['pix','cartao','entrega','vr']
alter table cardapio_config add column if not exists fidelidade_ativa boolean not null default false;
alter table cardapio_config add column if not exists whatsapp text;

-- ===== 044_loja_checkout.sql =====
-- Fase L3 — Checkout da Loja: frete por bairro, cupom, pagamento e rastreio.

-- Frete por bairro (por unidade).
create table if not exists cardapio_bairro (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  nome text not null,
  taxa numeric not null default 0,
  ordem integer not null default 0
);
create index if not exists idx_bairro_tenant on cardapio_bairro(tenant_id);

-- Cupom de desconto.
create table if not exists cupom (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  codigo text not null,
  tipo text not null default 'percentual', -- percentual | valor
  valor numeric not null default 0,
  minimo numeric,                          -- subtotal mínimo
  ativo boolean not null default true,
  validade date,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_cupom_tenant_codigo on cupom(tenant_id, upper(codigo));

-- Dados de checkout no pedido externo.
alter table pedido_externo add column if not exists taxa_entrega numeric not null default 0;
alter table pedido_externo add column if not exists cupom text;
alter table pedido_externo add column if not exists desconto numeric not null default 0;
alter table pedido_externo add column if not exists troco_para numeric;
alter table pedido_externo add column if not exists pago boolean not null default false;
alter table pedido_externo add column if not exists status_pagamento text not null default 'na_entrega'; -- na_entrega | aguardando | aprovado
