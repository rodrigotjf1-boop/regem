-- @cloud-only
-- 361 · O ROBÔ PERGUNTA DO PEDIDO IGUAL (pedido do dono, 03/11/2026; protótipo `mockups/regem-alteracao-pedido.html`).
-- Só NUVEM, como a 344/345 (a tabela `robo_carrinho` só existe na nuvem).
--
-- repetido_versao — a versão do pedido em montagem para a qual o Regem mandou ao cliente a pergunta do PEDIDO IGUAL
--                   (no resumo para conferir: "Você já fez um pedido igual às 19:42 … Quer que a gente produza e envie
--                   os dois?", com "Sim, quero os dois" / "Não, foi repetido"). Registrar só confirma o segundo pedido
--                   quando a pergunta foi desta versão — como o `resumo_versao` (mig 345): o cliente viu a pergunta.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. A tabela tem poucas linhas.
set local lock_timeout = '5s';

alter table robo_carrinho add column if not exists repetido_versao integer;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'coluna robo_carrinho.repetido_versao (integer)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_carrinho'
                  and column_name = 'repetido_versao' and data_type = 'integer') as ok;
