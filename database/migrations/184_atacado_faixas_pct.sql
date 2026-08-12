-- 184_atacado_faixas_pct.sql
-- Atacado por volume (Fase A): faixas de % de desconto progressivo por quantidade.
-- Reaproveita a tabela produto_faixa_preco (Fase L1, mig 042), que guardava
-- preço/un fixo e nunca foi aplicada na venda. Agora o eixo é PERCENTUAL:
-- "a partir de N unidades → -X%", aplicado na maior faixa qtd_min <= quantidade.
-- Um toggle no produto liga/desliga o atacado sem apagar as faixas cadastradas.

-- Liga/desliga o preço de atacado por produto (mantém as faixas guardadas).
alter table produto
  add column if not exists atacado_ativo boolean not null default false;

-- % de desconto da faixa (0–100). Coexiste com a coluna `preco` legada (mig 042),
-- que deixa de ser usada no modo percentual.
alter table produto_faixa_preco
  add column if not exists desconto_pct numeric;
