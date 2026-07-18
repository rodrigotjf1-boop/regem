-- P3 completo — catálogo 100% bidirecional (edge <-> nuvem, modo híbrido).
-- Para o sync `ambos` (LWW por updated_at + exclusão por deleted_at), as tabelas do
-- catálogo precisam de `updated_at` (delta/LWW) e `deleted_at` (soft-delete propaga).
-- Aditivo. (produto/cardapio_config já eram bidirecionais; complemento_grupo/opcao
-- já ganharam deleted_at na mig 117 — aqui completam com updated_at.)

-- Categoria
alter table categoria_produto add column if not exists updated_at timestamptz not null default now();
alter table categoria_produto add column if not exists deleted_at timestamptz;

-- Opção / Complemento (reutilizáveis) — já têm updated_at; faltava deleted_at
alter table opcao add column if not exists deleted_at timestamptz;
alter table complemento add column if not exists deleted_at timestamptz;

-- Ligações (recriadas em edição) — precisam de updated_at + deleted_at
alter table complemento_item add column if not exists updated_at timestamptz not null default now();
alter table complemento_item add column if not exists deleted_at timestamptz;
alter table produto_complemento add column if not exists updated_at timestamptz not null default now();
alter table produto_complemento add column if not exists deleted_at timestamptz;

-- Materializadas — updated_at para o push por delta/LWW (deleted_at veio na mig 117)
alter table complemento_grupo add column if not exists updated_at timestamptz not null default now();
alter table complemento_opcao add column if not exists updated_at timestamptz not null default now();
