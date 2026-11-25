-- 505_compra_item_fornecedor.sql — P2 de "Pedidos e recebimento" (protótipo aprovado pelo dono em 25/11/2026, PR-4 e PR-5).
--
-- "Uma lista de compras também é um pedido, e no recebimento cada item pode ter vindo de um mercado ou fornecedor diferente."
-- O recebimento punha o pedido inteiro num fornecedor só e numa conta a pagar só. Agora cada linha recebida diz de onde veio
-- (um fornecedor do cadastro — o mercado vira fornecedor, PR-4) e sai uma conta a pagar por fornecedor (PR-5).
--  • compra_item.fornecedor_id — de onde a linha veio; NULL = o fornecedor do pedido (como até hoje).
-- Sem chave estrangeira, como `lote.fornecedor_id`: a linha sincroniza nos dois sentidos e o fornecedor pode chegar depois.
-- A tabela sincroniza com o servidor da loja (cursor `updated_at`, colunas que os dois lados têm): vai no `.zip`.
-- Aditiva e idempotente. Sem `drop`.

alter table compra_item add column if not exists fornecedor_id uuid;

-- Conferência (no mesmo Run): a coluna existe.
select c.table_name, c.column_name, c.data_type
  from information_schema.columns c
 where c.table_schema = current_schema() and c.table_name = 'compra_item' and c.column_name = 'fornecedor_id';
