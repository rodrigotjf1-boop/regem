-- 163 — Corrige o alvo da coluna cupom_perfis.
-- A migration 161 original criou cupom_perfis em cardapio_config (tabela errada). O código
-- (deliveryConfig/configRaw) lê de delivery_config, então /delivery caía com 500
-- "column cupom_perfis does not exist". Esta migration é idempotente e segura em qualquer
-- ambiente: garante a coluna na tabela certa e remove a criada por engano.
alter table delivery_config add column if not exists cupom_perfis jsonb not null default '{}'::jsonb;
alter table cardapio_config drop column if exists cupom_perfis;
