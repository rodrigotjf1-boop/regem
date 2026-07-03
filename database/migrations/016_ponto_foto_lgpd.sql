-- 016_ponto_foto_lgpd.sql — foto na marcação de ponto com tratamento LGPD.
-- CLAUDE.md/671: foto opcional com CONSENTIMENTO explícito + DATA DE EXPURGO
-- (retenção). Sem consentimento, a foto não é gravada. Append-only preservado.
-- ⚠️ ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.

alter table ponto_marcacao
  add column if not exists foto_ref text,
  add column if not exists consentimento_lgpd boolean not null default false,
  add column if not exists data_expurgo date;

-- Consulta da rotina de expurgo (fotos vencidas): where data_expurgo < current_date and foto_ref is not null.
create index if not exists idx_ponto_expurgo on ponto_marcacao (data_expurgo)
  where foto_ref is not null;
