-- 127_destino_complemento_opcao.sql — destino de produção (KDS/impressora) próprio
-- para COMPLEMENTO (etapa) e OPÇÃO. Por padrão herdam do produto; quando têm destino
-- próprio, ele prevalece. Espelha produto_destino_producao (N:N com equipamento).
-- Idempotente.

create table if not exists complemento_destino_producao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  complemento_id uuid not null references complemento(id) on delete cascade,
  equipamento_id uuid not null references equipamento(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_compl_destino_compl on complemento_destino_producao (complemento_id);

create table if not exists opcao_destino_producao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  opcao_id uuid not null references opcao(id) on delete cascade,
  equipamento_id uuid not null references equipamento(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_opcao_destino_opcao on opcao_destino_producao (opcao_id);
