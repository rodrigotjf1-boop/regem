-- 197_cardapio_marketing_instancia.sql — 2º WhatsApp (número de marketing) para
-- campanhas (F5b): isola o risco de ban do número principal (bot/pedidos).
-- Coluna na cardapio_config — roda na nuvem E no edge (o edge ignora; só a nuvem
-- dispara campanhas). Idempotente. NÃO @cloud-only (cardapio_config existe nos dois).

alter table cardapio_config add column if not exists marketing_instancia text;
