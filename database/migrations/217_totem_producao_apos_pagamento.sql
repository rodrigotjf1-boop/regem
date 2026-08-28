-- Modo de produção do Totem GoGeM (hub Retirada/Encomendas):
-- pedido em dinheiro produz ANTES de cobrar (false) ou só APÓS o pagamento no
-- balcão (true = PADRÃO). Config por loja em delivery_config (nível rede/unidade_id null).
alter table delivery_config
  add column if not exists totem_producao_apos_pagamento boolean not null default true;
