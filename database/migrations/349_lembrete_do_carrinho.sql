-- @cloud-only
-- 349 · O LEMBRETE DO PEDIDO QUE FICOU PELA METADE NO ROBÔ (Onda 0 do plano do atendimento, aprovado pelo dono;
-- 01/11/2026). Só NUVEM, como a 344 (robo_carrinho) e a 347 (robo_config): o robô de WhatsApp só existe na nuvem.
--
-- O que entra:
--   robo_config.lembrete_carrinho — a loja liga (NASCE DESLIGADO). Ligado, o cliente que parou de montar o pedido no
--     robô (carrinho aberto, com itens, sem mexer há mais de 30 min e menos de 3 h), com a loja aberta e a conversa sem
--     atendente, recebe UMA mensagem perguntando se quer finalizar.
--   robo_carrinho.lembrado_em — "já lembrei este carrinho": gravado ANTES do envio (update … where lembrado_em is null
--     returning): duas réplicas da API, ou duas voltas da rotina, nunca mandam o lembrete duas vezes (V24, V42).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Colunas com padrão em tabelas pequenas; o
-- `lock_timeout` desiste em vez de enfileirar escrita atrás delas.
set local lock_timeout = '5s';

alter table robo_config add column if not exists lembrete_carrinho boolean not null default false;
alter table robo_carrinho add column if not exists lembrado_em timestamptz;
