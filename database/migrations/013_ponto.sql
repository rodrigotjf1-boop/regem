-- 013_ponto.sql — Fase D: registro de ponto (gestão de jornada, lógica da Portaria 671).
-- Append-only e imutável (sem update/delete/soft-delete). NSR sequencial por tenant.
-- ⚠️ NÃO é ponto oficial homologado (AFD/AEJ + certificação REP-P = backlog premium).
-- CREATE limpo — nenhuma tabela de ponto existia na fundação.

create table if not exists ponto_marcacao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  nsr bigint not null,                 -- Número Sequencial de Registro (por tenant)
  tipo text not null,                  -- entrada|saida|intervalo_inicio|intervalo_fim
  marcado_em timestamptz not null default now(),
  origem text not null default 'web',  -- web|terminal|app
  registrado_por_id uuid references colaborador(id),  -- operador (terminal/gerente), se houver
  hash text,                           -- assinatura leve do registro (inviolabilidade)
  obs text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ponto_nsr on ponto_marcacao (tenant_id, nsr);
create index if not exists idx_ponto_colab_dia on ponto_marcacao (colaborador_id, marcado_em);
create index if not exists idx_ponto_tenant_dia on ponto_marcacao (tenant_id, marcado_em);
