-- 101 — Escala recorrente (calendário): regra de recorrência + overrides por dia.
-- A "regra" guarda o padrão (colaborador, vaga, turno-base, tipo, folgas, período);
-- as alocações geradas apontam para ela (regra_id). Overrides por dia permitem
-- editar horário/pausa de UM dia sem mexer no turno-base (edição "só este dia").

create table if not exists escala_regra (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  etiqueta_id uuid not null references etiqueta(id) on delete cascade,
  turno_id uuid not null references turno(id),
  jornada_tipo text not null,
  folgas_semana jsonb not null default '[]',       -- [0..6] dias de folga (tipos por dia da semana)
  data_inicio date not null,
  data_fim date not null,
  feriados_fechar boolean not null default true,   -- pular feriados (dia_especial) na geração
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_escala_regra_tenant on escala_regra (tenant_id);
create index if not exists idx_escala_regra_colab on escala_regra (colaborador_id);

-- Link da alocação com a regra + overrides de horário/pausa por dia (exceções).
alter table escala_alocacao add column if not exists regra_id uuid;
alter table escala_alocacao add column if not exists hora_inicio_override time;
alter table escala_alocacao add column if not exists hora_fim_override time;
alter table escala_alocacao add column if not exists pausa_inicio_override time;
alter table escala_alocacao add column if not exists pausa_fim_override time;
create index if not exists idx_escala_aloc_regra on escala_alocacao (regra_id);
