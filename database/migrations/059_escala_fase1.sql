-- 059_escala_fase1.sql — Escala Fase 1: cor do setor + N:N colaborador↔função.
-- ⚠️ ALTER + nova tabela — rodar no Supabase (apply-sql.mjs) e no local (apply-all-local.mjs).

-- Cor própria do setor (editável por presidente/gerente); usada no cabeçalho da grade.
alter table setor add column if not exists cor text;

-- N:N: um colaborador cobre várias funções; uma função tem 0..N colaboradores.
create table if not exists colaborador_funcao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  funcao_id uuid not null references funcao(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (colaborador_id, funcao_id)
);
create index if not exists idx_colab_funcao_colaborador on colaborador_funcao(colaborador_id);
create index if not exists idx_colab_funcao_funcao on colaborador_funcao(funcao_id);

-- Backfill: a função principal atual (colaborador.funcao_id) vira uma linha na junção.
insert into colaborador_funcao (tenant_id, colaborador_id, funcao_id)
select tenant_id, id, funcao_id
from colaborador
where funcao_id is not null and deleted_at is null
on conflict (colaborador_id, funcao_id) do nothing;
