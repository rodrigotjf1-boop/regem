-- @cloud-only
-- 195_campanhas.sql — Campanhas de WhatsApp por segmento (F5). USO INTERNO do
-- lojista (métricas/ações); só na nuvem (o edge não dispara campanhas). Escopo
-- sempre por tenant. Idempotente. Rodar no Supabase (apply-sql.mjs).

create table if not exists campanha (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  criado_por uuid,
  segmento text not null,
  mensagem text not null,
  intervalo_seg integer not null default 7,   -- pausa entre envios (anti-ban)
  teto_dia integer,                            -- limite de envios/dia (null = sem teto)
  total integer not null default 0,
  enviados integer not null default 0,
  falhas integer not null default 0,
  status text not null default 'enviando',     -- enviando | concluida | pausada
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists campanha_envio (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references campanha(id) on delete cascade,
  tenant_id uuid not null,
  cliente_id uuid,
  telefone text not null,
  status text not null default 'pendente',      -- pendente | enviado | falha | pulado
  erro text,
  enviado_em timestamptz
);

create index if not exists idx_campanha_tenant on campanha (tenant_id);
create index if not exists idx_campanha_envio_pend on campanha_envio (campanha_id) where status = 'pendente';
