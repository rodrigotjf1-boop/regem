-- 025 — Desperdício vinculável a item de estoque (fecha o ciclo desvio→desperdício→furo).
-- item_id: opcional. Quando presente, o registro baixa estoque (movimento saída,
-- motivo 'desperdicio') e é valorizado por custo_unitario (snapshot do custo médio
-- no momento do registro). Sem item, o desperdício continua sendo só um log textual.

alter table desperdicio
  add column if not exists item_id uuid references item_estoque(id),
  add column if not exists custo_unitario numeric;
