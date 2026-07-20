-- 128_cancelamento_estoque_reuso.sql — no cancelamento de pedido JÁ PRODUZIDO, o
-- insumo baixado pode ter virado PERDA (desperdício) ou ter sido REUTILIZADO
-- (estorna a baixa). Guardamos a decisão para relatório e para o aviso ao cliente.
-- null = não se aplica (pedido não chegou a baixar estoque). Idempotente.

alter table pedido_externo add column if not exists estoque_reaproveitado boolean;
alter table comanda add column if not exists estoque_reaproveitado boolean;
