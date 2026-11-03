-- @cloud-only
-- 356 · AS AUTOMÁTICAS DE MARKETING (Onda 3 · PR 2; protótipo `mockups/regem-relacionamento.html` aprovado pelo dono em
-- 03/11/2026 com as 5 decisões). Só NUVEM: o WhatsApp e o cardápio moram lá; a loja não tem estas tabelas (SO_NUVEM no
-- sync-daemon).
--
-- O que entra:
--   relacionamento_config — os ajustes de Delivery › Marketing › Automáticas, um por empresa: "uma oferta por cliente a
--     cada" 3/7/15/30 dias (padrão 7), "mensagens por dia, no máximo" 10/20/30/50/100 (padrão 30), "horário do envio"
--     (1 h antes de abrir — padrão —, na hora de abrir, às 10:00, às 15:00) e o "cashback vencendo" (nasce DESLIGADO;
--     avisar 1/2/3/5/7 dias antes, padrão 3; só com saldo de pelo menos R$ 1/2/5/10, padrão 5). Os presentes do
--     aniversário e do "sentimos sua falta" entram nos PRs seguintes.
--   relacionamento_envio — o que cada automática separou e mandou. A trava contra mandar duas vezes é o índice único
--     (empresa, tipo, telefone pela chave, referência): no cashback a referência é o DIA do vencimento ("uma mensagem por
--     vencimento"). A rotina separa a lista do dia numa gravação só (`insert … on conflict do nothing`) e manda o que
--     separou; o clique no botão do WhatsApp fica em `clicou_em`.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabelas novas; o `lock_timeout` desiste em
-- vez de enfileirar escrita atrás de alguma trava.
set local lock_timeout = '5s';

create table if not exists relacionamento_config (
  tenant_id              uuid primary key references empresa(id) on delete cascade,
  intervalo_ofertas_dias integer not null default 7,
  max_por_dia            integer not null default 30,
  horario                text not null default 'antes_de_abrir',
  cashback_ativo         boolean not null default false,
  cashback_dias_antes    integer not null default 3,
  cashback_saldo_min     numeric(10, 2) not null default 5,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_intervalo check (intervalo_ofertas_dias in (3, 7, 15, 30));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_max_dia check (max_por_dia in (10, 20, 30, 50, 100));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_horario
    check (horario in ('antes_de_abrir', 'ao_abrir', '10:00', '15:00'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_cashback_dias check (cashback_dias_antes in (1, 2, 3, 5, 7));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_cashback_min check (cashback_saldo_min in (1, 2, 5, 10));
exception when duplicate_object then null; end $$;

create table if not exists relacionamento_envio (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  tipo           text not null,
  chave_telefone text not null,
  referencia     text not null,
  telefone       text not null,
  cliente_id     uuid,
  unidade_id     uuid,
  dia            date not null,
  oferta         boolean not null default false,
  valor          numeric(12, 2),
  vence_em       timestamptz,
  status         text not null default 'pendente',
  motivo         text,
  criado_em      timestamptz not null default now(),
  enviado_em     timestamptz,
  clicou_em      timestamptz
);
do $$ begin
  alter table relacionamento_envio add constraint ck_rel_envio_tipo check (tipo in ('cashback', 'aniversario', 'volta'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_envio add constraint ck_rel_envio_status check (status in ('pendente', 'enviado', 'falha', 'fora'));
exception when duplicate_object then null; end $$;
create unique index if not exists uq_rel_envio_uma_vez on relacionamento_envio (tenant_id, tipo, chave_telefone, referencia);
create index if not exists idx_rel_envio_dia on relacionamento_envio (tenant_id, dia, status);
create index if not exists idx_rel_envio_cliente on relacionamento_envio (tenant_id, chave_telefone, enviado_em desc);

-- Telefone e quem recebeu: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a 342/353 (o
-- servidor usa um papel que atravessa a RLS).
alter table relacionamento_config enable row level security;
alter table relacionamento_envio enable row level security;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`.
select 'tabela relacionamento_config' as objeto,
       to_regclass(current_schema() || '.relacionamento_config') is not null as ok
union all
select 'tabela relacionamento_envio',
       to_regclass(current_schema() || '.relacionamento_envio') is not null
union all
select 'trava contra mandar duas vezes (índice único)',
       exists (select 1 from pg_class c where c.oid = to_regclass(current_schema() || '.uq_rel_envio_uma_vez'))
union all
select 'regras dos ajustes (5)',
       (select count(*) = 5 from pg_constraint where conname like 'ck_rel_config_%'
          and conrelid = to_regclass(current_schema() || '.relacionamento_config'))
union all
select 'RLS ligada nas duas',
       coalesce((select bool_and(c.relrowsecurity) from pg_class c
                  where c.oid in (to_regclass(current_schema() || '.relacionamento_config'),
                                  to_regclass(current_schema() || '.relacionamento_envio'))), false);
