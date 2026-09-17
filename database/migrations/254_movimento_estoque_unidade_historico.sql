-- 254_movimento_estoque_unidade_historico.sql — Atribui a LOJA aos movimentos que já existem.
--
-- ⚠️ NÃO é @cloud-only. Aplicar DEPOIS da 253 (usa a função dela), na nuvem e no edge.
--
-- SEPARADA DA 253 DE PROPÓSITO (lição da mig 244): um arquivo roda como UMA transação. Se
-- este UPDATE sobre o ledger inteiro estourar o tempo limite, só ele é desfeito — a coluna
-- e o gatilho da 253 continuam valendo, e os movimentos novos seguem nascendo com loja.
-- Pode ser rodada de novo sem efeito colateral: só mexe em quem ainda está sem loja.
--
-- Usa exatamente a mesma resolução do gatilho (origem → insumo exclusivo → loja única).
-- O que continuar nulo é movimento antigo, sem origem registrada, de insumo compartilhado
-- em empresa de duas lojas: NÃO é atribuído por palpite (decisão do dono). A consulta do
-- fim mostra quantos são por empresa; a próxima contagem de cada loja restabelece o saldo.

update movimento_estoque
   set unidade_id = regem_unidade_do_movimento(tenant_id, item_id, ref_tipo, ref_id)
 where unidade_id is null;

-- Relatório (não altera nada): movimentos que ficaram sem loja, por empresa.
-- select e.nome as empresa, count(*) as sem_loja
--   from movimento_estoque m join empresa e on e.id = m.tenant_id
--  where m.unidade_id is null
--  group by e.nome order by 2 desc;
