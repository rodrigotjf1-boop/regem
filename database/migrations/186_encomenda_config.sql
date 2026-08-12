-- 186_encomenda_config.sql
-- Modo Encomenda (marmitaria) — OPT-IN por loja. Quando ligado, o cardápio aceita
-- pedido para uma DATA futura (retirada ou entrega), dentro das regras abaixo.
-- Nasce DESLIGADO: loja que não trabalha com encomenda não é afetada.

alter table cardapio_config
  add column if not exists encomenda_ativa boolean not null default false;
-- Antecedência mínima em horas (ex.: 24 = só a partir de amanhã).
alter table cardapio_config
  add column if not exists encomenda_antecedencia_horas integer not null default 24;
-- Até quantos dias à frente o cliente pode encomendar.
alter table cardapio_config
  add column if not exists encomenda_horizonte_dias integer not null default 30;
-- Horário de corte (opcional): depois dele, a data mínima anda +1 dia.
alter table cardapio_config
  add column if not exists encomenda_corte time;
-- Capacidade máxima de encomendas por data (opcional; null = ilimitado).
alter table cardapio_config
  add column if not exists encomenda_capacidade_dia integer;
