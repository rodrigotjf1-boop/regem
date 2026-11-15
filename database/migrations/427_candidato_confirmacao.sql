-- @cloud-only
-- 427 — VAGAS: a CONFIRMAÇÃO DA FICHA pelo WhatsApp (F3 parte b de `docs/plano-vagas-candidatos.md` §10: "Se a pessoa
-- veio de uma conversa aberta (janela de 24 h do WhatsApp), o robô confirma: 'Recebemos sua ficha nº …'").
--
-- candidato.confirmacao / confirmacao_em — o que a rotina fez com a ficha que veio pelo link do robô (`?o=whatsapp`):
--   enviando (a vez marcada antes de mandar), enviada, falhou, sem_conversa (sem a conversa aberta de 24 h na API oficial
--   — fora da janela só sai modelo aprovado) ou equipe_na_conversa (alguém da equipe está falando com a pessoa). Uma vez
--   só por ficha: o reenvio com o mesmo WhatsApp não confirma de novo. NULL = ainda não tratada (ou ficha de outra origem).
--
-- ⚠️ SÓ NUVEM: a `candidato` é só nuvem (mig 389); o servidor da loja pula o arquivo inteiro. Sem tabela nova: nada a
-- classificar no sync-daemon. Idempotente; nada que apague objeto (LIC-171).
set local lock_timeout = '5s';

alter table candidato add column if not exists confirmacao text;
alter table candidato add column if not exists confirmacao_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_candidato_confirmacao' and conrelid = to_regclass('candidato')) then
    alter table candidato add constraint ck_candidato_confirmacao
      check (confirmacao is null or confirmacao in ('enviando', 'enviada', 'falhou', 'sem_conversa', 'equipe_na_conversa'));
  end if;
end $$;

-- A rotina lê só as fichas do robô que ainda esperam a confirmação (o índice fica pequeno).
create index if not exists ix_candidato_confirmar on candidato (recebido_em) where origem = 'whatsapp' and confirmacao is null;

-- Conferência no mesmo Run (LIC-171): as duas colunas, a restrição e o índice.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'candidato' and column_name in ('confirmacao', 'confirmacao_em')) <> 2 then
    raise exception 'mig 427: faltam as colunas da confirmação';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_candidato_confirmacao' and conrelid = to_regclass('candidato')) then
    raise exception 'mig 427: falta a restrição da confirmação';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'ix_candidato_confirmar') then
    raise exception 'mig 427: falta o índice da confirmação';
  end if;
end $$;
