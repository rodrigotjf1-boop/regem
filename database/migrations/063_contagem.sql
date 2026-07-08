-- 063_contagem.sql — Estoque E2: contagem de estoque (listas + execução).
-- ⚠️ Novas tabelas — rodar no Supabase (apply-sql.mjs) e no local.

-- Lista de contagem: nome, produtos (join), recorrência, horário de alerta,
-- delegação e para onde avisar (KDS / dashboard do gerente).
create table if not exists contagem_lista (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id) on delete cascade,
  nome text not null,
  recorrencia text not null default 'semanal',   -- diaria|semanal|mensal|avulsa
  dia_semana integer,                            -- 0=dom..6=sab (semanal)
  dia_mes integer,                               -- 1..31 (mensal)
  hora time,                                     -- horário do alerta
  delegado_id uuid references colaborador(id) on delete set null,
  enviar_kds boolean not null default true,
  enviar_dashboard boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_contagem_lista_tenant on contagem_lista(tenant_id);

create table if not exists contagem_lista_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  lista_id uuid not null references contagem_lista(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  unique (lista_id, item_id)
);
create index if not exists idx_contagem_lista_item_lista on contagem_lista_item(lista_id);

-- Execução de uma contagem (snapshot do saldo → contado → diferença).
create table if not exists contagem_execucao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  lista_id uuid not null references contagem_lista(id) on delete cascade,
  data date not null default current_date,
  status text not null default 'aberta',         -- aberta|concluida
  delegado_id uuid references colaborador(id) on delete set null,
  criada_por_id uuid references colaborador(id) on delete set null,
  concluida_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_contagem_exec_lista on contagem_execucao(lista_id);

create table if not exists contagem_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  execucao_id uuid not null references contagem_execucao(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  saldo_sistema numeric not null default 0,
  contado numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_contagem_item_exec on contagem_item(execucao_id);
