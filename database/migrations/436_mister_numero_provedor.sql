-- @cloud-only
-- 436 — MISTER: a PORTA DO PROVEDOR do número (Q1 do protótipo `mockups/regem-mister-qr.html`, aprovado pelo dono em
-- 15/11/2026; a pendência dele de 13/11: "deixar ao final uma opção de usar a conexão gratuita do Evolution").
--
-- O número do Mister fala por UMA forma de cada vez, escolhida pela Diretoria no console (Q2):
--   provedor  — oficial (a API oficial da Meta, como hoje: `phone_id`, `waba_id`, modelos fora das 24 h) | evolution (a
--               conexão por QR Code no Evolution da DISTRIBUIÇÃO, numa instância só do Mister)
--   instancia — o nome da instância do Mister no Evolution (separada das instâncias das lojas)
--   instancia_numero — o número do celular conectado por QR nessa instância (o que as pessoas salvam nos contatos e o que
--               o aviso "este é o novo número do Mister" leva, Q3)
-- Nasce `oficial`: nada muda até a Diretoria trocar.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a `mister_numero` é da distribuição, sem tenant). Idempotente;
-- nada que apague objeto (LIC-171): a restrição nasce dentro de um bloco que confere se já existe.
set local lock_timeout = '5s';

alter table mister_numero add column if not exists provedor text not null default 'oficial';
alter table mister_numero add column if not exists instancia text;
alter table mister_numero add column if not exists instancia_numero text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_numero') and conname = 'ck_mister_numero_provedor') then
    alter table mister_numero add constraint ck_mister_numero_provedor check (provedor in ('oficial', 'evolution'));
  end if;
end $$;

-- Conferência (no mesmo Run): as duas colunas, a restrição e o número continuando na API oficial.
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = current_schema() and table_name = 'mister_numero'
        and column_name in ('provedor', 'instancia', 'instancia_numero')) <> 3 then
    raise exception 'mig 436: faltam as colunas provedor, instancia e instancia_numero na mister_numero';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_numero') and conname = 'ck_mister_numero_provedor') then
    raise exception 'mig 436: falta a restrição ck_mister_numero_provedor';
  end if;
  if exists (select 1 from mister_numero where provedor <> 'oficial') then
    raise exception 'mig 436: o número do Mister deveria seguir na API oficial';
  end if;
end $$;
