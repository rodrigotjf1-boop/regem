-- 133_subpdv_salao.sql — Sub-PDV Salão (ponto de lançamento do garçom).
-- Terminal de salão atrelado a um PDV main (equipamento tipo='pdv'). O garçom lança
-- na própria mesa; a comanda vai à cozinha com o CABEÇALHO de onde foi emitida.
-- Reusa `equipamento` (novo tipo 'salao') + `mesa`/`comanda`. Regra "abrir/fechar
-- mesa exige turno do main aberto" é aplicada no serviço (checa caixa_sessao). Idempotente.

-- Sub-PDV salão: qual PDV main (caixa principal) este ponto de salão pertence.
-- equipamento.tipo passa a aceitar 'salao' (coluna é text livre — sem constraint de enum).
alter table equipamento add column if not exists pdv_main_id uuid;

-- Mesa: ponto de salão que a abriu (roteamento e permissão).
alter table mesa add column if not exists equipamento_id uuid;

-- Comanda-item: ponto de salão que LANÇOU o item (cabeçalho da via da cozinha).
alter table comanda_item add column if not exists origem_equipamento_id uuid;

-- Comanda: ponto que abriu (fallback do cabeçalho quando o item não trouxer origem).
alter table comanda add column if not exists origem_equipamento_id uuid;
