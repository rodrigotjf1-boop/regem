-- 313 — Pedidos de compra: envio ao fornecedor e valores da nota na conferência (pedidos do dono em
-- 10/10/2026, continuação das migs 311 e 312).
--
-- "Opção de enviar ao fornecedor … caso tenha um contato de WhatsApp ou e-mail, enviar o pedido ao
-- responsável"; "no processo de conferência vai atualizando os valores de acordo com a nota de
-- recebimento". Decisões dele: o envio ABRE o WhatsApp ou o e-mail de quem está usando, com o pedido
-- pronto (o sistema não envia sozinho); qualquer conferente informa os valores da nota.
--
-- `compra_lista.enviado_em` / `enviado_canal`: quando e por onde (`whatsapp` | `email`) a pessoa
--   marcou o pedido como enviado ao fornecedor. NULL = não marcado.
-- `compra_lista.nota_ref`: número ou identificação da nota que veio com a entrega (conferência).
-- `compra_item.custo_pedido`: o valor unitário que estava no PEDIDO, guardado quando a conferência
--   informa outro valor pela nota (`custo_unitario` passa a ser o da nota — é ele que entra no custo
--   médio e na conta a pagar). NULL = o valor não mudou na conferência.
--
-- NÃO é @cloud-only: as duas tabelas existem nos dois bancos e já sincronizam (o sync reconcilia
-- coluna nova sozinho a partir da 1.30.0). Colunas sem valor padrão não regravam a tabela. Idempotente.
set local lock_timeout = '5s';

alter table compra_lista add column if not exists enviado_em timestamptz;
alter table compra_lista add column if not exists enviado_canal text;
alter table compra_lista add column if not exists nota_ref text;
alter table compra_item add column if not exists custo_pedido numeric;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'compra_lista.enviado_em (timestamptz, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_lista'
                  and column_name = 'enviado_em' and data_type = 'timestamp with time zone' and is_nullable = 'YES') as ok
union all
select 'compra_lista.enviado_canal (text, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_lista'
                  and column_name = 'enviado_canal' and data_type = 'text' and is_nullable = 'YES')
union all
select 'compra_lista.nota_ref (text, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_lista'
                  and column_name = 'nota_ref' and data_type = 'text' and is_nullable = 'YES')
union all
select 'compra_item.custo_pedido (numeric, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'compra_item'
                  and column_name = 'custo_pedido' and data_type = 'numeric' and is_nullable = 'YES');
