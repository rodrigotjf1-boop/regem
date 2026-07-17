-- Fase 4 — Produto liga complementos reutilizáveis (etapas), materializados no
-- motor per-product `complemento_grupo`/`complemento_opcao` que o cardápio/comanda/KDS
-- já leem. `origem_complemento_id` marca os grupos gerados por materialização (para
-- regenerar só eles, sem apagar grupos criados à mão no editor antigo).
create table if not exists produto_complemento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null,
  complemento_id uuid not null references complemento(id) on delete cascade,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists produto_complemento_prod_idx on produto_complemento(produto_id);
create index if not exists produto_complemento_comp_idx on produto_complemento(complemento_id);

alter table complemento_grupo add column if not exists origem_complemento_id uuid;
alter table complemento_opcao add column if not exists origem_opcao_id uuid;
