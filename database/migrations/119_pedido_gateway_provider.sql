-- PIX online multi-gateway: guarda qual provedor gerou a cobrança do pedido, para
-- o webhook saber qual API consultar (Iugu x Mercado Pago). Aditivo. Reaproveita a
-- tabela `integracao` (canal 'iugu'/'mercadopago'); sem tabela nova.
alter table pedido_externo add column if not exists gateway_provider text; -- 'iugu' | 'mercadopago' | null
