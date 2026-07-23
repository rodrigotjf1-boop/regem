-- 132_pdv_retirada_encomendas.sql — PDV Balcão → submenu "Retirada / Encomendas".
-- Hub dos pedidos externos (cardápio Regem, integrados, marketplaces) que o atendente
-- entrega/cobra/conclui no balcão. Reaproveita `pedido_externo` (pagamento já existe:
-- pago / status_pagamento). Acrescenta só o vínculo da CONCLUSÃO a-pagar ao caixa
-- (turno) do atendente e os marcos de retirada. Idempotente.

-- Pago online (marketplace/gateway) — snapshot p/ decidir "só entregar" x "cobrar".
-- Deriva de pago + status_pagamento, mas guardamos explícito p/ o hub não ambiguar.
alter table pedido_externo add column if not exists pago_online boolean not null default false;

-- retirada | encomenda (null = entrega/consumo/local — não é do hub de retirada).
alter table pedido_externo add column if not exists retirada_tipo text;

-- Conclusão a-pagar: em qual caixa (caixa_sessao origem='pdv') o valor entrou e quem cobrou.
alter table pedido_externo add column if not exists caixa_sessao_id uuid;
alter table pedido_externo add column if not exists atendente_id uuid;

-- Marcos do balcão.
alter table pedido_externo add column if not exists entregue_em timestamptz;
alter table pedido_externo add column if not exists avisado_pronto_em timestamptz;

-- Índice do hub: pedidos abertos por tenant/unidade/canal.
create index if not exists idx_pedido_externo_hub
  on pedido_externo (tenant_id, unidade_id, status)
  where deleted_at is null;
