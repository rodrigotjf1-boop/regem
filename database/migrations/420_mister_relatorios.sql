-- @cloud-only
-- 420 — MISTER: os RELATÓRIOS (F3 do protótipo `mockups/regem-mister.html`, aprovado pelo dono em 13/11/2026 — "Avisos e
-- relatórios" › Relatórios: o resumo do dia e o resumo da semana, no horário que a empresa escolher).
--
-- mister_relatorio_regra — a escolha da empresa para um relatório: ligado, a hora (no relógio da operação) e, no resumo da
--   semana, o dia. Sem linha = o padrão (desligado; no código, `mister-relatorios.regras.ts`).
--
-- mister_relatorio — cada ENVIO de um relatório a uma pessoa: um por empresa, tipo, referência (o dia ou o início dos 7
--   dias do resumo) e pessoa. A linha é a vez de fazer: quem insere primeiro faz (a volta repetida e a réplica a mais caem
--   no `on conflict`). Guarda o texto que saiu e o motivo quando não saiu (fora da janela de 24 h, sem a chave de IA…) —
--   nunca o telefone inteiro.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas ficam em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414, a 415, a 417, a 418 e a 419).
set local lock_timeout = '5s';

create table if not exists mister_relatorio_regra (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  tipo               text not null,                      -- resumo_dia | resumo_semana (mister-relatorios.regras.ts)
  ligado             boolean not null,
  hora               text not null,                      -- 'HH:MM' no relógio da operação
  dia_semana         smallint,                           -- 1 = segunda … 7 = domingo (só o resumo da semana)
  alterado_por       uuid,
  atualizado_em      timestamptz not null default now(),
  primary key (tenant_id, tipo),
  constraint ck_mister_relatorio_regra_hora check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint ck_mister_relatorio_regra_dia check (dia_semana is null or dia_semana between 1 and 7)
);
alter table mister_relatorio_regra enable row level security;

create table if not exists mister_relatorio (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  tipo               text not null,
  referencia         date not null,                      -- o dia do resumo (ou o primeiro dos 7 dias do resumo da semana)
  colaborador_id     uuid not null,                      -- para quem (o resumo sai no escopo da pessoa)
  situacao           text not null default 'fazendo',    -- fazendo | enviado | nao_enviado
  motivo             text,                               -- por que não saiu
  texto              text,                               -- o que saiu
  final_do_telefone  text,                               -- os 4 últimos dígitos, para a conferência
  trilha             jsonb,                              -- o modelo, as chamadas, os tokens e as consultas
  criado_em          timestamptz not null default clock_timestamp(),
  concluido_em       timestamptz,
  constraint uq_mister_relatorio unique (tenant_id, tipo, referencia, colaborador_id),
  constraint ck_mister_relatorio_situacao check (situacao in ('fazendo', 'enviado', 'nao_enviado'))
);
create index if not exists ix_mister_relatorio_empresa on mister_relatorio (tenant_id, criado_em desc);
create index if not exists ix_mister_relatorio_fazendo on mister_relatorio (criado_em) where situacao = 'fazendo';
alter table mister_relatorio enable row level security;

comment on table mister_relatorio_regra is 'Mister (mig 420): o horário de cada relatório, por empresa — só nuvem; sem linha = o padrão (desligado)';
comment on table mister_relatorio is 'Mister (mig 420): cada envio de relatório a uma pessoa e o motivo quando não saiu — só nuvem';

-- Conferência (no mesmo Run): as duas tabelas (com RLS), as colunas, os índices e as restrições.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('mister_relatorio_regra', 'mister_relatorio')
union all
select 'colunas', table_name, count(*)::text
  from information_schema.columns
 where table_schema = current_schema() and table_name in ('mister_relatorio_regra', 'mister_relatorio')
 group by table_name
union all
select 'indice', indexname, tablename
  from pg_indexes
 where schemaname = current_schema() and tablename in ('mister_relatorio_regra', 'mister_relatorio')
union all
select 'restricao', conname, contype::text
  from pg_constraint
 where conrelid in (to_regclass('mister_relatorio_regra'), to_regclass('mister_relatorio')) and contype in ('c', 'u')
 order by 1, 2;
