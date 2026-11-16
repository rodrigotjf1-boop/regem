-- @cloud-only
-- 434 — MISTER: a ANÁLISE COM IA da Segurança (o Sentinela, parte 2; S2 do protótipo
-- `mockups/regem-mister-mentor-parte2.html`, aprovado pelo dono em 16/11/2026).
--
-- mister_analise — uma RODADA da análise (Console › Mister › Segurança, só a Diretoria, só pelo botão):
--   situacao   — rodando | terminou | falhou | interrompida (a "rodando" que passou do prazo; a regra fica no serviço)
--   dias       — o período lido (7); eventos — quantos eventos (metadados) foram lidos
--   modelo, tokens_*, custo_usd — o que a rodada gastou da chave da DMS (não soma no medidor de nenhuma empresa)
--   motivo     — por que falhou (a frase, sem segredo)
--   Uma rodada "rodando" por vez (índice único parcial).
-- mister_analise_proposta — o que a IA PROPÔS numa rodada (nada age sozinho):
--   nivel      — critico | atencao | melhoria
--   titulo, viu (o que viu), proposta, impacto (o impacto e como conferir)
--   situacao   — aberta | tarefa (virou tarefa do time; `tarefa` = link ou código, opcional) | descartada
--   decidida_por, decidida_em — quem decidiu no console (a auditoria do console guarda o resto)
--
-- A análise lê SÓ metadados que o servidor já anota (desfechos, notas do filtro, motivos, contagens por empresa, o final
-- de 4 dígitos do telefone) — nunca o texto das lojas. Sem tenant: é da distribuição, como o `mister_avaliacao`, e por
-- isso fica fora da classificação do sync-daemon (a V21 é para tabela com tenant_id).
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM
-- política.
set local lock_timeout = '5s';

create table if not exists mister_analise (
  id                   uuid primary key default gen_random_uuid(),
  pedida_por           text,
  situacao             text not null default 'rodando',
  dias                 int not null default 7,
  eventos              int not null default 0,
  modelo               text,
  tokens_entrada       int not null default 0,
  tokens_cache_escrita int not null default 0,
  tokens_cache_leitura int not null default 0,
  tokens_saida         int not null default 0,
  custo_usd            numeric(10, 6),                    -- 6 casas, como a 424: uma rodada custa frações de centavo
  motivo               text,
  iniciada_em          timestamptz not null default clock_timestamp(),
  terminada_em         timestamptz,
  constraint ck_mister_analise_situacao check (situacao in ('rodando', 'terminou', 'falhou', 'interrompida'))
);
create unique index if not exists uq_mister_analise_rodando on mister_analise ((true)) where situacao = 'rodando';
create index if not exists ix_mister_analise_iniciada on mister_analise (iniciada_em desc);
alter table mister_analise enable row level security;

create table if not exists mister_analise_proposta (
  id            uuid primary key default gen_random_uuid(),
  analise_id    uuid not null references mister_analise(id) on delete cascade,
  ordem         int not null default 0,
  nivel         text not null,
  titulo        text not null,
  viu           text not null,
  proposta      text not null,
  impacto       text not null,
  situacao      text not null default 'aberta',
  tarefa        text,
  decidida_por  text,
  decidida_em   timestamptz,
  criada_em     timestamptz not null default clock_timestamp(),
  constraint ck_mister_analise_proposta_nivel check (nivel in ('critico', 'atencao', 'melhoria')),
  constraint ck_mister_analise_proposta_situacao check (situacao in ('aberta', 'tarefa', 'descartada'))
);
create index if not exists ix_mister_analise_proposta_analise on mister_analise_proposta (analise_id, ordem);
alter table mister_analise_proposta enable row level security;

comment on table mister_analise is 'Mister (mig 434): as rodadas da análise com IA da Segurança (o Sentinela) — só nuvem, da distribuição';
comment on table mister_analise_proposta is 'Mister (mig 434): as propostas de cada rodada da análise com IA — nada age sozinho; só nuvem';

-- Conferência (no mesmo Run): as duas tabelas com RLS, as colunas, os índices e as restrições.
do $$
begin
  if to_regclass('mister_analise') is null or to_regclass('mister_analise_proposta') is null then
    raise exception 'mig 434: faltam as tabelas da análise do Mister';
  end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_analise'))
     or not (select relrowsecurity from pg_class where oid = to_regclass('mister_analise_proposta')) then
    raise exception 'mig 434: a RLS das tabelas da análise não está ligada';
  end if;
  if (select count(*) from information_schema.columns where table_schema = current_schema() and table_name = 'mister_analise'
        and column_name in ('id', 'pedida_por', 'situacao', 'dias', 'eventos', 'modelo', 'tokens_entrada', 'tokens_cache_escrita',
                            'tokens_cache_leitura', 'tokens_saida', 'custo_usd', 'motivo', 'iniciada_em', 'terminada_em')) <> 14 then
    raise exception 'mig 434: faltam colunas da mister_analise';
  end if;
  if (select count(*) from information_schema.columns where table_schema = current_schema() and table_name = 'mister_analise_proposta'
        and column_name in ('id', 'analise_id', 'ordem', 'nivel', 'titulo', 'viu', 'proposta', 'impacto', 'situacao', 'tarefa',
                            'decidida_por', 'decidida_em', 'criada_em')) <> 13 then
    raise exception 'mig 434: faltam colunas da mister_analise_proposta';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema()
        and indexname in ('uq_mister_analise_rodando', 'ix_mister_analise_iniciada', 'ix_mister_analise_proposta_analise')) <> 3 then
    raise exception 'mig 434: faltam índices da análise';
  end if;
  if (select count(*) from pg_constraint where conname in ('ck_mister_analise_situacao', 'ck_mister_analise_proposta_nivel',
        'ck_mister_analise_proposta_situacao')) <> 3 then
    raise exception 'mig 434: faltam as restrições da análise';
  end if;
end $$;
