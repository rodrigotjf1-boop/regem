-- 169_producao_adiar_kds.sql
-- Fase 6 — KDS na cadeia: opção de ADIAR a impressão da via de produção até o
-- pedido avançar no KDS que "arma" a impressão (imprime_ao_avancar), em vez de
-- imprimir de imediato no registro. Config por unidade em delivery_config.
-- Só tem efeito quando existe um KDS com impressão na etapa ligada (senão a via
-- sai no registro normalmente, para não perder o ticket).
-- Aditiva e idempotente. NÃO é @cloud-only.

alter table delivery_config
  add column if not exists adiar_producao_ate_kds boolean not null default false;
