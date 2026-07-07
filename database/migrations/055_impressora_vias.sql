-- 055 — Impressoras: número de vias de impressão por equipamento

alter table equipamento add column if not exists vias integer not null default 1;
