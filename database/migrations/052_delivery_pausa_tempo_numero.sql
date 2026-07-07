-- 052 — Delivery: pausa temporizada, faixas de tempo de preparo e nº sequencial

-- Pausa temporária da loja (reativa sozinha quando o tempo passa).
alter table delivery_config add column if not exists pausado_ate timestamptz;
alter table delivery_config add column if not exists pausa_motivo text;

-- Faixas de tempo de preparo/espera (min a max), por tipo — mostradas ao cliente
-- e usadas no contador "Prepare em até".
alter table delivery_config add column if not exists prep_balcao_min integer not null default 15;
alter table delivery_config add column if not exists prep_balcao_max integer not null default 25;
alter table delivery_config add column if not exists prep_delivery_min integer not null default 45;
alter table delivery_config add column if not exists prep_delivery_max integer not null default 55;

-- Nº sequencial do pedido (por dia, fuso SP) — o "#284" do card.
alter table pedido_externo add column if not exists numero integer;
