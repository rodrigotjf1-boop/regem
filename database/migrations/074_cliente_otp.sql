-- 074_cliente_otp.sql — OTP (código por WhatsApp) para confirmar o telefone do
-- cliente do cardápio no cadastro/entrar. O Regem gera o código e dispara um
-- webhook do n8n (env OTP_WEBHOOK_URL) que envia pelo Evolution. Idempotente.

create table if not exists cliente_otp (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  telefone text not null,
  codigo text not null,
  expira_em timestamptz not null,
  tentativas integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists idx_cliente_otp_tel on cliente_otp (tenant_id, telefone);
