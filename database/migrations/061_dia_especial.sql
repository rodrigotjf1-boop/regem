-- 061_dia_especial.sql — Escala Fase 4B: dias importantes (feriado/férias/evento).
-- ⚠️ Nova tabela — rodar no Supabase (apply-sql.mjs) e no local (apply-all-local.mjs).

create table if not exists dia_especial (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete cascade,     -- null = toda a rede
  colaborador_id uuid references colaborador(id) on delete cascade, -- p/ férias de 1 pessoa
  data date not null,
  data_fim date,                                                -- null = 1 dia; senão período
  tipo text not null default 'evento',                          -- feriado|ferias|evento|folga|outro
  nome text not null,
  descricao text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_dia_especial_tenant_data on dia_especial(tenant_id, data);
