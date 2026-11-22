-- @cloud-only
-- 493 — MISTER: a voz com emoção (versão 7, etapa V7d; `docs/plano-mister.md` § "Versão 7", decisões V7-4, V7-5 e V7-6;
-- protótipo `mockups/regem-mister-v7.html`, abas "Voz" e "Jeito e memória").
--
--   mister_conversa_config.voz_com_emocao  "Voz com emoção" (V7-6): nasce DESLIGADA e só o presidente muda. Só vale com
--                                          "Responder em áudio" ligado. O tom de quem fala NUNCA é gravado (V7-5): esta coluna
--                                          guarda só o ajuste da empresa.
--
-- ⚠️ SÓ NUVEM: a tabela é SO_NUVEM no sync-daemon e o servidor da loja pula o arquivo. Sem `drop`: vai pelo MCP (LIC-171).
-- Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_conversa_config
  add column if not exists voz_com_emocao boolean not null default false;

comment on column mister_conversa_config.voz_com_emocao is
  'Mister V7d (mig 493): a resposta em áudio acompanha o tom de quem fala. Nasce desligada; só o presidente muda. O tom em si não é gravado.';

-- Conferência (no mesmo Run): a coluna com o padrão desligado e nenhuma empresa ligada.
select 'coluna' as o_que, column_name as nome, column_default as detalhe
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'voz_com_emocao'
union all
select 'ligadas', 'empresas com o ajuste ligado', count(*)::text
  from mister_conversa_config where voz_com_emocao
 order by 1, 2;
