-- 312 — Compras: 2ª opção de marca, marca que veio e a lista do que faltou; Contagem: quantidade por
-- marca (pedidos do dono em 09/10/2026, continuação da mig 311).
--
-- "Na hora de realizar o pedido, ter a opção de adicionar opção B do produto … marca [A] (segunda
-- opção caso não tenha: marca [B])"; "tem momentos que o item vem só uma parte, ex.: pedido 10 barras,
-- só chegou 5 — a quantidade faltante estar informada"; "na contagem de estoque, ter o mesmo produto
-- só que de marcas diferentes, ter como registrar". Decisões dele: o que faltou fica informado e a
-- tela oferece gerar uma lista nova só com a falta; a contagem pede a quantidade de cada marca e o
-- estoque continua UM só.
--
-- `compra_item.marca_alternativa`: a 2ª opção de marca do item (texto, como `marca`). NULL = sem.
-- `compra_item.marca_recebida`: a marca que de fato veio, informada na conferência. NULL = não veio
--   ou produto sem marca.
-- `compra_lista.origem_lista_id`: a lista de onde esta nasceu ("gerar lista com o que faltou"). Sem
--   chave estrangeira e sem índice único DE PROPÓSITO: a tabela sincroniza nos dois sentidos — o
--   "uma só por lista" é conferido no serviço, dentro de transação com a lista de origem travada.
-- `contagem_item.por_marca`: quanto foi contado de cada marca (`{"Marca Alfa": 3, "Marca Beta": 2}`);
--   `contado` continua sendo o total do produto, que é o que ajusta o estoque. NULL = não informado.
--
-- NÃO é @cloud-only: as três tabelas existem nos dois bancos e já sincronizam (o sync reconcilia
-- coluna nova sozinho a partir da 1.30.0). Colunas sem valor padrão não regravam a tabela. Idempotente.
set local lock_timeout = '5s';

alter table compra_item add column if not exists marca_alternativa text;
alter table compra_item add column if not exists marca_recebida text;
alter table compra_lista add column if not exists origem_lista_id uuid;
alter table contagem_item add column if not exists por_marca jsonb;

create index if not exists idx_compra_lista_origem on compra_lista (origem_lista_id) where origem_lista_id is not null;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`. O índice é procurado em
-- `pg_class` (e não em `pg_indexes`, que lê a definição de todos os índices do banco — ERR-194).
select 'compra_item.marca_alternativa (text, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_item'
                  and column_name = 'marca_alternativa' and data_type = 'text' and is_nullable = 'YES') as ok
union all
select 'compra_item.marca_recebida (text, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_item'
                  and column_name = 'marca_recebida' and data_type = 'text' and is_nullable = 'YES')
union all
select 'compra_lista.origem_lista_id (uuid, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_lista'
                  and column_name = 'origem_lista_id' and data_type = 'uuid' and is_nullable = 'YES')
union all
select 'contagem_item.por_marca (jsonb, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'contagem_item'
                  and column_name = 'por_marca' and data_type = 'jsonb' and is_nullable = 'YES')
union all
select 'índice idx_compra_lista_origem',
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = current_schema() and c.relname = 'idx_compra_lista_origem' and c.relkind = 'i');
