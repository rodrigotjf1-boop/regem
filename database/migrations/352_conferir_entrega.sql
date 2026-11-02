-- @cloud-only
-- 352 · "CHEGOU TUDO CERTO?" DEPOIS DA ENTREGA (B1 do plano do atendimento, aprovado pelo dono em 01/11/2026; "pesquisa só
-- dentro da janela de 24 h"). Só NUVEM, como a 347 e a 349: o robô e o WhatsApp só existem lá.
--
-- O que entra:
--   robo_config.conferir_entrega — a loja liga (NASCE DESLIGADO). Ligado, o cliente de um pedido de ENTREGA dos canais da
--     própria loja (nunca iFood nem 99), concluído há 20 min a 3 h, com a conversa aberta na API oficial (escreveu nas
--     últimas 24 h) e sem atendente na conversa, recebe UMA pergunta com 3 botões: "Tudo certo 👍", "Tive um problema",
--     "Não chegou". Problema e "não chegou" viram caso na central; "tudo certo" só agradece.
--   uq_pedido_envio_conferir_entrega — UMA pergunta por pedido: a rotina grava o envio ANTES de mandar
--     (`insert … on conflict do nothing returning`); duas réplicas da API, ou duas voltas, nunca perguntam duas vezes
--     (V24, V42). E UMA resposta por pedido (o mesmo índice para a resposta).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabelas pequenas; o `lock_timeout` desiste
-- em vez de enfileirar escrita atrás delas.
set local lock_timeout = '5s';

alter table robo_config add column if not exists conferir_entrega boolean not null default false;

create unique index if not exists uq_pedido_envio_conferir_entrega
  on pedido_envio (pedido_id, acao)
  where acao in ('conferir_entrega', 'conferir_entrega_resposta');
