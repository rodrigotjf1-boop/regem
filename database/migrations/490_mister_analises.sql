-- @cloud-only
-- 490 — MISTER: as análises de venda (versão 7, etapa V7e; `docs/plano-mister.md` § "Versão 7", decisões V7-7, V7-8 e V7-10;
-- protótipo `mockups/regem-mister-v7.html`, abas "Análises (BI)" e "Ajustes").
--
--   mister_conversa_config.analises_profundas  "Análises mais profundas" (V7-7): nasce DESLIGADA e só o presidente muda.
--                                              Ligada, o laço segue no modelo de sempre e só a resposta depois de uma análise
--                                              com dados usa o modelo maior. O custo fica no medidor pelo modelo usado.
--
-- ⚠️ SÓ NUVEM: a tabela é SO_NUVEM no sync-daemon e o servidor da loja pula o arquivo. Sem `drop`: vai pelo MCP (LIC-171). O tipo
-- novo de `mister_padrao` precisa de `drop constraint` e está separado, na 491. Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_conversa_config
  add column if not exists analises_profundas boolean not null default false;

comment on column mister_conversa_config.analises_profundas is
  'Mister V7e (mig 490): a resposta depois de uma análise com dados usa o modelo maior. Nasce desligada; só o presidente muda.';

-- Conferência (no mesmo Run): a coluna com o padrão desligado e nenhuma empresa ligada.
select 'coluna' as o_que, column_name as nome, column_default as detalhe
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'analises_profundas'
union all
select 'ligadas', 'empresas com o ajuste ligado', count(*)::text
  from mister_conversa_config where analises_profundas
 order by 1, 2;
