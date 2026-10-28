-- 341_fidelidade_pontos_quando_o_premio_sai.sql — os pontos do cliente voltam quando um prêmio é apagado.
--
-- ⚠️ NÃO é @cloud-only: nuvem e servidor da loja recalculam os pontos (mig 274). Idempotente.
-- ⚠️ Vai pelo MCP do Supabase: o gatilho é trocado por `create or replace trigger`, sem apagar
--    nada antes (Postgres 14+; a nuvem é 17, o CI 16) — LIC-171, ERR-225.
-- Depende da 274 (função `fidelidade_pontos_do_extrato`, que já trata DELETE).
--
-- DEFEITO (ERR-315)
-- Os pontos do cliente são recalculados do extrato por gatilho: pontos válidos + ajustes −
-- (meta × prêmios). O gatilho de `fidelidade_resgate` só rodava no INSERT. Quando um prêmio
-- é APAGADO — o estorno de um pedido cancelado que tinha completado a meta apaga o prêmio que
-- ele gerou (`FidelidadeService.estornarPedido`) —, a conta não era refeita:
--   • do lado que estorna, o serviço apaga o prêmio e DEPOIS estorna o ponto, e o gatilho do
--     ponto refaz a conta — por isso ali dava certo;
--   • do outro lado, as duas mudanças chegam pelo sync separadas e em qualquer ordem. Se o
--     ponto estornado chega antes, a conta sai com o prêmio ainda lá (2 − 3 → 0); quando a
--     exclusão do prêmio chega, nada recalcula e o cliente fica com 0 naquele lado até o
--     próximo pedido pontuado (o certo era 2).
--
-- CORREÇÃO: o mesmo gatilho passa a rodar também no DELETE. A função já sabe ler `old` e já
-- sai cedo numa exclusão em cascata (plano ou empresa sumindo), então nada mais muda.
--
-- Dados: medido na nuvem em 28/10/2026, só lendo — nenhum cliente com pontos e nenhum prêmio
-- gravado; não há saldo para corrigir.

create or replace trigger trg_fidelidade_pontos_resgate after insert or delete on fidelidade_resgate
  for each row execute function fidelidade_pontos_do_extrato();
