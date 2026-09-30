-- @cloud-only
-- 297_pedido_externo_comanda_idx.sql — Índice de pedido_externo por comanda_id (trilha C, C1c — PR2).
--
-- A pergunta "esta comanda é de um pedido de canal?" (`comandaEhDeCanal`, a regra única do
-- faturamento) e o carimbador da API de integração (comanda → pedido ligado) procuram o pedido
-- PELA comanda. Não existia índice para isso (achado A6 do plano): sem ele, a consulta lê a tabela
-- de pedidos inteira — POR COMANDA quando a regra está na lista de colunas. Medido com 500 mil
-- pedidos e 500 mil comandas: 300 comandas do carimbador 82 s → 2,2 ms; pedidos de 1.000 comandas
-- 414 → 1,8 ms; o "balcão do dia" do Painel de uma loja 259 → 5,4 ms. OBRIGATÓRIO antes do merge
-- do PR2 (sem ele o carimbador estoura o tempo nas comandas).
--
-- ⚠️ ESTE ARQUIVO TEM UM COMANDO SÓ, E TEM DE RODAR SOZINHO: `create index concurrently` não
--    trava as vendas enquanto o índice é montado, mas não roda dentro de transação. No SQL Editor
--    do Supabase: cole SÓ o comando abaixo num Run próprio (sem `set`, sem conferência junto).
--    Se o editor responder "cannot run inside a transaction block", nada mudou — avise antes de
--    tentar outro caminho. Conferência (outro Run, depois): o índice aparece com
--    `indisvalid = true` (um `concurrently` interrompido deixa o índice INVÁLIDO: apague com
--    `drop index concurrently if exists idx_pedido_externo_comanda;` e rode de novo).
-- ⚠️ SÓ NUVEM: o servidor da loja não roda a API de integração.
-- Idempotente (if not exists).
create index concurrently if not exists idx_pedido_externo_comanda
  on pedido_externo (comanda_id)
  where comanda_id is not null;
