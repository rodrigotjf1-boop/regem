-- 504_validade_obrigatoria.sql — P1 de "Pedidos e recebimento" (protótipo aprovado pelo dono em 25/11/2026).
--
-- O recebimento do pedido exigia a validade de TODA linha recebida (a data ou "sem validade") e travava quem não sabia.
-- Agora a data só é obrigatória no produto MARCADO (os de pouca validade); quem recebe e não sabe marca "Não sei": o item
-- entra no estoque e a validade fica PENDENTE até alguém informar.
--  • item_estoque.validade_obrigatoria — a marca no produto (Estoque › Produtos), nasce desligada em todos (PR-3);
--  • compra_item.validade_pendente     — a linha recebida com "Não sei" (Estoque › Pedidos › Validade pendente);
--  • lote.validade_pendente            — o lote dessa linha, que recebe a data quando alguém informa.
-- As três tabelas sincronizam com o servidor da loja (cursor `updated_at`, colunas que os dois lados têm): vai no `.zip`.
-- Aditiva e idempotente. Sem `drop`.

alter table item_estoque add column if not exists validade_obrigatoria boolean not null default false;
alter table compra_item add column if not exists validade_pendente boolean not null default false;
alter table lote add column if not exists validade_pendente boolean not null default false;

-- A lista "Validade pendente" e o aviso do dia procuram só as linhas pendentes (poucas): índice parcial.
create index if not exists idx_compra_item_validade_pendente on compra_item (tenant_id, lista_id) where validade_pendente;

-- Conferência (no mesmo Run): as três colunas existem.
select c.table_name, c.column_name, c.data_type, c.column_default
  from information_schema.columns c
 where c.table_schema = current_schema()
   and ((c.table_name = 'item_estoque' and c.column_name = 'validade_obrigatoria')
     or (c.table_name = 'compra_item' and c.column_name = 'validade_pendente')
     or (c.table_name = 'lote' and c.column_name = 'validade_pendente'))
 order by c.table_name;
