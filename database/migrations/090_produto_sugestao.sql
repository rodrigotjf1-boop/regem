-- "Peça também" (Etapa 5): sugestões vinculadas ao produto (cadastro do lojista).
-- Prioridade sobre a sugestão automática (mais vendidos) do cardápio público.
create table if not exists produto_sugestao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null references produto(id) on delete cascade,   -- o gatilho
  sugerido_id uuid not null references produto(id) on delete cascade,  -- o sugerido
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists produto_sugestao_produto_idx on produto_sugestao (produto_id);
create unique index if not exists produto_sugestao_uniq on produto_sugestao (produto_id, sugerido_id);
