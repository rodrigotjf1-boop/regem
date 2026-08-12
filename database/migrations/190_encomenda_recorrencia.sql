-- 190_encomenda_recorrencia.sql
-- S5: recorrência LEVE de encomenda (sem assinatura/cobrança automática). O cliente
-- escolhe "recorrente" no pedido; guardamos um molde (itens + dias da semana + hora)
-- e um cron gera cada ocorrência como uma encomenda comum, com o link do sinal
-- enviado por WhatsApp (n8n). Cada ocorrência segue as mesmas regras de sinal.

create table if not exists encomenda_recorrencia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  cliente_id uuid,
  tipo text not null default 'retirada',       -- retirada | entrega
  endereco jsonb,                               -- snapshot do endereço (entrega)
  forma_pagamento text,
  itens jsonb not null default '[]',            -- snapshot: produtoId/variacao/qtd/complementos
  dias jsonb not null default '[]',             -- dias da semana [0..6] (0=Dom)
  hora text,                                     -- 'HH:MM' da entrega/retirada
  inicio date,
  fim date,                                     -- null = sem fim
  antecedencia_dias integer not null default 2, -- gera a ocorrência N dias antes
  status text not null default 'ativa',         -- ativa | pausada | cancelada
  created_at timestamptz not null default now()
);
create index if not exists idx_encomenda_recorrencia_tenant on encomenda_recorrencia (tenant_id);
create index if not exists idx_encomenda_recorrencia_cliente on encomenda_recorrencia (cliente_id);

-- Liga a ocorrência gerada ao molde (idempotência: 1 por recorrência+data).
alter table pedido_externo add column if not exists recorrencia_id uuid;
create index if not exists idx_pedido_externo_recorrencia on pedido_externo (recorrencia_id);
