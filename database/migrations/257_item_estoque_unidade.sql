-- 257_item_estoque_unidade.sql — Custo médio, estoque mínimo e dias de segurança POR LOJA.
--
-- ⚠️ NÃO é @cloud-only: o recebimento e a produção gravam custo no servidor local e a tabela
-- sincroniza nos dois sentidos. Aplicar na nuvem E no edge.
-- ⚠️ Aplicar ANTES do merge. A 258 (valores iniciais) vem logo depois, também antes do merge.
--
-- POR QUÊ — estoque por loja, fase B2 (separação total por loja, decisão do dono)
-- Depois das fases A e B1, o SALDO já é de cada loja. Mas `custo_medio`, `estoque_minimo` e
-- `dias_seguranca` continuam no cadastro do insumo (`item_estoque`), um valor só para as duas
-- lojas: a compra cara da loja A mexia no custo da loja B, e o mínimo de uma loja grande
-- valia para a pequena. O cadastro continua compartilhado; esses três valores passam a ser
-- da loja.
--
-- COMO SE LÊ
-- Valor da loja quando existe a linha; senão, o do cadastro (`item_estoque`). Coluna nula
-- = "usa o do cadastro" — assim gravar só o mínimo de uma loja não obriga a inventar custo.
-- Empresa de UMA loja não usa esta tabela: continua gravando e lendo `item_estoque`.
--
-- O ID É DETERMINÍSTICO (md5 de insumo + loja)
-- A linha pode nascer ao mesmo tempo no servidor local e na nuvem (recebimento num, ajuste
-- de mínimo no outro). O sync casa linhas por `id`; com id aleatório seriam duas linhas para
-- o mesmo par e a segunda bateria no índice único (23505) e ficaria presa. Com o id derivado
-- do par, as duas pontas geram o MESMO id e o sync resolve por última escrita. O código usa a
-- mesma expressão (`md5(item_id::text || unidade_id::text)::uuid`).

create table if not exists item_estoque_unidade (
  id uuid primary key,
  tenant_id uuid not null references empresa(id) on delete cascade,
  item_id uuid not null references item_estoque(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  custo_medio numeric,
  estoque_minimo numeric,
  dias_seguranca integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_item_estoque_unidade_par
  on item_estoque_unidade (item_id, unidade_id);

create index if not exists idx_item_estoque_unidade_tenant
  on item_estoque_unidade (tenant_id, updated_at);
