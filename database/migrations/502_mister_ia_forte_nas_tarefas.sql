-- @cloud-only
-- 502 — MISTER: a IA mais forte nas tarefas (versão 9, fase O6; `docs/plano-mister.md` § "Versão 9", decisão V9-7: "intercalar
-- Haiku e Sonnet"; protótipo `mockups/regem-mister-v9.html`, aba "Na loja").
--
--   mister_conversa_config.ia_forte_nas_tarefas  "IA mais forte nas tarefas": com um cupom, uma nota ou uma lista em andamento, a
--                                                resposta usa o modelo maior; no resto, o de sempre. Nasce DESLIGADO (custo; regra
--                                                do dono de 20/11) e só o presidente muda.
--
-- ⚠️ SÓ NUVEM: a tabela é SO_NUVEM no sync-daemon e o servidor da loja pula o arquivo. Sem `drop`: vai pelo MCP (LIC-171).
-- Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_conversa_config
  add column if not exists ia_forte_nas_tarefas boolean not null default false;

comment on column mister_conversa_config.ia_forte_nas_tarefas is
  'Mister O6 (mig 502): com uma tarefa em andamento, a resposta usa o modelo maior. Nasce desligado; só o presidente muda.';

-- Conferência (no mesmo Run): a coluna com o padrão desligado e nenhuma empresa ligada.
select 'coluna' as o_que, column_name as nome, column_default as detalhe
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'ia_forte_nas_tarefas'
union all
select 'ligadas', 'empresas com o ajuste ligado', count(*)::text
  from mister_conversa_config where ia_forte_nas_tarefas
 order by 1, 2;
