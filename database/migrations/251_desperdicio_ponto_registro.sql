-- 251_desperdicio_ponto_registro.sql — O desperdício passa a dizer ONDE e POR QUEM foi
-- registrado.
--
-- ⚠️ NÃO é @cloud-only: o desperdício é registrado no servidor local da loja
-- (DesperdicioModule é EDGE_CORE) e `desperdicio` sincroniza nos dois sentidos.
-- ⚠️ ADICIONA COLUNAS — Drizzle nomeia todas no `select`: nuvem ANTES do merge (42703).
--
-- POR QUÊ (auditoria #43, decisão do dono)
-- O desperdício vai ser registrado em PONTOS com leitor óptico — um PC à parte com
-- leitor e tela, ou um Android que escaneia o produto — na mesma rede do servidor
-- local. Quem pode registrar é decidido pela permissão `desperdicio` (mig 252); esta
-- migration guarda o RASTRO: QUANDO, EM QUAL PONTO e POR QUEM.
--
-- • QUANDO já existia: `created_at` é a hora do servidor no momento do registro,
--   diferente de `data`, que é o dia em que o desperdício aconteceu.
-- • ONDE não existia → `equipamento_id`: o ponto é um equipamento cadastrado, do tipo
--   novo `ponto_baixa`.
-- • QUEM não existia de verdade → `registrado_por_id`, tirado do LOGIN. O campo
--   `colaborador_id` vinha do corpo do request (a auditoria apontou que dava para
--   informar qualquer um) e a tela nem o enviava: na prática ficava sempre vazio. Ele
--   continua existindo como "responsável informado", separado de quem registrou.
--
-- Sem índice novo de propósito (lição da mig 244): colunas nullable são instantâneas, e
-- o relatório por ponto não justifica índice numa tabela deste tamanho.

alter table desperdicio add column if not exists equipamento_id uuid;
alter table desperdicio add column if not exists registrado_por_id uuid;
