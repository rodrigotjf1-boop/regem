-- 058 — Chamados de atendimento (handoff do robô → humano)
-- Quando o cliente precisa de gente (mudança no pedido, erro no recebimento,
-- "falar com humano"), o robô abre um chamado que aparece no app em tempo real.

create table if not exists atendimento_chamado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  tipo text not null default 'humano',        -- mudanca | erro | humano | outro
  cliente text,
  telefone text,
  pedido_numero text,                          -- o "#8" que o cliente citou (livre)
  mensagem text,
  status text not null default 'aberto',       -- aberto | resolvido
  resolvido_por_id uuid,
  resolvido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists idx_atendimento_tenant_status on atendimento_chamado(tenant_id, status);
