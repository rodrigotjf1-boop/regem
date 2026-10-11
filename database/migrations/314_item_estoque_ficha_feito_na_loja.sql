-- 314 — Produto do estoque FEITO NA LOJA: a ligação com a ficha técnica que o produz (pedido do dono
-- em 10/10/2026).
--
-- "Adicionar uma opção de ligar um produto ou insumo a uma ficha técnica … a cebola crispy é algo
-- produzido na própria loja, tem sua ficha técnica de custo, e é um insumo para produzir o sanduíche …
-- então esse insumo que tem uma ficha técnica por ser produzido na loja vai participar da ficha
-- técnica do produto." Decisão dele: a venda continua baixando o PRODUTO PRONTO (como qualquer
-- insumo) e o pedido de produção repõe o saldo — a ligação serve ao CUSTO e ao cadastro.
--
-- `item_estoque.ficha_id`: a ficha que produz este produto. NULL = produto comprado (como hoje).
--   Com a ligação, o custo deste produto dentro das OUTRAS fichas vem da ficha dele (custo total ÷
--   rendimento), sempre atualizado — sem ela o produto feito na loja entrava com custo zero até
--   alguém lançar uma produção. A ficha tem de render na unidade do produto (conferido no serviço).
--   Sem chave estrangeira DE PROPÓSITO: as duas tabelas sincronizam nos dois sentidos e a ordem de
--   chegada não é garantida; ficha excluída = sem ligação (as leituras só consideram ficha viva).
--
-- NÃO é @cloud-only: a tabela existe nos dois bancos e já sincroniza (o sync reconcilia coluna nova
-- sozinho a partir da 1.30.0). Coluna sem valor padrão não regrava a tabela. Idempotente.
set local lock_timeout = '5s';

alter table item_estoque add column if not exists ficha_id uuid;

create index if not exists idx_item_estoque_ficha on item_estoque (ficha_id) where ficha_id is not null;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`. O índice é procurado em
-- `pg_class` (e não em `pg_indexes`, que lê a definição de todos os índices do banco — ERR-194).
select 'item_estoque.ficha_id (uuid, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'item_estoque'
                  and column_name = 'ficha_id' and data_type = 'uuid' and is_nullable = 'YES') as ok
union all
select 'índice idx_item_estoque_ficha',
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = current_schema() and c.relname = 'idx_item_estoque_ficha' and c.relkind = 'i');
