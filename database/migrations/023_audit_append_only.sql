-- 023_audit_append_only.sql — Hardening P5: audit_log IMUTÁVEL no banco.
-- Trigger aborta qualquer UPDATE/DELETE em audit_log (append-only real, mesmo que
-- o role da aplicação tenha permissão). Escolhi trigger em vez de REVOKE por ser
-- portável e independente do nome do role do Supabase.
-- ⚠️ CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs).

create or replace function audit_log_imutavel() returns trigger as $$
begin
  raise exception 'audit_log é append-only: operação % não permitida', TG_OP;
end;
$$ language plpgsql;

drop trigger if exists trg_audit_log_imutavel on audit_log;
create trigger trg_audit_log_imutavel
  before update or delete on audit_log
  for each row execute function audit_log_imutavel();
