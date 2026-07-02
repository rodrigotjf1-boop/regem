-- 011_janela_pico.sql — Janelas de pico por unidade (almoço, jantar, etc.). Fase B.
-- MVP: por unidade + dia-da-semana (override por setor e intensidade = pós-MVP).
-- Alimenta a linha do tempo operacional e a política "proibida no pico" das tarefas.

create table if not exists janela_pico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  nome text not null,
  dia_semana int,               -- 0=domingo .. 6=sábado; null = todos os dias
  hora_inicio time not null,
  hora_fim time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_janela_pico_unidade on janela_pico (unidade_id);
create index if not exists idx_janela_pico_tenant on janela_pico (tenant_id);
