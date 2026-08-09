-- 178_insumo_setor_fornecedores.sql — cadastro de insumo mais rico:
--  (1) SETOR DE ESTOQUE do insumo (onde ele fica guardado) — reusa a tabela `setor`;
--  (2) MÚLTIPLOS FORNECEDORES por insumo (N:N). `item_estoque.fornecedor_id` continua
--      existindo como fornecedor PRINCIPAL (compat com leituras/compras); a lista
--      completa fica em `item_fornecedor`.
--
-- NÃO é @cloud-only: `item_estoque`/`setor`/`fornecedor` existem no edge; o backend do
-- edge lê essas colunas/tabela.

alter table item_estoque
  add column if not exists setor_id uuid references setor(id) on delete set null;
create index if not exists idx_item_estoque_setor on item_estoque (setor_id);

create table if not exists item_fornecedor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  fornecedor_id uuid not null references fornecedor(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (item_id, fornecedor_id)
);
create index if not exists idx_item_fornecedor_item on item_fornecedor (item_id);

-- Backfill: quem já tinha um fornecedor principal entra na lista N:N.
insert into item_fornecedor (tenant_id, item_id, fornecedor_id)
select tenant_id, id, fornecedor_id from item_estoque
where fornecedor_id is not null and deleted_at is null
on conflict (item_id, fornecedor_id) do nothing;
