-- @cloud-only
-- 470 · O REGEM LÊ O PULSO (F7 parte 4 do `docs/plano-perfil-cliente.md`, D12: a base nacional de eventos é produto do Hub
-- DMS — https://pulso.dmstecnologias.com, contrato 1.0.0). Só NUVEM (SO_NUVEM no sync-daemon): quem lê o Pulso é a nuvem.
-- Dado da DISTRIBUIÇÃO, sem empresa nem loja (o Pulso não recebe e não devolve nada de cliente, de loja ou de empresa).
--
-- pulso_evento — a cópia dos eventos (leitura incremental `GET /v1/eventos/mudancas`, em ordem de versão, inclusive os
--   retirados). O id é o do Pulso (UUID v5 da chave). Hoje os tipos são os mesmos da regra fixa do Regem (feriado, ponto
--   facultativo, comemorativa, dinheiro — o Pulso copiou o `calendario-regra.ts`); os tipos novos (jogos e outros) entram
--   no calendário da loja quando o Pulso os publicar.
-- pulso_estado — uma linha só: o cursor da leitura (`versao`), a última leitura de cada rotina (a reserva entre réplicas e o
--   relógio de cadência longa ficam no banco — V98, V104) e o último erro.
-- clima_municipio_dia — o clima de cada município das lojas com o módulo "Perfil do cliente" ligado (`GET /v1/clima`, até
--   16 dias, a foto do Pulso é às 06:30): a chuva prevista, os dados do INMET e do CPTEC e a chuva que se previa NA VÉSPERA
--   (o que vale para o "vai chover amanhã" e para medir a sensibilidade à chuva — F3, que pede ~60 dias gravados).
--
-- `clock_timestamp()` nos carimbos (V9). RLS ligada e SEM política. Sem instrução destrutiva (MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists pulso_evento (
  id            uuid primary key,
  chave         text not null,
  tipo          text not null,
  nome          text,
  dia_inteiro   boolean not null default true,
  inicio        text,
  fim           text,
  fuso          text,
  janela        jsonb,
  abrangencia   jsonb,
  situacao      text not null,
  detalhes      jsonb,
  versao        bigint not null,
  fonte         jsonb,
  credito       text,
  recebido_em   timestamptz not null default clock_timestamp()
);
create unique index if not exists uq_pulso_evento_chave on pulso_evento (chave);
create index if not exists ix_pulso_evento_tipo_inicio on pulso_evento (tipo, inicio) where situacao <> 'retirado';
alter table pulso_evento enable row level security;

create table if not exists pulso_estado (
  id                  smallint primary key default 1,
  versao              bigint not null default 0,
  eventos_lidos_em    timestamptz,
  interesses_hash     text,
  interesses_em       timestamptz,
  clima_lido_em       timestamptz,
  erro                text,
  erro_em             timestamptz,
  constraint pulso_estado_uma_linha_ck check (id = 1)
);
insert into pulso_estado (id) values (1) on conflict (id) do nothing;
alter table pulso_estado enable row level security;

create table if not exists clima_municipio_dia (
  municipio         integer not null,
  dia               date not null,
  chuva_prevista    boolean,
  chuva_na_vespera  boolean,
  inmet             jsonb,
  cptec             jsonb,
  lido_em           timestamptz not null default clock_timestamp(),
  primary key (municipio, dia)
);
alter table clima_municipio_dia enable row level security;

-- Conferência (no mesmo Run).
select to_regclass(current_schema() || '.pulso_evento') is not null as eventos,
       to_regclass(current_schema() || '.pulso_estado') is not null as estado,
       to_regclass(current_schema() || '.clima_municipio_dia') is not null as clima,
       (select count(*) from pulso_estado) as linhas_do_estado;
