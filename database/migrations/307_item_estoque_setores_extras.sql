-- 307 — Produto do estoque guardado em MAIS DE UM setor (pedido do dono em 07/10/2026: "quando
-- um produto estiver em mais de um local, assim como fornecedor pode escolher mais de um").
--
-- `item_estoque.setor_id` continua sendo o setor PRINCIPAL (é o que o servidor de loja ainda
-- sem esta versão lê e grava). Os demais ficam aqui, como lista de ids de setor em JSON —
-- mesmo formato de `equipamento.setores_atendidos`. É jsonb e não `uuid[]` de propósito: o
-- sync grava todo valor composto como texto JSON, e uma coluna `uuid[]` recusaria esse texto
-- ("malformed array literal") derrubando o lote inteiro do `item_estoque`.
--
-- Padrão '[]': nenhum produto muda. A coluna entra no schema do Drizzle, então a nuvem
-- precisa dela ANTES do merge; no servidor da loja ela vem no próprio pacote de atualização.
-- NÃO é @cloud-only: `item_estoque` existe nos dois bancos e sincroniza nos dois sentidos.
-- Servidor de loja ainda sem a coluna recebe o produto sem ela; a reconciliação do sync a
-- preenche depois da atualização. Idempotente.
set local lock_timeout = '5s';

alter table item_estoque
  add column if not exists setores_extras jsonb not null default '[]'::jsonb;

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'coluna item_estoque.setores_extras' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'item_estoque'
                  and column_name = 'setores_extras'
                  and data_type = 'jsonb' and is_nullable = 'NO') as ok
union all
select 'padrão lista vazia (nenhum produto muda)',
       coalesce((select column_default from information_schema.columns
                  where table_schema = current_schema() and table_name = 'item_estoque'
                    and column_name = 'setores_extras'), '') like '%[]%';
