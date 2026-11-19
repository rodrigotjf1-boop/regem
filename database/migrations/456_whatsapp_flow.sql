-- @cloud-only
-- 456 · O FORMULÁRIO DA NOTA NO WHATSAPP OFICIAL (fase A2 do protótipo `mockups/regem-avaliacao-pedido.html`, aprovado em
-- 18/11/2026). Só NUVEM: o WhatsApp oficial e a rotina que fala com a Meta só existem lá (SO_NUVEM no sync-daemon).
--
-- whatsapp_flow — o formulário (WhatsApp Flow) que a DMS cria e publica na conta (WABA) do número da loja: UM por conta,
--   tipo e versão do nosso formulário (o índice único — duas réplicas nunca criam dois). A situação: "criando" (a rotina
--   tomou a vez), "publicado" (o convite pode sair), "recusado" (a Meta apontou erro no formulário — não se publica nada
--   com erro: publicado não se edita) ou "erro" (a Meta recusou ou não respondeu; tenta de novo em 30 min). O motivo fica
--   em `erro` — é da distribuição: a tela da loja mostra só a situação.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabela nova: a chave estrangeira trava
-- `empresa` e nada mais.
set local lock_timeout = '5s';

create table if not exists whatsapp_flow (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references empresa(id) on delete cascade,
  waba_id       text not null,
  tipo          text not null,
  versao        integer not null,
  flow_id       text,
  situacao      text not null,
  erro          text,
  tentou_em     timestamptz,
  publicado_em  timestamptz,
  criado_em     timestamptz not null default clock_timestamp()
);
do $$ begin
  alter table whatsapp_flow add constraint ck_whatsapp_flow_situacao check (situacao in ('criando', 'publicado', 'recusado', 'erro'));
exception when duplicate_object then null; end $$;
create unique index if not exists uq_whatsapp_flow_conta on whatsapp_flow (waba_id, tipo, versao);
create index if not exists idx_whatsapp_flow_empresa on whatsapp_flow (tenant_id);

-- A conta e o motivo da Meta: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a 453.
alter table whatsapp_flow enable row level security;

-- Conferência (no mesmo Run).
select 'whatsapp_flow' as objeto, exists (select 1 from information_schema.tables
  where table_schema = current_schema() and table_name = 'whatsapp_flow') as ok
union all
select 'uq_whatsapp_flow_conta', exists (select 1 from pg_indexes
  where schemaname = current_schema() and indexname = 'uq_whatsapp_flow_conta')
union all
select 'ck_whatsapp_flow_situacao', exists (select 1 from pg_constraint
  where conrelid = to_regclass(current_schema() || '.whatsapp_flow') and conname = 'ck_whatsapp_flow_situacao');
