-- 230_pedido_externo_pagamento.sql — SPLIT de pagamento nos pedidos de delivery /
-- retirada / encomenda. Antes só existia forma única em pedido_externo.forma_pagamento;
-- aqui cada forma vira 1 linha (espelha comanda_pagamento). Idempotente/aditivo.
--
-- NÃO cloud-only: o PDV do EDGE também recebe pagamento de retirada/encomenda localmente,
-- então a tabela precisa existir no edge (o pedido_externo já existe lá).

create table if not exists pedido_externo_pagamento (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  pedido_externo_id  uuid not null references pedido_externo(id) on delete cascade,
  forma              text not null,             -- rótulo da forma (dinheiro|cartao|pix|...)
  forma_pagamento_id uuid,                       -- forma_pagamento.id (catálogo), quando houver
  valor              numeric not null default 0, -- valor pago nesta forma
  created_at         timestamptz not null default now()
);
create index if not exists idx_ped_ext_pgto_pedido on pedido_externo_pagamento (pedido_externo_id);
create index if not exists idx_ped_ext_pgto_tenant on pedido_externo_pagamento (tenant_id);
