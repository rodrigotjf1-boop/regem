-- 173_pix_gateway_prioritario.sql
-- Coluna em cardapio_config (tabela que EXISTE no edge) — precisa rodar no edge
-- também, senão o select do drizzle quebra ("column does not exist"). Aditiva e
-- idempotente. (Não marcar como cloud-only.)
-- PIX com DOIS gateways (Mercado Pago + PagBank) ao mesmo tempo: define qual é o
-- PRIMÁRIO; o outro entra como fallback quando o primário falha ao gerar o QR.
-- NULL = mercadopago (incumbente).

alter table cardapio_config
  add column if not exists pix_gateway_prioritario text; -- 'mercadopago' | 'pagseguro' | null
