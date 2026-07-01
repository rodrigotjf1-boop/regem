-- 004_auth.sql
-- Credenciais de acesso gerencial do colaborador (login por e-mail/senha).
-- O pin_hash (login rápido em terminal) já existe desde a Fase 0.

alter table colaborador add column if not exists email      text;
alter table colaborador add column if not exists senha_hash text;

create unique index if not exists uq_colaborador_email
  on colaborador (email) where email is not null;
