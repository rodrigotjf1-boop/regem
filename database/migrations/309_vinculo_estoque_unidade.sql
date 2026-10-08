-- 309 — Ligação DIRETA ao produto do estoque com a unidade escolhida (decisão do dono em
-- 08/10/2026: "no caso da ligação de um produto que está como um fardo porém tem cadastro de
-- conversão, na hora de ligar é só perguntar se vai calcular valor unitário ou do fardo").
--
-- Dois lugares ligam direto a um produto do estoque, sem ficha técnica:
--   • o produto de REVENDA do catálogo (`produto.item_id`): baixava sempre 1 unidade do estoque
--     por unidade vendida — a lata vendida de um refrigerante guardado em fardo baixava 1 fardo;
--   • o ADICIONAL do tipo insumo (`opcao.item_id`): baixava sempre 1 unidade do estoque por
--     escolha — "+1 fatia" de um bacon guardado em kg baixava 1 kg.
--
-- `produto.item_unidade` / `opcao.item_unidade` = a unidade escolhida na ligação; NULL = a do
-- próprio estoque (o comportamento de sempre).
-- `produto.item_fator` = quanto da unidade do ESTOQUE sai a cada unidade vendida (fardo de 12
-- vendido por unidade → 1/12). Fica gravado, como a linha da ficha técnica (mig 308), para a
-- venda não depender de refazer a conversão. O adicional não precisa da coluna: a quantidade já
-- vai para `complemento_opcao.quantidade` quando o catálogo é materializado no produto.
--
-- NÃO é @cloud-only: `produto` e `opcao` existem nos dois bancos e sincronizam nos dois sentidos
-- (o sync reconcilia coluna nova sozinho a partir da 1.30.0). Coluna com valor padrão constante
-- não regrava a tabela. Idempotente.
set local lock_timeout = '5s';

alter table produto add column if not exists item_unidade text;
alter table produto add column if not exists item_fator numeric not null default 1;
alter table opcao add column if not exists item_unidade text;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'produto.item_unidade' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'produto'
                  and column_name = 'item_unidade' and data_type = 'text') as ok
union all
select 'produto.item_fator (numeric, padrão 1, obrigatória)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'produto'
                  and column_name = 'item_fator' and data_type = 'numeric'
                  and numeric_scale is null and is_nullable = 'NO' and column_default = '1')
union all
select 'opcao.item_unidade',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'opcao'
                  and column_name = 'item_unidade' and data_type = 'text');
