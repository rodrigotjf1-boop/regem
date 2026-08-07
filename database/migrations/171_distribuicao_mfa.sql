-- 171_distribuicao_mfa.sql
-- @cloud-only
-- Fase 9.5 — MFA (TOTP) no login da distribuição. Como o técnico passa a "entrar"
-- em lojas (impersonação), o login da distribuição exige 2º fator. Aditiva.

alter table usuario_distribuicao add column if not exists totp_secret text;
alter table usuario_distribuicao add column if not exists totp_ativo boolean not null default false;
