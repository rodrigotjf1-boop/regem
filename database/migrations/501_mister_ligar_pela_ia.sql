-- @cloud-only
-- 501 — MISTER: ligar as linhas pela IA (versão 9, fase O1; `docs/plano-mister.md` § "Versão 9", decisões V9-1 e V9-2;
-- protótipo `mockups/regem-mister-v9.html`, abas "No celular" e "Na loja").
--
--   mister_conversa_config.ligar_pela_ia  "Ligar as linhas pela IA": nota, cupom e lista ligados ao estoque pela IA, com as dúvidas
--                                         juntas numa mensagem. Nasce DESLIGADO (custo; regra do dono de 20/11) e só o presidente
--                                         muda. Desligado, segue a sugestão pelas palavras, como antes.
--
-- ⚠️ SÓ NUVEM: a tabela é SO_NUVEM no sync-daemon e o servidor da loja pula o arquivo. Sem `drop`: vai pelo MCP (LIC-171).
-- Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_conversa_config
  add column if not exists ligar_pela_ia boolean not null default false;

comment on column mister_conversa_config.ligar_pela_ia is
  'Mister O1 (mig 501): nota, cupom e lista ligados ao estoque pela IA. Nasce desligado; só o presidente muda.';

-- Conferência (no mesmo Run): a coluna com o padrão desligado e nenhuma empresa ligada.
select 'coluna' as o_que, column_name as nome, column_default as detalhe
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'ligar_pela_ia'
union all
select 'ligadas', 'empresas com o ajuste ligado', count(*)::text
  from mister_conversa_config where ligar_pela_ia
 order by 1, 2;
