-- 104 — Janela de pico por INTERVALO de dias da semana.
-- `dia_semana` = início; `dia_semana_fim` = fim (inclusive). Ambos preenchidos =
-- intervalo (ex.: seg→sex, ou sex→seg com "volta" na semana). null/null = todos os
-- dias; só `dia_semana` = um dia específico (comportamento antigo preservado).

alter table janela_pico add column if not exists dia_semana_fim integer;
