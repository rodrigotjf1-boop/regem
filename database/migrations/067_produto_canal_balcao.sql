-- 067_produto_canal_balcao.sql — canal de venda "balcão/PDV" no produto.
-- Par do disponivel_cardapio (que já existia). Default true = comportamento atual
-- (todos os produtos aparecem no balcão até serem desmarcados).
-- ⚠️ ALTER — rodar no Supabase (apply-sql.mjs) e no local.

alter table produto
  add column if not exists disponivel_balcao boolean not null default true;
