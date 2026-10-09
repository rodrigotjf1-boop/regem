-- 311 — Produto do estoque: NOME COMERCIAL e MARCAS (decisão do dono em 09/10/2026).
--
-- "Nome do produto: carne 56 g [esse nome entra nas fichas técnicas]; nome fantasia: Caixa de
-- hambúrguer [esse nome entra na lista de compras e pedidos]" e "cada produto pode ter mais
-- de uma marca … quando fazemos uma lista de compras, se tiver mais de uma marca cadastrada, o
-- responsável por criar a lista escolhe a marca, porém faz um estoque só".
--
-- `item_estoque.nome_comercial`: como o produto é COMPRADO. NULL = usa o nome do produto. O `nome`
--   continua sendo o da ficha técnica, da contagem, das validades e dos relatórios.
-- `item_estoque.marcas`: lista de nomes de marca do produto (`["Marca Alfa","Marca Beta"]`). Mesma
--   forma de `setores_extras` (mig 307): coluna no próprio produto, sem tabela nova — o estoque, o
--   custo médio e a baixa continuam UM só, a marca não os divide.
-- `compra_item.marca`: a marca escolhida para aquele item da lista de compras (texto, como estava
--   no momento da compra — o pedido não muda se a marca for renomeada depois). NULL = sem marca.
--
-- NÃO é @cloud-only: as duas tabelas existem nos dois bancos e sincronizam nos dois sentidos (o
-- sync reconcilia coluna nova sozinho a partir da 1.30.0). Colunas sem valor padrão ou com padrão
-- constante não regravam a tabela. Idempotente.
set local lock_timeout = '5s';

alter table item_estoque add column if not exists nome_comercial text;
alter table item_estoque add column if not exists marcas jsonb not null default '[]'::jsonb;
alter table compra_item add column if not exists marca text;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'item_estoque.nome_comercial (text, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'item_estoque'
                  and column_name = 'nome_comercial' and data_type = 'text' and is_nullable = 'YES') as ok
union all
select 'item_estoque.marcas (jsonb, obrigatória, padrão [])',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'item_estoque'
                  and column_name = 'marcas' and data_type = 'jsonb' and is_nullable = 'NO'
                  and column_default = '''[]''::jsonb')
union all
select 'compra_item.marca (text, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_item'
                  and column_name = 'marca' and data_type = 'text' and is_nullable = 'YES');
