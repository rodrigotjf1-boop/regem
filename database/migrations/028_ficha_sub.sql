-- 028_ficha_sub.sql — Fichas técnicas aninhadas: um ingrediente pode ser uma
-- sub-receita (outra ficha) em vez de um item de estoque.
-- ⚠️ ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.
--
-- Um ingrediente é: item de estoque (item_id) OU sub-ficha (sub_ficha_id) OU avulso.
-- Ciclos (A usa B usa A) são barrados na aplicação (escrita) e têm guarda na leitura.

alter table ficha_ingrediente
  add column if not exists sub_ficha_id uuid references ficha_tecnica(id);
