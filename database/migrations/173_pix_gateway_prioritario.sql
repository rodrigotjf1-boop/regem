-- 173_pix_gateway_prioritario.sql
-- @cloud-only
-- PIX com DOIS gateways (Mercado Pago + PagBank) ao mesmo tempo: define qual é o
-- PRIMÁRIO; o outro entra como fallback quando o primário falha ao gerar o QR.
-- NULL = mercadopago (incumbente). Aditiva e idempotente.

alter table cardapio_config
  add column if not exists pix_gateway_prioritario text; -- 'mercadopago' | 'pagseguro' | null
