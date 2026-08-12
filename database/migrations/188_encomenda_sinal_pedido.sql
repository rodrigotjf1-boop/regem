-- 188_encomenda_sinal_pedido.sql
-- Sinal por pedido de encomenda (S2). O sinal é cobrado online (PIX) reaproveitando
-- gateway_payment_id/gateway_provider já existentes; estas colunas guardam o valor,
-- o % aplicado, o estado do sinal e o prazo de cancelamento com reembolso.

alter table pedido_externo add column if not exists sinal_pct numeric;      -- % aplicado
alter table pedido_externo add column if not exists sinal_valor numeric;    -- valor do sinal (R$)
-- null/'nao' = sem sinal · pendente · pago · reembolsado · perdido
alter table pedido_externo add column if not exists sinal_status text;
alter table pedido_externo add column if not exists cancelavel_ate timestamptz; -- limite p/ cancelar com reembolso
