-- 244_contagem_hora_do_item.sql — A contagem passa a guardar QUANDO cada item foi contado.
--
-- ⚠️ NÃO é @cloud-only: `contagem_item` existe no edge e sincroniza desde a mig 243.
--
-- POR QUÊ
-- O ajuste da contagem é `contado − saldo_do_sistema`. Até aqui o "saldo do sistema" era
-- o snapshot congelado na ABERTURA da contagem — e isso só está certo se o item tiver
-- sido contado no instante da abertura.
--
-- Na operação real (descrita pelo dono) o inventário roda DURANTE o expediente:
--   • hambúrguer industrializado sai a cada venda E fica em dois lugares (câmara
--     frigorífica + freezer da chapa) — conta-se andando entre eles enquanto a chapa
--     consome;
--   • molho cheddar só sai na PRODUÇÃO, que roda fora do expediente — não corre risco
--     numa contagem diurna;
--   • parte dos lojistas conta com o expediente parado — risco zero.
--
-- Com a hora de cada item, o saldo de referência passa a ser o do INSTANTE em que
-- aquele item foi contado. Isso acerta os três casos com a mesma conta: item que se
-- move ganha a base do seu próprio momento, item que não se move tem base idêntica à
-- da abertura, e loja parada não tem movimento nenhum para diferenciar.

alter table contagem_item add column if not exists contado_em timestamptz;

-- O cálculo do saldo no instante filtra por (tenant, item, created_at <= t). O índice
-- de cobertura da mig 216 é (tenant_id, item_id) INCLUDE (tipo, quantidade) e não ajuda
-- no recorte por tempo, que aqui é o que dói: uma contagem de 200 itens faz 200 somas
-- com filtro de data.
create index if not exists idx_movimento_estoque_item_tempo
  on movimento_estoque (tenant_id, item_id, created_at);
