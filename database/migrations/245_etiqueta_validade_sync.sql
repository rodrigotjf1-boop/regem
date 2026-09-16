-- 245_etiqueta_validade_sync.sql — As ETIQUETAS DE VALIDADE passam a sincronizar
-- entre o servidor local e a nuvem.
--
-- ⚠️ NÃO é @cloud-only: `etiqueta_template` e `etiqueta_validade` existem no edge
-- (`EtiquetaValidadeModule` é EDGE_CORE) e é lá que a etiqueta nasce. Aplicar na
-- nuvem E no edge.
--
-- POR QUÊ
-- Quarto caso da MESMA classe dos furos fechados nas migs 242 e 243: a tabela existe nos
-- dois lados, o módulo que a escreve roda no edge, e ela nunca entrou em `TABELAS_SYNC`
-- — então nada falha, só não sobe. A etiqueta impressa na loja (validade de manipulado,
-- RDC 216) ficava só no servidor local:
--   • a nuvem não enxerga o que está aberto nem o que vence — e o job de alerta de
--     validade da nuvem roda em cima de uma tabela vazia;
--   • `perda()` transforma etiqueta vencida em DESPERDÍCIO. O desperdício sobe (mig 243),
--     a etiqueta que o originou não — a nuvem vê a perda sem a origem;
--   • numa reinstalação, todo o rastreio de validade em uso na loja se perde.
--
-- O QUE FALTAVA PARA PODER SINCRONIZAR
-- As duas tabelas têm `updated_at` desde a mig 136, mas NENHUMA tem GATILHO de bump —
-- a mesma lacuna que a mig 243 documentou em 10 de 11 tabelas. Sem o bump, o sync LWW
-- só capturaria a CRIAÇÃO, e o ciclo de vida da etiqueta é justamente uma sequência de
-- UPDATEs: `fechado → em_uso` (abrir/ler o código), `→ baixado` (consumo),
-- `→ vencido` + `virou_perda` (perda). Tudo isso ficaria invisível do outro lado: a
-- nuvem mostraria para sempre como "fechada" uma etiqueta que a loja já deu baixa.

-- ===== 1. Gatilho de bump nas duas =====
-- `bump_updated_at()` vem da mig 095 (base, existe no edge).
do $$
declare t text;
begin
  foreach t in array array['etiqueta_template', 'etiqueta_validade'] loop
    execute format('drop trigger if exists trg_bump_updated_at on %I', t);
    execute format('create trigger trg_bump_updated_at before update on %I '
                   || 'for each row execute function bump_updated_at()', t);
  end loop;
end $$;

-- ===== 2. Índice do KEYSET do pull/push =====
-- O delta ordena por (tenant_id, updated_at, id) a cada ciclo, em toda loja com edge.
-- Só na transacional: `etiqueta_template` tem ~1 linha por tenant e não justifica índice.
--
-- ⚠️ Lição da mig 244: o arquivo inteiro roda como UMA transação, então um índice que
-- estoura o statement_timeout DESFAZ a migration toda e ela "passa" calada. `etiqueta_
-- validade` é da ordem de milhares de linhas por loja (não é ledger), então este índice
-- é seguro — mas se algum dia der timeout, criar sozinho e conferir depois.
create index if not exists idx_etiqueta_validade_sync on etiqueta_validade (tenant_id, updated_at, id);
