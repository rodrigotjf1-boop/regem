-- @cloud-only
-- 447 — MISTER: o JEITO do Mister por empresa (versão 4, fase M4a — protótipo `mockups/regem-mister-jeito-memoria.html`,
-- aprovado pelo dono em 18/11/2026 com as oito decisões recomendadas; plano em `docs/plano-mister.md`, "Versão 4").
--
-- Colunas novas em `mister_conversa_config` (a mig 440 já previa os próximos ajustes da conversa como colunas). Sem linha
-- ou com o padrão, nada muda:
--   perfil           — o tom das respostas, com as mesmas chaves do atendente virtual: hoje (padrão = como hoje) |
--                      profissional | cordial | gentil | descontraido | objetivo | acolhedor
--   jeito            — "Jeito da empresa": uma frase de até 300 letras, escrita pelo presidente (null = sem)
--   avisos_escritos  — os grupos de aviso que o Mister escreve com o contexto (fase M4c): loja | servidor | fiscal |
--                      mister; vazio (padrão) = o texto fixo de hoje
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela é SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). A conferência das colunas e das restrições vai no MESMO Run.
set local lock_timeout = '5s';

alter table mister_conversa_config add column if not exists perfil text not null default 'hoje';
alter table mister_conversa_config add column if not exists jeito text;
alter table mister_conversa_config add column if not exists avisos_escritos text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_conversa_config') and conname = 'ck_mister_conversa_config_perfil') then
    alter table mister_conversa_config add constraint ck_mister_conversa_config_perfil
      check (perfil in ('hoje', 'profissional', 'cordial', 'gentil', 'descontraido', 'objetivo', 'acolhedor'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_conversa_config') and conname = 'ck_mister_conversa_config_jeito') then
    alter table mister_conversa_config add constraint ck_mister_conversa_config_jeito
      check (jeito is null or (char_length(jeito) between 1 and 300 and position(chr(10) in jeito) = 0));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_conversa_config') and conname = 'ck_mister_conversa_config_avisos') then
    alter table mister_conversa_config add constraint ck_mister_conversa_config_avisos
      check (avisos_escritos <@ array['loja', 'servidor', 'fiscal', 'mister']::text[]);
  end if;
end $$;

comment on column mister_conversa_config.perfil is 'Mister (mig 447): o tom das respostas — as chaves do perfil do atendente virtual; hoje = como hoje';
comment on column mister_conversa_config.jeito is 'Mister (mig 447): o "Jeito da empresa", uma frase de até 300 letras do presidente';
comment on column mister_conversa_config.avisos_escritos is 'Mister (mig 447): os grupos de aviso escritos pelo Mister com o contexto (M4c); vazio = o texto fixo';

-- Conferência (no mesmo Run): as três colunas e as três restrições.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_conversa_config'
         and column_name in ('perfil', 'jeito', 'avisos_escritos')) <> 3 then
    raise exception 'mig 447: faltam colunas da mister_conversa_config';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = to_regclass('mister_conversa_config')
         and conname in ('ck_mister_conversa_config_perfil', 'ck_mister_conversa_config_jeito', 'ck_mister_conversa_config_avisos')) <> 3 then
    raise exception 'mig 447: faltam restrições da mister_conversa_config';
  end if;
end $$;
