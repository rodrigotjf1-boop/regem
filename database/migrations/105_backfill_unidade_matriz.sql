-- 105_backfill_unidade_matriz.sql
-- RBAC de filial: os módulos por-loja passaram a filtrar por unidade_id. Linhas
-- TRANSACIONAIS legadas com unidade_id NULL (criadas antes do multi-unidade)
-- ficariam invisíveis ao usuário de loja. Este backfill as adota na MATRIZ do
-- tenant (ou, na falta de matriz, a unidade mais antiga).
--
-- Escopo: SÓ dados transacionais (pertencem a uma loja). Tabelas de
-- config/catálogo/plano (cardapio_config, delivery_config, fiscal_config,
-- fidelidade_plano, cashback_plano, produto, ficha_tecnica, cupom, banner…) NÃO
-- entram: nelas unidade_id NULL = "padrão da rede", herdado pela filial via
-- filtro "= atual OR IS NULL". Mexer nelas esvaziaria a filial.
--
-- Nota: cada UPDATE traz a matriz por uma CTE própria (sem tabela temporária),
-- porque editores com pool de conexão (ex.: Supabase SQL Editor) não mantêm
-- TEMP TABLE entre comandos.

-- Estoque
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update item_estoque      t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update estoque_snapshot  t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update recebimento       t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update contagem_lista    t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update compra_lista      t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update desperdicio       t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update vistoria          t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;

-- Financeiro
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update titulo_financeiro t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update lancamento_caixa  t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update caixa_sessao      t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;

-- Ponto
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update ponto_marcacao    t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;

-- Salão / comandas / produção / delivery / fiscal (transacional)
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update mesa              t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update comanda           t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update producao_pedido   t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update impressao_job     t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update pedido_externo    t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
with matriz as (select distinct on (tenant_id) tenant_id, id as unidade_id from unidade where deleted_at is null order by tenant_id, (tipo = 'matriz') desc, created_at asc)
update nota_fiscal       t set unidade_id = m.unidade_id from matriz m where t.tenant_id = m.tenant_id and t.unidade_id is null;
