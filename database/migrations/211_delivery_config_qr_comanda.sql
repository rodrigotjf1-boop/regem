-- 211_delivery_config_qr_comanda.sql — toggle "Imprimir QR na comanda" (delivery).
-- NÃO cloud-only: o edge lê delivery_config para montar a via do caixa LOCALMENTE, então
-- a coluna precisa existir no edge (o .exe/.zip embute esta migration) e na nuvem.
-- Ligado por padrão: a 1ª via do caixa do pedido EXTERNO já sai com o QR de despacho
-- ({base}/e/{token}) — o entregador escaneia direto da comanda, sem o cupom do entregador
-- separado. A loja pode desmarcar. Aditiva e idempotente.

alter table delivery_config
  add column if not exists imprimir_qr_comanda boolean not null default true;
