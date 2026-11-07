-- @cloud-only
-- 376 · COPILOTO DO ATENDIMENTO (item 7 do checkpoint da Central, 06/11/2026; protótipo
-- `mockups/regem-central-atendimento.html`, versão 5: o botão "✨ Sugerir resposta" no caso e o grupo "Copiloto" dos
-- ajustes). O botão põe na caixa de escrever uma sugestão feita pelo modelo de IA da DISTRIBUIÇÃO (a chave fica com a
-- Regem, nunca com a loja) com a conversa, o pedido e as respostas prontas; a pessoa confere, muda e envia — nada sai
-- sozinho. Só NUVEM, como a 353/366/375: a chave do modelo e a rota moram nela.
--
-- robo_config.copiloto_ligado — "Sugerir resposta no caso" (da empresa). Nasce DESLIGADO. Sem a chave do modelo na
--   distribuição, o botão não aparece mesmo ligado.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table robo_config add column if not exists copiloto_ligado boolean not null default false;

-- Conferência (no mesmo Run): a coluna.
select 'coluna' as o_que, 'robo_config.' || column_name as nome, data_type as ok
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'robo_config' and column_name = 'copiloto_ligado';
