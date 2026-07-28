-- Custo derivado no catálogo: produto industrializado (revenda, ex.: lata de
-- coca) aponta para o item de estoque cadastrado no controle de estoque, e o
-- custo do produto vem do custo médio de lá.
-- Fonte de custo do produto (prioridade): preco_custo (override manual) →
-- custo da ficha (preparado, via ficha_id) → custo médio do item de estoque
-- (industrializado, via item_id). O estoque é o cadastro-mestre; o catálogo é a
-- vitrine que aponta a fonte do custo. on delete set null: apagar o item de
-- estoque não apaga o produto do catálogo, só desfaz o vínculo de custo.
alter table produto
  add column if not exists item_id uuid references item_estoque(id) on delete set null;
