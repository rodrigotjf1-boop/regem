-- 260_produto_pausa_estoque_por_loja.sql — A pausa por falta de estoque passa a ser POR LOJA.
--
-- ⚠️ NÃO é @cloud-only: o cardápio e o PDV do servidor local leem a pausa, e quem calcula a
-- pausa da loja é o servidor local dela. A tabela sincroniza nos dois sentidos.
-- ⚠️ Aplicar ANTES do merge (tabela nova lida pelo código). A 261 (estado inicial) logo depois.
--
-- POR QUÊ — decisão do dono (17/09/2026): "a pausa por falta em estoque é só por unidade".
-- A pausa era UM campo no produto (`produto.pausado_estoque`), calculado pelo saldo SOMADO da
-- empresa. Com o estoque separado por loja (migs 253–258), faltar farinha na loja B pausava o
-- produto também na A — ou, com a A abastecida, a B seguia vendendo sem insumo.
--
-- A TABELA
-- Uma linha por (produto, loja): `pausado` diz se o produto está esgotado NAQUELA loja.
--  • id determinístico `md5(produto_id || unidade_id)::uuid` — servidor local e nuvem geram a
--    mesma linha para o mesmo par e o sync resolve por última escrita (mesma regra da 257);
--  • nunca se apaga a linha: despausar grava `pausado = false` (exclusão física não sincroniza).
--
-- `produto.pausado_estoque` continua existindo e passa a significar "pausado em TODAS as lojas"
-- — é o que lê quem ainda não conhece a loja (servidor local antigo, até o `.zip`) e o que vale
-- para empresa sem loja cadastrada. Errar para "todas" evita bloquear a venda de uma loja
-- abastecida só porque a outra está sem.

create table if not exists produto_pausa_estoque (
  id uuid primary key,
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null references produto(id) on delete cascade,
  unidade_id uuid not null references unidade(id) on delete cascade,
  pausado boolean not null default false,
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_produto_pausa_estoque_par
  on produto_pausa_estoque (produto_id, unidade_id);

create index if not exists idx_produto_pausa_estoque_sync
  on produto_pausa_estoque (tenant_id, updated_at, id);

-- Mudança de estado propaga pelo sync (mesmo gatilho das demais tabelas sincronizadas).
drop trigger if exists trg_bump_updated_at on produto_pausa_estoque;
create trigger trg_bump_updated_at before update on produto_pausa_estoque
  for each row execute function bump_updated_at();
