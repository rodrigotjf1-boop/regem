-- @cloud-only
-- 440 — MISTER: os ajustes da CONVERSA por empresa (versão 3 do protótipo `mockups/regem-mister.html`, aprovada pelo
-- dono em 17/11/2026 — "Avisos e relatórios › Conversa"). M3a, parte 3: o primeiro ajuste é o dos documentos por foto.
--
-- mister_conversa_config — uma linha por empresa, só quando o presidente salva (sem linha = o padrão):
--   documentos_ligado  — "Lançar boletos e notas por foto" (padrão: ligado; a leitura em si ainda depende da chave
--                        MISTER_DOCUMENTOS da distribuição)
--   documentos_modo    — "Como lançar o boleto": sozinho (só o boleto bancário cujo código confere, de fornecedor
--                        cadastrado, sempre com "Desfazer") | perguntar (pergunta antes, sempre)
--   Os próximos ajustes da conversa (o áudio, a tela no "como faço") entram aqui como colunas novas, cada um na sua fase.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

create table if not exists mister_conversa_config (
  tenant_id          uuid primary key references empresa(id) on delete cascade,
  documentos_ligado  boolean not null default true,
  documentos_modo    text not null default 'sozinho',
  alterado_por       uuid,
  atualizado_em      timestamptz not null default now(),
  constraint ck_mister_conversa_config_modo check (documentos_modo in ('sozinho', 'perguntar'))
);
alter table mister_conversa_config enable row level security;

comment on table mister_conversa_config is 'Mister (mig 440): os ajustes da conversa por empresa (documentos por foto) — só nuvem';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas e a restrição.
do $$
begin
  if to_regclass('mister_conversa_config') is null then raise exception 'mig 440: falta a tabela mister_conversa_config'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_conversa_config')) then
    raise exception 'mig 440: a RLS da mister_conversa_config não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_conversa_config'
         and column_name in ('tenant_id', 'documentos_ligado', 'documentos_modo', 'alterado_por', 'atualizado_em')) <> 5 then
    raise exception 'mig 440: faltam colunas da mister_conversa_config';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_conversa_config') and conname = 'ck_mister_conversa_config_modo') then
    raise exception 'mig 440: falta a restrição do modo da mister_conversa_config';
  end if;
end $$;
