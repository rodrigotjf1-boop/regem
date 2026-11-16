-- @cloud-only
-- 437 — MISTER: a CONEXÃO POR QR CODE do número no console (Q2 e Q3 do protótipo `mockups/regem-mister-qr.html`,
-- aprovado pelo dono em 15/11/2026; a Q1, mig 436, trouxe a porta do provedor).
--
-- O protótipo previa a Q2 sem migration. Na implementação, o estado da conexão por QR ganhou colunas PRÓPRIAS — reusar as
-- da API oficial (`situacao`, `motivo`, `numero`) apagaria o que a oficial sabe na volta para ela:
--   instancia_situacao — sem | conectando (o QR na tela) | conectado | caiu (o celular saiu) | bloqueado (pelo WhatsApp)
--   instancia_motivo, instancia_situacao_em — a frase e a hora da última mudança; instancia_conectada_em — desde quando
--   aceite_por, aceite_em, aceite_versao — o aceite do risco antes do primeiro QR (o nome, a data e a versão do texto;
--               a auditoria do console guarda o resto)
--   numero_anunciado — o último número que o Mister anunciou às pessoas ligadas (Q3: "este é o novo número do Mister"
--               sai uma vez por número novo, nunca de novo ao reconectar o mesmo)
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a `mister_numero` é da distribuição, sem tenant). Idempotente;
-- nada que apague objeto (LIC-171).
set local lock_timeout = '5s';

alter table mister_numero add column if not exists instancia_situacao text not null default 'sem';
alter table mister_numero add column if not exists instancia_motivo text;
alter table mister_numero add column if not exists instancia_situacao_em timestamptz;
alter table mister_numero add column if not exists instancia_conectada_em timestamptz;
alter table mister_numero add column if not exists aceite_por text;
alter table mister_numero add column if not exists aceite_em timestamptz;
alter table mister_numero add column if not exists aceite_versao text;
alter table mister_numero add column if not exists numero_anunciado text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_numero') and conname = 'ck_mister_numero_instancia_situacao') then
    alter table mister_numero add constraint ck_mister_numero_instancia_situacao
      check (instancia_situacao in ('sem', 'conectando', 'conectado', 'caiu', 'bloqueado'));
  end if;
end $$;

-- Conferência (no mesmo Run): as 8 colunas, a restrição e o número continuando na API oficial.
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = current_schema() and table_name = 'mister_numero'
        and column_name in ('instancia_situacao', 'instancia_motivo', 'instancia_situacao_em', 'instancia_conectada_em',
                            'aceite_por', 'aceite_em', 'aceite_versao', 'numero_anunciado')) <> 8 then
    raise exception 'mig 437: faltam colunas da conexão por QR na mister_numero';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_numero') and conname = 'ck_mister_numero_instancia_situacao') then
    raise exception 'mig 437: falta a restrição ck_mister_numero_instancia_situacao';
  end if;
  if exists (select 1 from mister_numero where provedor <> 'oficial') then
    raise exception 'mig 437: o número do Mister deveria seguir na API oficial';
  end if;
end $$;
