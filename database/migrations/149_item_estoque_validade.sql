-- Data de validade opcional no cadastro do insumo (item de estoque).
-- Preenchida por seletor nativo de data no front (DD/MM/AAAA, pt-BR). Opcional:
-- itens sem validade fixa deixam em branco (a validade real por lote continua
-- nascendo no recebimento de nota).
alter table item_estoque
  add column if not exists validade date;
