-- 106_pedido_gateway_pix.sql
-- Pagamento online real (Mercado Pago / PIX): correlaciona o pagamento do gateway
-- com o pedido para o webhook confirmar. O token de acesso do MP fica na tabela
-- `integracao` (canal='mercadopago', coluna token) — sem migration de coluna nova.

alter table pedido_externo
  add column if not exists gateway_payment_id text;

create index if not exists idx_pedido_gateway on pedido_externo (gateway_payment_id);
