-- @cloud-only
-- 199_entregador_dispositivo.sql — App do Entregador (E0): token de push (FCM) do
-- aparelho. Só na nuvem. Escopo por tenant + colaborador. Idempotente.

create table if not exists entregador_dispositivo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  colaborador_id uuid not null,
  fcm_token text not null,
  plataforma text,                              -- android | ios
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (colaborador_id, fcm_token)
);

create index if not exists idx_entregador_disp_colab on entregador_dispositivo (tenant_id, colaborador_id);
