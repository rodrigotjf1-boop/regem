-- 011_janela_pico.sql — Ajusta a janela_pico já existente (criada na fundação) para a Fase B.
-- A tabela já tinha: id, tenant_id, unidade_id, setor_id, dia_semana(NOT NULL),
-- hora_inicio, hora_fim, intensidade, timestamps, deleted_at — mas SEM `nome`.
-- Aditivo/não-destrutivo (create table if not exists era no-op sobre a tabela pré-existente).

create table if not exists janela_pico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  nome text,
  dia_semana int,               -- 0=domingo .. 6=sábado; null = todos os dias
  hora_inicio time not null,
  hora_fim time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Reconciliação com a tabela pré-existente:
alter table janela_pico add column if not exists nome text;   -- rótulo (ex.: "Almoço")
alter table janela_pico alter column dia_semana drop not null; -- null = todos os dias

create index if not exists idx_janela_pico_unidade on janela_pico (unidade_id);
create index if not exists idx_janela_pico_tenant on janela_pico (tenant_id);
