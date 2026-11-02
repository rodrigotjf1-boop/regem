-- 351_chamado_detalhe_da_plataforma.sql — o caso da central guarda o que a PLATAFORMA mandou (Onda 1, PR 2: disputas do
-- iFood; o PR 3 usa o mesmo para os pedidos de cancelamento e reembolso da 99).
--
-- ⚠️ NÃO é @cloud-only: `atendimento_chamado` existe na nuvem e no servidor da loja e sincroniza nos dois sentidos. A
--    disputa nasce na NUVEM (o leitor de eventos do iFood só roda lá); a loja recebe o caso pelo sincronismo e precisa ver
--    o que o cliente pediu, as propostas e o prazo — por isso o detalhe vai na linha do caso. Enquanto a loja não recebe
--    esta migration (vem no .zip), as colunas que a nuvem manda a mais são ignoradas lá.
-- ⚠️ Vai pelo MCP do Supabase: sem instrução destrutiva (V9, ERR-225). Idempotente. Colunas sem default: o Postgres não
--    reescreve a tabela.
--
--   detalhe    — o que a plataforma mandou e o que a loja respondeu (jsonb): a disputa do iFood (ação, tipo, prazo, ação
--                automática, propostas permitidas, fotos, itens, motivos aceitos), a resposta e o encerramento.
--   externo_id — o id do caso NA PLATAFORMA (a disputa do iFood, o pedido da 99): o mesmo evento repetido não abre outro
--                caso — índice único por empresa, canal e id (V24).
set local lock_timeout = '5s';

alter table atendimento_chamado add column if not exists detalhe jsonb;
alter table atendimento_chamado add column if not exists externo_id text;

create unique index if not exists uq_atendimento_chamado_externo
  on atendimento_chamado (tenant_id, canal, externo_id)
  where externo_id is not null;
