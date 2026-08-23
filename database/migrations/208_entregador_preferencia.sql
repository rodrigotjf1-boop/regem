-- @cloud-only
-- 208_entregador_preferencia.sql — Fase 4 do app do entregador (cloud-only).
-- Preferência do PRÓPRIO entregador: compartilhar (ou não) o seu nome/contato junto
-- com o aviso de chegada enviado ao cliente pelo n8n. Opt-in — default NÃO compartilha
-- (privacidade do entregador). Ele liga no app quando quiser facilitar a comunicação.
-- Aditiva e idempotente.

create table if not exists entregador_preferencia (
  colaborador_id      uuid primary key,
  tenant_id           uuid not null,
  compartilha_contato boolean not null default false,
  atualizado_em       timestamptz not null default now()
);

create index if not exists ix_entregador_preferencia_tenant
  on entregador_preferencia (tenant_id);
