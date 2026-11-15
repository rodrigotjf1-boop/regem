-- @cloud-only
-- 424 — MISTER: a AVALIAÇÃO DE REGRESSÃO (F5.3 do `docs/plano-mister.md`; protótipo
-- `mockups/regem-dependencias-e-qualidade.html`, vista "Console › Mister › Qualidade", cartão "Avaliação de regressão").
--
-- mister_avaliacao — cada RODADA da avaliação: as perguntas fixas (no código, `mister-avaliacao-casos.ts`) feitas ao
--   Mister numa loja de teste com dados INVENTADOS (também no código), com a chave da distribuição. Guarda a versão das
--   instruções e das ferramentas naquela hora, quantas passaram, o resultado de cada pergunta (conferido por regra: a
--   consulta escolhida, os números, nada inventado, nada fora do que a pessoa pode ver) e o custo estimado.
--   É dado da DISTRIBUIÇÃO: sem `tenant_id`, nenhuma loja aparece aqui, e nunca vai para a loja.
--   Uma rodada de cada vez (o índice único parcial); a rodada que ficou "rodando" depois de o processo cair vence pelo
--   tempo (a regra é do serviço, V80) e não trava a próxima.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. Sem `tenant_id`: não entra na classificação do sync-daemon.
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414 a 420 e a 423).
set local lock_timeout = '5s';

create table if not exists mister_avaliacao (
  id                 uuid primary key default gen_random_uuid(),
  situacao           text not null default 'rodando',        -- rodando | terminou | falhou | interrompida
  iniciada_em        timestamptz not null default clock_timestamp(),
  terminada_em       timestamptz,
  pedida_por         text,                                   -- o nome de quem pediu no console
  versao             text not null,                          -- a impressão das instruções e das ferramentas (8 letras)
  consultas          smallint not null,                      -- quantas consultas o Mister tinha nesta versão
  modelo             text not null,
  total              smallint not null,                      -- quantas perguntas a rodada tem
  feitas             smallint not null default 0,            -- quantas já foram feitas (o andamento)
  acertos            smallint not null default 0,
  casos              jsonb not null default '[]'::jsonb,     -- [{ id, pergunta, ok, falhas[], consultas[], ms }]
  motivo             text,                                   -- por que a rodada não terminou (sem a chave da distribuição…)
  tokens_entrada     integer not null default 0,
  tokens_cache_escrita integer not null default 0,
  tokens_cache_leitura integer not null default 0,
  tokens_saida       integer not null default 0,
  custo_usd          numeric(10, 6),
  atualizado_em      timestamptz not null default now(),
  constraint ck_mister_avaliacao_situacao check (situacao in ('rodando', 'terminou', 'falhou', 'interrompida'))
);
-- Uma rodada de cada vez.
create unique index if not exists uq_mister_avaliacao_rodando on mister_avaliacao ((true)) where situacao = 'rodando';
-- A lista das últimas.
create index if not exists ix_mister_avaliacao_iniciada on mister_avaliacao (iniciada_em desc);
alter table mister_avaliacao enable row level security;

comment on table mister_avaliacao is 'Mister (mig 424): as rodadas da avaliação de regressão — só nuvem, da distribuição, sem loja';

-- Conferência no mesmo Run (LIC-171): a tabela, as colunas principais e o índice de uma rodada de cada vez.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_avaliacao'
         and column_name in ('situacao', 'versao', 'total', 'feitas', 'acertos', 'casos', 'custo_usd')) <> 7 then
    raise exception 'mig 424: mister_avaliacao incompleta';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'uq_mister_avaliacao_rodando') then
    raise exception 'mig 424: falta o índice de uma rodada de cada vez';
  end if;
end $$;
