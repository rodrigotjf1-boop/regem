-- 060_escala_jornada.sql — Escala Fase 4A: tipo de jornada + pausa do turno.
-- ⚠️ ALTER — rodar no Supabase (apply-sql.mjs) e no local (apply-all-local.mjs).

-- Tipo de escala/jornada do colaborador (mescláveis: cada um com o seu).
alter table colaborador
  add column if not exists jornada_tipo text not null default 'outro';

-- Pausa (intervalo intrajornada) do turno — usada na timeline e na validação CLT.
alter table turno add column if not exists pausa_inicio time;
alter table turno add column if not exists pausa_fim time;
