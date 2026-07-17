-- 108_produto_pausa_esgotado.sql
-- Gestão do cardápio: pausa por esgotamento de estoque. `pausado_estoque` marca o
-- produto que foi AUTO-pausado por falta de insumo (distinto da pausa manual
-- `disponivel_cardapio`). `pausa_motivo` guarda o porquê (aparece no aviso geral).
-- A auto-pausa é configurável em entitlement (`cardapio_auto_pausa`), sem coluna nova.

alter table produto
  add column if not exists pausado_estoque boolean not null default false,
  add column if not exists pausa_motivo text;
