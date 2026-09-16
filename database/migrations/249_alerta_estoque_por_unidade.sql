-- 249_alerta_estoque_por_unidade.sql — Um alerta de estoque ABERTO por LOJA, não por empresa.
--
-- ⚠️ NÃO é @cloud-only: os jobs de alerta (JobsModule) e o EstoqueModule rodam no edge.
-- Aplicar na nuvem E no edge.
--
-- POR QUÊ (auditoria #45)
-- A mig 031 criou `idx_alerta_estoque_aberto` único em (tenant_id, tipo): UM alerta aberto
-- de "ponto de pedido" e UM de "validade" por empresa. É o desenho de antes do
-- multi-unidade. Os jobs calculam o alerta para o tenant inteiro e gravam com
-- `unidade_id` nulo; a tela da loja filtra `unidade_id = <loja>`.
--
-- Em rede de UMA loja isso não aparece — o `UnidadeUnicaInterceptor` zera o filtro de
-- unidade. Em rede com VÁRIAS lojas, o usuário de loja não via alerta NENHUM: o sistema
-- de alertas simplesmente não existia para ele. E a correção óbvia (deixar a loja ver o
-- alerta de unidade nula) seria pior, porque o alerta foi calculado sobre TODAS as lojas:
-- o gerente da loja A passaria a ler a lista de insumos da loja B.
--
-- A correção certa é o alerta nascer por loja. Para isso o índice precisa aceitar um
-- alerta aberto por (tenant, UNIDADE, tipo). `coalesce` com o UUID nulo mantém a
-- unicidade também para o alerta de unidade nula (rede de loja única, e o de produto
-- esgotado do cardápio), que continua sendo um por empresa.
--
-- O novo índice é MENOS restritivo que o antigo (a chave ganhou uma coluna), então todo
-- dado válido hoje continua válido — a migration não pode falhar por dado existente.
-- ⚠️ Lição da mig 244: o arquivo é uma transação só; `alerta_estoque` tem no máximo uma
-- linha aberta por tipo por empresa, então o índice é instantâneo.

drop index if exists idx_alerta_estoque_aberto;
create unique index if not exists idx_alerta_estoque_aberto
  on alerta_estoque (
    tenant_id,
    coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid),
    tipo
  )
  where resolvido_em is null;
