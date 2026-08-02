-- 162 — QR do entregador (Fase 4 do construtor de cupons). Token curto por pedido:
-- o cupom do entregador leva um QR com {base}/e/{token}; ao escanear, o entregador
-- se identifica e o pedido avança para "despachado/em rota" atrelado a ele.
alter table pedido_externo add column if not exists despacho_token text;
create unique index if not exists uq_pedido_externo_despacho_token
  on pedido_externo (despacho_token) where despacho_token is not null;
