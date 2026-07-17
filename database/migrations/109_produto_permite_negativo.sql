-- 109_produto_permite_negativo.sql
-- "Reativar sem estoque": o gestor despausa um produto esgotado sem dar entrada.
-- `permite_negativo` desliga o BLOQUEIO por estoque (não pausa/esgota mais), mas a
-- baixa continua (controla_estoque segue true) → o saldo do insumo fica NEGATIVO
-- (contagem negativa, só informativa). Volta ao normal quando o gestor desmarca.

alter table produto
  add column if not exists permite_negativo boolean not null default false;
