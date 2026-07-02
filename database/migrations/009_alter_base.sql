-- 009_alter_base.sql — Ajustes de base (Fase A). Aditivo e não-destrutivo.
-- Colaborador: matrícula + consentimento LGPD (fotos de ponto/vistoria/desperdício).
alter table colaborador add column if not exists matricula text;
alter table colaborador add column if not exists consentimento_lgpd boolean not null default false;
alter table colaborador add column if not exists data_consentimento date;

-- Turno: modelo de escala, tipo e intervalo previsto (contrato §4.2).
alter table turno add column if not exists modelo text;             -- 6x1 | 5x2 | 12x36 | 4x3 | horista | diarista | pj | autonomo
alter table turno add column if not exists tipo text not null default 'regular'; -- regular | plantao_12x36 | diaria | pj | folga | descoberto
alter table turno add column if not exists intervalo_previsto time;
