-- 185_ordem_producao_encomenda.sql
-- Encomenda de atacado (Fase B): quando a venda de um item de atacado excede o
-- estoque disponível, o excedente vira uma ordem de produção AGENDADA. Estas
-- colunas amarram a ordem à venda (comanda) e guardam a data combinada de entrega
-- e a origem, sem mexer no fluxo de produção já existente (mig 130).

alter table ordem_producao
  add column if not exists comanda_id uuid;          -- venda que originou a encomenda
alter table ordem_producao
  add column if not exists origem text;              -- ex.: 'encomenda_atacado'
alter table ordem_producao
  add column if not exists data_entrega date;        -- data combinada de entrega/retirada

create index if not exists idx_ordem_producao_comanda
  on ordem_producao (comanda_id);
