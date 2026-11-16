-- @cloud-only
-- 432 — MISTER: as DECISÕES do "O que melhorar" (M2a da parte 2 do Mentor; protótipo
-- `mockups/regem-mister-mentor-parte2.html`, aprovado pelo dono em 16/11/2026).
--
-- mister_melhoria_decisao — o que a Diretoria decidiu sobre um PADRÃO do "O que melhorar" (Console › Mister › Qualidade):
--   chave     — o padrão, estável entre as leituras (falta:<tema>, consulta:<nome>, avaliacao:<id>, motivo:<motivo>)
--   decisao   — tarefa (virou tarefa do time) | nao_se_aplica (some da lista até `vale_ate`)
--   motivo    — obrigatório no "não se aplica"; tarefa — o link ou o código da tarefa (opcional)
--   quem      — o nome de quem decidiu no console (a auditoria do console guarda o resto)
--   desfeita_em — "Desfazer a decisão": a linha fica (histórico) e deixa de valer
--   Uma decisão VALENDO por padrão (índice único parcial): decidir de novo exige desfazer antes.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. Não tem tenant: é da distribuição (o console), como o
-- `mister_avaliacao` — por isso fica fora da classificação do sync-daemon (a V21 é para tabela com tenant_id).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política.
set local lock_timeout = '5s';

create table if not exists mister_melhoria_decisao (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null,
  decisao       text not null,
  motivo        text,
  tarefa        text,
  quem          text,
  decidida_em   timestamptz not null default clock_timestamp(),
  vale_ate      timestamptz,                                  -- só no "não se aplica": decidida_em + 30 dias
  desfeita_em   timestamptz,
  constraint ck_mister_melhoria_decisao check (decisao in ('tarefa', 'nao_se_aplica')),
  constraint ck_mister_melhoria_motivo check (decisao <> 'nao_se_aplica' or length(btrim(coalesce(motivo, ''))) > 0)
);
create unique index if not exists uq_mister_melhoria_valendo on mister_melhoria_decisao (chave) where desfeita_em is null;
alter table mister_melhoria_decisao enable row level security;

comment on table mister_melhoria_decisao is 'Mister (mig 432): as decisões da Diretoria sobre os padrões do "O que melhorar" — só nuvem, da distribuição';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, o índice e as restrições.
do $$
begin
  if to_regclass('mister_melhoria_decisao') is null then raise exception 'mig 432: falta a tabela mister_melhoria_decisao'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_melhoria_decisao')) then
    raise exception 'mig 432: a RLS da mister_melhoria_decisao não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_melhoria_decisao'
         and column_name in ('id', 'chave', 'decisao', 'motivo', 'tarefa', 'quem', 'decidida_em', 'vale_ate', 'desfeita_em')) <> 9 then
    raise exception 'mig 432: faltam colunas da mister_melhoria_decisao';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_melhoria_decisao'
        and indexname = 'uq_mister_melhoria_valendo') <> 1 then
    raise exception 'mig 432: falta o índice uq_mister_melhoria_valendo';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_melhoria_decisao')
        and conname in ('ck_mister_melhoria_decisao', 'ck_mister_melhoria_motivo')) <> 2 then
    raise exception 'mig 432: faltam as restrições da mister_melhoria_decisao';
  end if;
end $$;
