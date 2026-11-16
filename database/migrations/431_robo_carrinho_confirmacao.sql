-- @cloud-only
-- 431 · A CONFIRMAÇÃO DO PEDIDO DO ROBÔ VEM DO CLIENTE, NÃO DA IA (16/11/2026 — o documento "Atendente virtual — Mister
-- Burguer" do dono: "confirmação vinculada ao carrinho: salvar qual versão o cliente aprovou"; "não trate agradecimento,
-- figurinha ou um 'sim' fora de contexto como autorização para concluir uma compra").
-- Só NUVEM, como a 344/345 (a tabela `robo_carrinho` só existe na nuvem).
--
-- O que entra no carrinho do robô (uma coluna nova, opcional):
--   confirmado_versao — a versão do pedido cujo RESUMO PARA CONFERIR o CLIENTE confirmou: o toque em "Pode registrar"
--                       (ou "Sim, quero os dois"), o "1" do menu numerado ou um sim claro sozinho na mensagem, anotado pelo
--                       Regem ao RECEBER a mensagem do WhatsApp, antes de ela ir à IA. Registrar passa a exigir
--                       confirmado_versao = versao (até aqui exigia só resumo_versao = versao — o resumo ENVIADO —, e quem
--                       dizia que o cliente confirmou era a IA). Mudar o pedido sobe a versão e a confirmação deixa de valer;
--                       mandar o resumo de novo zera a coluna.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. A tabela tem poucas linhas.
set local lock_timeout = '5s';

alter table robo_carrinho add column if not exists confirmado_versao integer;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'coluna robo_carrinho.confirmado_versao (integer)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_carrinho'
                  and column_name = 'confirmado_versao' and data_type = 'integer') as ok;
