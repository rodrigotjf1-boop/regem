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
