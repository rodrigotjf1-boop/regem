-- @cloud-only
-- 435 — MISTER: as INSTRUÇÕES CANDIDATAS (M2b, o Mentor; protótipo `mockups/regem-mister-mentor-parte2.html`, aprovado pelo
-- dono em 16/11/2026).
--
-- As instruções do Mister moram no código (`INSTRUCOES_DO_MISTER`). Uma versão nova não substitui o texto inteiro — isso
-- esconderia as mudanças futuras do código —: é uma TROCA de uma linha (a que sai, exata, e a que entra), aplicada por
-- cima do texto do código. O texto "no ar" = o do código com as trocas publicadas, em ordem. Troca cuja linha não existe
-- mais no código fica de fora (e o console avisa).
--
-- mister_instrucao_troca — cada troca e o que aconteceu com ela:
--   tipo        — troca (uma linha nova) | volta (tira a última troca publicada: `troca_alvo`)
--   sai, entra  — a linha que sai (exata) e a que entra; porque — o que o Mentor viu (a frase curta)
--   padrao      — a chave do padrão do "O que melhorar" de onde nasceu (avaliacao:<id>)
--   situacao    — candidata (a testar; uma por vez) | no_ar (troca valendo) | retirada (troca tirada por uma volta) |
--                 descartada | feita (a volta publicada)
--   versao_base — a versão no ar quando a candidata nasceu; versao — a versão com a candidata aplicada
--   avaliacao_id — a rodada da avaliação de regressão feita com a candidata (a última)
--   criada_por / publicada_por / descartada_por — quem, no console (a auditoria do console guarda o resto)
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. Sem tenant: é da distribuição, como o `mister_avaliacao`, e por
-- isso fica fora da classificação do sync-daemon (a V21 é para tabela com tenant_id). Idempotente; nada que apague objeto
-- (LIC-171). RLS ligada e SEM política.
set local lock_timeout = '5s';

create table if not exists mister_instrucao_troca (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null default 'troca',
  sai             text not null,
  entra           text not null,
  porque          text,
  padrao          text,
  troca_alvo      uuid references mister_instrucao_troca(id),
  situacao        text not null default 'candidata',
  versao_base     text not null,
  versao          text not null,
  avaliacao_id    uuid,
  criada_por      text,
  criada_em       timestamptz not null default clock_timestamp(),
  publicada_por   text,
  publicada_em    timestamptz,
  retirada_em     timestamptz,
  descartada_por  text,
  descartada_em   timestamptz,
  constraint ck_mister_instrucao_troca_tipo check (tipo in ('troca', 'volta')),
  constraint ck_mister_instrucao_troca_situacao check (situacao in ('candidata', 'no_ar', 'retirada', 'descartada', 'feita'))
);
create unique index if not exists uq_mister_instrucao_candidata on mister_instrucao_troca ((true)) where situacao = 'candidata';
create index if not exists ix_mister_instrucao_no_ar on mister_instrucao_troca (publicada_em) where situacao = 'no_ar';
alter table mister_instrucao_troca enable row level security;

comment on table mister_instrucao_troca is 'Mister (mig 435): as trocas de linha das instruções (candidatas e publicadas) — só nuvem, da distribuição';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, os índices e as restrições.
do $$
begin
  if to_regclass('mister_instrucao_troca') is null then raise exception 'mig 435: falta a tabela mister_instrucao_troca'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_instrucao_troca')) then
    raise exception 'mig 435: a RLS da mister_instrucao_troca não está ligada';
  end if;
  if (select count(*) from information_schema.columns where table_schema = current_schema() and table_name = 'mister_instrucao_troca'
        and column_name in ('id', 'tipo', 'sai', 'entra', 'porque', 'padrao', 'troca_alvo', 'situacao', 'versao_base', 'versao',
                            'avaliacao_id', 'criada_por', 'criada_em', 'publicada_por', 'publicada_em', 'retirada_em',
                            'descartada_por', 'descartada_em')) <> 18 then
    raise exception 'mig 435: faltam colunas da mister_instrucao_troca';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_instrucao_troca'
        and indexname in ('uq_mister_instrucao_candidata', 'ix_mister_instrucao_no_ar')) <> 2 then
    raise exception 'mig 435: faltam os índices da mister_instrucao_troca';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_instrucao_troca')
        and conname in ('ck_mister_instrucao_troca_tipo', 'ck_mister_instrucao_troca_situacao')) <> 2 then
    raise exception 'mig 435: faltam as restrições da mister_instrucao_troca';
  end if;
end $$;
