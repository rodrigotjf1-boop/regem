-- 241_pedido_valores_desconto_origem.sql — separa os valores do pedido para que dê para
-- responder, por canal: quanto foi vendido, quanto foi desconto, QUEM bancou cada desconto,
-- quanto o cliente pagou e o que a loja tem a receber.
--
-- POR QUE: hoje o pedido guarda um número final (`total`) e um `desconto` que é SEMPRE 0,00
-- em marketplace (nenhum poller passa desconto). Isso torna impossível:
--   (a) conferir o repasse semanal — o desconto bancado pelo marketplace volta no repasse,
--       mas não existe de onde somar "quanto eles me devem";
--   (b) saber o custo dos programas de fidelidade/cashback — no Anota Aí um resgate de
--       R$32,50 deixa o pedido com total 0,00 e o desconto simplesmente some;
--   (c) fechar faturamento — o mesmo pedido vale `pedido_externo.total` num relatório e
--       `comanda.total` (soma dos itens) no caixa, e os dois divergem.
--
-- A DISTINÇÃO CENTRAL é quem banca o desconto:
--   • bancado pela LOJA        → sai do bolso do lojista (custo de marketing/fidelidade)
--   • bancado pelo MARKETPLACE → o cliente paga menos mas a loja recebe cheio (volta no repasse)
-- Tratar os dois como um "desconto" só deixa o faturamento menor do que foi num caso e a
-- margem maior do que foi no outro — e os dois erros se escondem um no outro.
--
-- NÃO é cloud-only: pedido_externo existe no EDGE (mig 039 não tem o marcador) e o delivery
-- roda lá. O sync descobre coluna nova sozinho (information_schema), mas o edge só passa a
-- ter estas colunas depois do .zip — até lá ele opera com os campos antigos.
--
-- Aditiva e idempotente. Não altera nenhuma coluna existente: `total`, `desconto` e
-- `taxa_entrega` seguem com o mesmo significado de hoje para não quebrar consumidor nenhum.

-- Valor dos itens a preço CHEIO, antes de qualquer desconto (o "de").
alter table pedido_externo add column if not exists valor_bruto numeric;

-- Descontos separados por quem paga a conta.
alter table pedido_externo add column if not exists desconto_loja numeric not null default 0;
alter table pedido_externo add column if not exists desconto_marketplace numeric not null default 0;

-- Detalhe de cada desconto, como o canal informou:
-- [{ origem:'fidelidade'|'cupom'|'promocao'|'cashback'|'frete'|'outro',
--    rotulo:'fidelidade', valor:32.50, alvo:'CART'|'ITEM'|'DELIVERY_FEE',
--    quemBanca:'loja'|'marketplace'|'indefinido', campanha?:'...' }]
-- Guardar o detalhe (e não só os totais) é o que permite relatório por programa
-- (quanto a fidelidade custou no mês) sem ter que reprocessar o payload cru.
alter table pedido_externo add column if not exists descontos jsonb;

-- Detalhe das formas de pagamento, como o canal informou:
-- [{ codigo:'ifood-online-pix-payin', rotulo:'Pix', valor:27.50, prepago:true,
--    troco:null, bandeira:'Banricard crédito' }]
-- Hoje só guardamos UM rótulo; isto abre pagamento dividido, troco por método e bandeira.
alter table pedido_externo add column if not exists pagamentos jsonb;

-- De quem é a taxa de entrega. Quando a logística é da loja, a taxa é RECEITA dela; quando
-- é do marketplace, é CUSTO deduzido do repasse. Hoje `taxa_entrega` é um campo só e
-- significa as duas coisas, então somá-la como faturamento acerta num caso e erra no outro.
-- null = não informado pelo canal.
alter table pedido_externo add column if not exists taxa_entrega_dono text;

-- O que o cliente efetivamente pagou (após todos os descontos, com a taxa quando ela compõe
-- o pedido). É o número que bate com o comprovante do cliente.
alter table pedido_externo add column if not exists valor_pago_cliente numeric;

-- Taxas que o cliente paga MAS NÃO SÃO receita de produto: gorjeta do garçom (vai para o
-- garçom) e taxa de serviço do pagamento online. A Anota Aí manda em `additionalFees`
-- ({type:'waiter_tip'|'addition_pol', description, value}). Sem separar, a gorjeta entra
-- como faturamento e infla a margem — e o rateio do garçom fica sem base.
-- [{tipo:'waiter_tip', rotulo:'Taxa do garçom', valor:1.00}]
alter table pedido_externo add column if not exists taxas_extras numeric not null default 0;
alter table pedido_externo add column if not exists taxas_extras_detalhe jsonb;

-- Consulta do repasse: "quanto o marketplace me deve de voucher no período".
create index if not exists idx_pedido_externo_desc_mkt
  on pedido_externo (tenant_id, canal, criado_em)
  where desconto_marketplace > 0;
