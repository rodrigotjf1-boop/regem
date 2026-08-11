-- 182_etiqueta_abrir_baixar.sql — E2 do plano de etiquetas: fluxo abrir/baixar flexível.
--  (1) insumo ganha "validade após aberto (dias)" — antes só produto/ficha tinham;
--  (2) a etiqueta liga ao insumo (item_id) para, ao ABRIR, recalcular a validade e
--      só reimprimir se ela encurtar.
--
-- NÃO é @cloud-only: item_estoque/etiqueta_validade existem no edge.
alter table item_estoque add column if not exists validade_aberto_dias integer;
alter table etiqueta_validade add column if not exists item_id uuid;
create index if not exists idx_etiqueta_validade_item on etiqueta_validade (item_id);
